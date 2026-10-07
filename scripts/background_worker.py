"""Standalone selected-group reader and durable inbox delivery queue."""
import argparse
import hashlib
import json
import re
import sqlite3
import time
from functools import lru_cache
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError
from background_provider import ROOT, connect, groups, snapshot, relevant_files
from wechat_collector import Bridge

CN = timezone(timedelta(hours=8))


def date_predicate(date_range, column='create_time'):
    clauses, values = [], []
    if date_range.get('start'):
        clauses.append(column+' >= ?')
        values.append(int(datetime.fromisoformat(date_range['start']).replace(tzinfo=CN).timestamp()))
    if date_range.get('end'):
        clauses.append(column+' < ?')
        values.append(int(datetime.fromisoformat(date_range['end']).replace(tzinfo=CN).timestamp())+86400)
    return clauses, values


def read_rows(conn, table, cursor, date_range):
    # Table is a local MD5 identifier from the verified group, never user SQL.
    clauses, values = date_predicate(date_range)
    if cursor:
        clauses.append('(sort_seq>? OR (sort_seq=? AND local_id>?))')
        values.extend((cursor[0],cursor[0],cursor[1]))
    where = ' WHERE '+' AND '.join(clauses) if clauses else ''
    ascending = bool(cursor or date_range.get('start') or date_range.get('end'))
    direction = 'ASC' if ascending else 'DESC'
    return conn.execute(f'SELECT * FROM "{table}"{where} ORDER BY sort_seq {direction},local_id {direction} LIMIT 300', values).fetchall()


