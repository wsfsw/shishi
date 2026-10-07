import sys
import tempfile
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from background_worker import Queue, normalize, read_rows, CN
import sqlite3
from datetime import datetime


class DurableQueueTests(unittest.TestCase):
    def test_date_scope_can_read_older_history_and_all_pages(self):
        conn=sqlite3.connect(':memory:')
        conn.row_factory=sqlite3.Row
        conn.execute('CREATE TABLE Msg_fixture(local_id INTEGER,sort_seq INTEGER,create_time INTEGER)')
        start=int(datetime(2026,10,6,tzinfo=CN).timestamp())
        conn.executemany('INSERT INTO Msg_fixture VALUES(?,?,?)',[(i,i,start+i) for i in range(1,401)]+[(401,401,start+86400),(0,0,start-1)])
        date_range={'start':'2026-10-06','end':'2026-10-06'}
        first=read_rows(conn,'Msg_fixture',None,date_range)
        self.assertEqual(len(first),300)
        self.assertEqual(first[0]['local_id'],1)
        second=read_rows(conn,'Msg_fixture',(first[-1]['sort_seq'],first[-1]['local_id']),date_range)
        self.assertEqual(len(second),100)
        self.assertEqual(second[-1]['local_id'],400)
        conn.close()

    def test_scoped_cursor_and_pending_dates(self):
        queue=Queue(':memory:')
        rows=[{'sort_seq':100,'local_id':10}]
        messages=[{'id':'old','sentAt':'2026-10-05T23:59:59+08:00'},
                  {'id':'start','sentAt':'2026-10-05T16:00:00Z'},
                  {'id':'last','sentAt':'2026-10-06T23:59:59+08:00'},
                  {'id':'next','sentAt':'2026-10-07T00:00:00+08:00'},
                  {'id':'unknown','sentAt':None}]
        queue.commit('a','g','群','shard',rows,messages)
        queue.commit('a','g','群','shard',[{'sort_seq':20,'local_id':2}],[],scope='past')
        self.assertEqual(queue.cursor('a','g','shard'),(100,10))
        self.assertEqual(queue.cursor('a','g','shard','past'),(20,2))
        self.assertIsNone(queue.cursor('a','g','shard','new'))
        self.assertEqual([x[0] for x in queue.pending('a','g',date_range={'start':'2026-10-06','end':'2026-10-06'})],['start','last'])
        self.assertEqual(len(queue.pending('a','g')),5)
        queue.db.close()

    def test_restart_duplicate_and_account_group_isolation(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'queue.sqlite'
            queue=Queue(path)
            rows=[{'sort_seq':10,'local_id':4}]
            message={'id':'stable-id','text':'真实原话'}
            queue.commit('a','g','群名','message_0.db',rows,[message])
            queue.commit('a','g','群名','message_0.db',rows,[message])
            self.assertEqual(len(queue.pending('a','g')),1)
            self.assertEqual(queue.pending('other','g'),[])
            self.assertEqual(queue.pending('a','other'),[])
            queue.db.close()
            queue=Queue(path)
            self.assertEqual(queue.cursor('a','g','message_0.db'),(10,4))
            self.assertEqual(len(queue.pending('a','g')),1)
            queue.done(['stable-id'])
            queue.commit('a','g','群名','message_0.db',rows,[message])
            self.assertEqual(queue.pending('a','g'),[])
            self.assertIsNone(queue.db.execute('SELECT payload FROM jobs').fetchone()[0])
            queue.db.close()

    def test_queue_and_cursor_roll_back_together(self):
        with tempfile.TemporaryDirectory() as folder:
            queue=Queue(Path(folder)/'q.sqlite')
            queue.db.execute("CREATE TRIGGER refuse BEFORE INSERT ON cursors BEGIN SELECT RAISE(ABORT,'test'); END")
            with self.assertRaises(Exception):
                queue.commit('a','g','name','shard',[{'sort_seq':1,'local_id':1}],[{'id':'id','text':'text'}])
            self.assertEqual(queue.pending('a','g'),[])
            self.assertIsNone(queue.cursor('a','g','shard'))
            queue.db.close()

    def test_real_message_identity_and_unknown_dates(self):
        row={'local_type':1,'message_content':'fixture_sender:\n明天开会','server_id':123,'_shard':'message_0.db',
             'local_id':5,'real_sender_id':9,'create_time':0}
        first=normalize(row,'account','gid','name',{},[])
        second=normalize(dict(row,_shard='message_1.db',local_id=44),'account','gid','name',{},[])
        self.assertEqual(first['id'],second['id'])
        self.assertEqual(first['text'],'明天开会')
        self.assertEqual(first['sender'],'fixture_sender')
        self.assertIsNone(first['sentAt'])
        self.assertNotEqual(first['id'],normalize(row,'account','different','name',{},[])['id'])
        self.assertIsNone(normalize(dict(row,local_type=3),'account','gid','name',{},[]))

    def test_legacy_transcription_not_recreated(self):
        row={'local_type':1,'message_content':'演示活动通知：10月8日交测试材料'}
        legacy=[{'id':'wechat-notice-fixture','group_name':'测试群'}]
        self.assertIsNone(normalize(row,'a','g','测试群',{},legacy,rules={'wechat-notice-fixture':['演示活动','测试材料']}))


if __name__=='__main__':
    unittest.main()
