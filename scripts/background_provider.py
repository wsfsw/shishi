"""Restricted read-only local database compatibility probe.

No UI automation, process writes, plaintext key caches or history exports.
Upstream reference: research/background-reader/db.py, commit
91dc0e1a601013b759b261061d8f7642f736af90. Only allowlisted definitions load.
"""
import ast
import ctypes
import hashlib
import hmac
import json
import sqlite3
import struct
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_primitives():
    source = ROOT / 'research/background-reader/db.py'
    if hashlib.sha256(source.read_bytes()).hexdigest() != 'f754f009cdf1d856e1008e02b9603d87d37f5508c504c6aac0d178287e9456af':
        raise RuntimeError('读取模块源码校验失败')
    tree = ast.parse(source.read_text(encoding='utf-8'))
    functions = {'_pbkdf2', '_aes_cbc_decrypt', '_split_key', '_verify_enc_key',
                 '_decrypt_page', '_sqlite_text_factory', '_find_account_dirs',
                 '_extract_path_from_config', '_config_candidates',
                 '_registry_data_dirs', '_locate_account_root', 'auto_detect_db_dir',
                 '_get_zstd_module', '_zstd_decompress'}
    methods = {'_collect_key_candidates', '_find_weixin_pids', '_probable_key', '_find_bytes'}
    nodes = []
    for n in tree.body:
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            if isinstance(n, ast.ImportFrom) and n.module == 'wechatauto.logger':
                continue
            nodes.append(n)
        elif isinstance(n, ast.Assign):
            # Constants and Windows read-only API signatures from audited source.
            nodes.append(n)
        elif isinstance(n, ast.FunctionDef) and n.name in functions:
            nodes.append(n)
        elif isinstance(n, ast.ClassDef) and n.name in {'_MBI', '_MODULEENTRY32W'}:
            nodes.append(n)
        elif isinstance(n, ast.ClassDef) and n.name == 'WeChatDB':
            n.body = [m for m in n.body if isinstance(m, ast.FunctionDef) and m.name in methods]
            nodes.append(n)
    namespace = {'__name__': 'shishi_readonly_primitives'}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), namespace)
    namespace['_k32'].CloseHandle.argtypes = [ctypes.c_void_p]
    return namespace


def relevant_files(account):
    base = account / 'db_storage'
    return [p for p in base.rglob('*.db') if
            p.name == 'contact.db' or
            (p.parent.name == 'message' and p.name.startswith('message_')
             and p.stem[8:].isdigit())]