class Queue:
    def __init__(self, path):
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS bindings(account TEXT,name TEXT,group_id TEXT,PRIMARY KEY(account,name));
        CREATE TABLE IF NOT EXISTS cursors(account TEXT,group_id TEXT,shard TEXT,seq INTEGER,local_id INTEGER,PRIMARY KEY(account,group_id,shard));
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account TEXT,group_id TEXT,group_name TEXT,payload TEXT,status TEXT DEFAULT 'pending');
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
        CREATE TABLE IF NOT EXISTS range_cursors(account TEXT,group_id TEXT,shard TEXT,scope TEXT,seq INTEGER,local_id INTEGER,PRIMARY KEY(account,group_id,shard,scope));
        ''')

    def cursor(self, account, gid, shard, scope=''):
        if scope:
            return self.db.execute('SELECT seq,local_id FROM range_cursors WHERE account=? AND group_id=? AND shard=? AND scope=?',(account,gid,shard,scope)).fetchone()
        return self.db.execute('SELECT seq,local_id FROM cursors WHERE account=? AND group_id=? AND shard=?', (account,gid,shard)).fetchone()

    def commit(self, account, gid, name, shard, rows, messages, scope=''):
        with self.db:
            for message in messages:
                self.db.execute('INSERT OR IGNORE INTO jobs(id,account,group_id,group_name,payload) VALUES(?,?,?,?,?)',
                                (message['id'],account,gid,name,json.dumps(message,ensure_ascii=False)))
            if rows:
                last = max(rows,key=lambda r:(r['sort_seq'],r['local_id']))
                if scope:
                    self.db.execute('INSERT INTO range_cursors VALUES(?,?,?,?,?,?) ON CONFLICT(account,group_id,shard,scope) DO UPDATE SET seq=excluded.seq,local_id=excluded.local_id',
                                    (account,gid,shard,scope,last['sort_seq'],last['local_id']))
                else:
                    self.db.execute('INSERT INTO cursors VALUES(?,?,?,?,?) ON CONFLICT(account,group_id,shard) DO UPDATE SET seq=excluded.seq,local_id=excluded.local_id',
                                    (account,gid,shard,last['sort_seq'],last['local_id']))

    def pending(self, account, gid, limit=20, date_range=None):
        clauses, values = date_predicate(date_range or {}, "CAST(strftime('%s',json_extract(payload,'$.sentAt')) AS INTEGER)")
        extra = ' AND '+ ' AND '.join(clauses) if clauses else ''
        return self.db.execute("SELECT id,payload FROM jobs WHERE account=? AND group_id=? AND status='pending'"+extra+' ORDER BY rowid LIMIT ?', (account,gid,*values,limit)).fetchall()

    def done(self, ids):
        with self.db:
            self.db.executemany("UPDATE jobs SET status='done',payload=NULL WHERE id=?",[(x,) for x in ids])


@lru_cache(maxsize=1)
def legacy_rules():
    rules_file = ROOT/'data/legacy-transcription-rules.json'
    if not rules_file.exists():
        return {}
    rules = json.loads(rules_file.read_text(encoding='utf-8'))
    if not isinstance(rules,dict) or any(not isinstance(key,str) or not isinstance(values,list) or any(not isinstance(value,str) or not value for value in values) for key,values in rules.items()):
        raise ValueError('本机旧来源迁移规则格式不正确')
    return rules


def normalize(row, account, gid, name, primitives, legacy, rules=None):
    # Only actual text and file/link captions. No media downloads or OCR.
    if (int(row['local_type']) & 0xffffffff) not in (1,49):
        return None
    content = row['message_content']
    if isinstance(content,bytes):
        if content.startswith(b'\x28\xb5\x2f\xfd'):
            content = primitives['_zstd_decompress'](primitives['_get_zstd_module'](),content)
        else:
            try:
                content = content.decode('utf-8')
            except UnicodeDecodeError:
                return None
    if not isinstance(content,str) or not content.strip() or len(content)>20000:
        return None
    # Personal migration anchors are optional local data, never source literals.
    rules = legacy_rules() if rules is None else rules
    for old in legacy:
        if old['group_name'] != name or not old['id'].startswith('wechat-notice-'):
            continue
        anchors = rules.get(old['id'],[])
        if anchors and all(x in content for x in anchors):
            return None
    identity = str(row['server_id'] or (str(row['_shard'])+':'+str(row['local_id'])))
    message_id = hashlib.sha256(('local-db\n'+account+'\n'+gid+'\n'+identity).encode()).hexdigest()[:24]
    sender = '未识别（微信发送人标识 '+str(row['real_sender_id'])+'）'
    prefix = re.match(r'^([A-Za-z0-9_@.-]+):\n',content)
    if prefix:
        sender = prefix[1]
        content = content[prefix.end():]
    sent_at = None
    if row['create_time']:
        sent_at = datetime.fromtimestamp(row['create_time'],CN).isoformat()
    return {'id':message_id,'sender':sender,'text':content,'sentAt':sent_at}


class Worker:
    def __init__(self):
        self.bridge = Bridge()
        self.bridge.timeout = 180
        self.queue = Queue(ROOT/'data/background-queue.sqlite')
        self.connection = None
        self.signatures = {}
        self.last_discovery = None
        self.incremental = False
        self.last_checked = 0
        self.last_request = None
        self.pid_signature = None

    def status(self, state, message, **extra):
        self.bridge.call('/api/bridge/status',{'provider':'local-db','state':state,
            'message':message,'backgroundOnly':True,'historyReadVerified':bool(self.connection),
            'backgroundReadVerified':self.incremental,'incrementalVerified':self.incremental,
            'collectorHeartbeatAt':datetime.now(CN).isoformat(),**extra})

    def cycle(self):
        context = self.bridge.call('/api/bridge/context')
        selected = [g['name'] for g in context['groups'] if g['enabled']]
        if not context.get('syncEnabled') or not context.get('categories') or not selected:
            self.status('paused','同步已暂停或尚未选择群聊和类型；不读取群消息')
            return
        if not self.connection:
            self.status('connecting','正在核实微信本机数据库')
            self.connection = connect()
            self.pid_signature = tuple(sorted(self.connection[0]['WeChatDB']()._find_weixin_pids()))
        p, account_path, keys = self.connection
        processes = tuple(sorted(p['WeChatDB']()._find_weixin_pids()))
        if not processes:
            raise RuntimeError('微信进程已退出；等待登录后重新连接')
        if processes!=self.pid_signature:
            self.connection = None
            self.signatures.clear()
            raise RuntimeError('微信进程已重启；正在重新核实后台连接')
        if set(relevant_files(account_path))-set(keys):
            self.connection = None
            self.signatures.clear()
            raise RuntimeError('发现新的微信数据库分片；正在重新认证，不跳过未验证分片')
        account = hashlib.sha256(account_path.name.encode()).hexdigest()[:16]
        saved_account = self.queue.db.execute("SELECT value FROM meta WHERE key='account'").fetchone()
        if saved_account and saved_account[0]!=account:
            raise RuntimeError('微信账号发生变化；暂停读取，需在项目内确认账号')
        with self.queue.db:
            self.queue.db.execute("INSERT OR IGNORE INTO meta VALUES('account',?)",(account,))
        verified = self.queue.db.execute("SELECT value FROM meta WHERE key='incrementalVerified'").fetchone()
        self.incremental = self.incremental or bool(verified and verified[0]=='1')
        # Refresh metadata only, with no private-conversation previews.
        rooms = groups(p,keys)
        if self.last_discovery != context.get('discoveryRequestedAt') or not self.last_checked:
            names = sorted({r['nick_name'] for r in rooms if isinstance(r['nick_name'],str) and r['nick_name'] and len(r['nick_name'])<=120})
            self.bridge.call('/api/bridge/discover',{'groups':names,'complete':True,
                'message':'已读取本机数据库群聊名单；新增群默认不选择'})
            self.last_discovery = context.get('discoveryRequestedAt')
        fresh_count, added = 0, 0
        delivery_error = None
        for name in selected:
            current = self.bridge.call('/api/bridge/context')
            if not current['syncEnabled'] or not current['categories'] or not any(g['name']==name and g['enabled'] for g in current['groups']):
                continue
            date_range = current.get('messageDateRange') or {'start':None,'end':None}
            scope = json.dumps(date_range,sort_keys=True) if date_range.get('start') or date_range.get('end') else ''
            matching = [r for r in rooms if r['nick_name']==name]
            if len(matching)!=1:
                raise RuntimeError('群名未唯一匹配：'+name)
            gid = matching[0]['username']
            binding = self.queue.db.execute('SELECT group_id FROM bindings WHERE account=? AND name=?',(account,name)).fetchone()
            if binding and binding[0]!=gid:
                raise RuntimeError('群身份变化，需要在项目内重新确认：'+name)
            with self.queue.db:
                self.queue.db.execute('INSERT OR IGNORE INTO bindings VALUES(?,?,?)',(account,name,gid))
            table = 'Msg_'+hashlib.md5(gid.encode()).hexdigest()
            initial = []
            for path,key in keys.items():
                if path.name=='contact.db':
                    continue
                shard = path.name
                wal = Path(str(path)+'-wal')
                signature = tuple((x.stat().st_size,x.stat().st_mtime_ns) if x.exists() else None for x in (path,wal))
                cursor = self.queue.cursor(account,gid,shard,scope)
                marker = (account,gid,shard,scope)
                if cursor and self.signatures.get(marker)==signature and self.last_request==context.get('syncRequestedAt'):
                    continue
                conn = snapshot(path,key,p)
                try:
                    if not conn.execute('SELECT 1 FROM sqlite_master WHERE name=?',(table,)).fetchone():
                        continue
                    rows = read_rows(conn,table,cursor,date_range)
                    rows = [dict(r,_shard=shard) for r in rows]
                    if cursor or scope:
                        messages = [m for r in rows if (m:=normalize(r,account,gid,name,p,current['recentMessages']))]
                        self.queue.commit(account,gid,name,shard,rows,messages,scope)
                        fresh_count += len(messages)
                        if messages and cursor and not scope:
                            self.incremental = True
                            with self.queue.db:
                                self.queue.db.execute("INSERT INTO meta VALUES('incrementalVerified','1') ON CONFLICT(key) DO UPDATE SET value='1'")
                    else:
                        initial.extend(rows)
                    # A full page may have more backlog: re-read until drained.
                    if len(rows)<300:
                        self.signatures[marker]=signature
                finally:
                    conn.close()
            if initial:
                chosen = sorted(initial,key=lambda r:(r['sort_seq'],r['_shard'],r['local_id']),reverse=True)[:300]
                for shard in {r['_shard'] for r in initial}:
                    watermark_rows = [r for r in initial if r['_shard']==shard]
                    messages = [m for r in chosen if r['_shard']==shard and (m:=normalize(r,account,gid,name,p,current['recentMessages']))]
                    self.queue.commit(account,gid,name,shard,watermark_rows,messages)
                    fresh_count += len(messages)
            while (jobs:=self.queue.pending(account,gid,date_range=date_range)):
                current = self.bridge.call('/api/bridge/context')
                if not current['syncEnabled'] or not current['categories'] or not any(g['name']==name and g['enabled'] for g in current['groups']) or current.get('messageDateRange',{'start':None,'end':None})!=date_range:
                    break
                self.status('syncing','正在用 DeepSeek 整理已选群消息',pendingMessages=len(jobs))
                try:
                    result = self.bridge.call('/api/import',{'group':name,'extraction':'local','messageDateRange':date_range,'messages':[json.loads(x[1]) for x in jobs]})
                except HTTPError as exc:
                    delivery_error = exc
                    break  # A failing group cannot prevent other selected groups from being read.
                self.queue.done([x[0] for x in jobs])
                added += result.get('added',0)
        self.last_checked = time.time()
        self.last_request = context.get('syncRequestedAt')
        if delivery_error:
            raise delivery_error
        self.status('ready','后台历史读取与事务整理已完成；持续增量采集中' if self.incremental else '后台历史读取与事务整理已完成；等待真实新消息验证增量',
            lastCheckedAt=datetime.now(CN).isoformat(),lastCheckNewMessages=fresh_count,
            lastAddedTasks=added,lastCheckOutcome='incremental_verified' if self.incremental else 'history_verified',pendingMessages=0)


def run(once=False):
    worker = Worker()
    # A Windows named mutex prevents competing standalone workers.
    import ctypes
    k = ctypes.WinDLL('kernel32',use_last_error=True)
    k.CreateMutexW.restype = ctypes.c_void_p
    mutex = k.CreateMutexW(None,False,'Local\\ShishiBackgroundReader-'+hashlib.sha256(str(ROOT).encode()).hexdigest()[:16])
    if not mutex or ctypes.get_last_error()==183:
        return
    failures = 0
    while True:
        try:
            worker.cycle()
            failures = 0
        except Exception as exc:
            failures += 1
            # Keep failed AI jobs; don't expose provider bodies, paths or secrets.
            message = str(exc) if isinstance(exc,RuntimeError) else '后台读取或整理暂时失败（'+type(exc).__name__+'），队列已保留并将重试'
            try:
                worker.status('blocked',message,lastCheckOutcome='retry_pending')
            except Exception:
                pass
            if not isinstance(exc,HTTPError):
                worker.connection=None
                worker.signatures.clear()
        if once:
            break
        time.sleep(min(60,5*2**min(failures,4)))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--once',action='store_true')
    run(parser.parse_args().once)