def snapshot(path, key, primitives):
    """Decrypt one stable committed snapshot in RAM; never persist plaintext."""
    wal_path = Path(str(path) + '-wal')
    def stamp():
        return tuple((x.stat().st_size, x.stat().st_mtime_ns) if x.exists() else None
                     for x in (path, wal_path))
    for attempt in range(4):
        before = stamp()
        encrypted = path.read_bytes()
        wal = wal_path.read_bytes() if wal_path.exists() else b''
        if before != stamp():
            time.sleep(.1)
            continue
        if len(encrypted) % 4096:
            raise RuntimeError('数据库快照长度不完整')
        data = bytearray()
        decrypt = primitives['_decrypt_page']
        salt = key[32:] if len(key) == 48 else encrypted[:16]
        mac_key = hashlib.pbkdf2_hmac('sha512', key[:32], bytes(x ^ 0x3a for x in salt), 2, 32)
        def authenticated(page, pgno):
            start = 16 if pgno == 1 else 0
            expected = hmac.new(mac_key, page[start:4032] + struct.pack('<I', pgno), hashlib.sha512).digest()
            if not hmac.compare_digest(expected, page[4032:]):
                raise RuntimeError('数据库页认证失败；已停止读取')
            return decrypt(key, page, pgno)
        for offset in range(0, len(encrypted), 4096):
            data.extend(authenticated(encrypted[offset:offset+4096], offset//4096+1))
        if wal:
            if len(wal) < 32 or struct.unpack('>I', wal[8:12])[0] != 4096:
                raise RuntimeError('增量日志格式未通过验证')
            magic = struct.unpack('>I',wal[:4])[0]
            if magic not in (0x377f0682,0x377f0683):
                raise RuntimeError('增量日志头校验失败')
            endian = '<' if magic==0x377f0682 else '>'
            def checksum(blob, state=(0,0)):
                words=struct.unpack(endian+str(len(blob)//4)+'I',blob)
                s0,s1=state
                for i in range(0,len(words),2):
                    s0=(s0+words[i]+s1)&0xffffffff
                    s1=(s1+words[i+1]+s0)&0xffffffff
                return s0,s1
            state=checksum(wal[:24])
            if state!=struct.unpack('>II',wal[24:32]):
                raise RuntimeError('增量日志头校验失败')
            salt = wal[16:24]
            # Apply only complete transactions in the current WAL generation.
            committed, pending = [], []
            pages = None
            for offset in range(32, len(wal)-4119, 4120):
                header, page = wal[offset:offset+24], wal[offset+24:offset+4120]
                if header[8:16] != salt:
                    break
                next_state=checksum(header[:8]+page,state)
                if next_state!=struct.unpack('>II',header[16:24]):
                    break  # Uncommitted/torn tail is never applied.
                state=next_state
                pgno, commit_pages = struct.unpack('>II', header[:8])
                if not pgno or pgno > 1000000:
                    raise RuntimeError('增量日志页号异常')
                pending.append((pgno, page))
                if commit_pages:
                    committed.extend(pending)
                    pending = []
                    pages = commit_pages
            for pgno, page in committed:
                end = pgno * 4096
                if end > len(data):
                    data.extend(b'\0' * (end-len(data)))
                data[end-4096:end] = authenticated(page, pgno)
            if pages:
                data = data[:pages*4096]
        if before != stamp():
            time.sleep(.1)
            continue
        # Deserialize into SQLite-owned RAM; force SQLite to ignore external WAL.
        data[18:20] = b'\x01\x01'
        conn = sqlite3.connect(':memory:')
        try:
            conn.deserialize(bytes(data))
            conn.execute('PRAGMA query_only=ON')
            if conn.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('数据库快照完整性校验失败')
            conn.row_factory = sqlite3.Row
            conn.text_factory = primitives['_sqlite_text_factory']
            return conn
        except Exception:
            conn.close()
            raise
    raise RuntimeError('微信正在写入，无法取得一致的只读快照')


def connect():
    p = load_primitives()
    directory = p['auto_detect_db_dir']()
    if not directory:
        raise RuntimeError('未找到微信本机数据库目录')
    accounts = [Path(x) for x in p['_find_account_dirs'](directory)]
    scanner = p['WeChatDB']()
    candidates, seen = set(), set()
    for pid in scanner._find_weixin_pids():
        candidates.update(scanner._collect_key_candidates(pid, seen))
    matches = []
    for account in accounts:
        keys = {}
        for path in relevant_files(account):
            with path.open('rb') as f:
                page = f.read(4096)
            for key, salt in candidates:
                if p['_verify_enc_key'](key, page):
                    keys[path] = key
                    break
                if salt and p['_verify_enc_key'](key, page, salt=salt):
                    keys[path] = key + salt
                    break
        if any(path.name == 'contact.db' for path in keys):
            matches.append((account, keys))
    if len(matches) != 1:
        raise RuntimeError(f'数据库页认证未唯一核实账号：匹配 {len(matches)} 个；候选材料 {len(candidates)} 组')
    return p, *matches[0]


def groups(p, keys):
    contact_path = next(path for path in keys if path.name == 'contact.db')
    contact = snapshot(contact_path, keys[contact_path], p)
    try:
        return [dict(r) for r in contact.execute(
            "SELECT username,nick_name FROM contact WHERE username LIKE '%@chatroom'")]
    finally:
        contact.close()


def probe():
    p, account, keys = connect()
    from wechat_collector import Bridge
    context = Bridge().call('/api/bridge/context')
    if not context.get('syncEnabled') or not context.get('categories'):
        raise RuntimeError('同步已暂停或未选择信息类型；不读取消息')
    selected = [g['name'] for g in context['groups'] if g['enabled']]
    if not selected:
        raise RuntimeError('尚未选择群聊；不读取消息')
    rooms = groups(p, keys)
    verified = []
    for name in selected:
        matching = [r for r in rooms if r['nick_name'] == name]
        if len(matching) != 1:
            raise RuntimeError('已选群名称未唯一匹配：' + name)
        group_id = matching[0]['username']
        table = 'Msg_' + hashlib.md5(group_id.encode()).hexdigest()
        count = 0
        newest = None
        for path in keys:
            if path.name == 'contact.db':
                continue
            conn = snapshot(path, keys[path], p)
            try:
                if not conn.execute('SELECT 1 FROM sqlite_master WHERE name=?', (table,)).fetchone():
                    continue
                from background_worker import date_predicate
                clauses,values = date_predicate(context.get('messageDateRange') or {})
                where = ' WHERE '+' AND '.join(clauses) if clauses else ''
                rows = conn.execute(f'SELECT create_time,local_type,message_content FROM "{table}"{where} ORDER BY sort_seq DESC LIMIT 5',values).fetchall()
                count += len(rows)
                for row in rows:
                    newest = max(newest or 0, row['create_time'] or 0)
            finally:
                conn.close()
        verified.append({'name': name, 'sampleMessageCount': count, 'newestMessageUnixTime': newest})
    return {'phase': 'history_read_verified', 'accountFingerprint': hashlib.sha256(account.name.encode()).hexdigest()[:16],
            'verifiedDatabaseCount': len(keys), 'selectedGroups': verified,
            'backgroundReadVerified': False, 'incrementalVerified': False}


if __name__ == '__main__':
    try:
        result = probe()
    except Exception as exc:
        result = {'phase': 'blocked', 'backgroundReadVerified': False,
                  'error': str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__}
    (ROOT / 'data/background-probe.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True))
