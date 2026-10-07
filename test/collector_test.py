import sys
import unittest
from unittest.mock import patch
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from wechat_collector import group_name, normalize_messages, sync_selected
import wechat_collector


class CollectorTests(unittest.TestCase):
    def test_background_only_does_not_initialize_unverified_provider(self):
        class Bridge:
            def call(self, *args):
                return {'bridgeStatus': {'backgroundOnly': True, 'backgroundReadVerified': False,
                                         'provider': 'wxauto4', 'lastCheckOutcome': 'background_unsupported'}}
            def status(self, *args, **kwargs):
                raise AssertionError('Unchanged blocker should not be reported again')
        with patch.object(wechat_collector, 'Bridge', Bridge):
            wechat_collector.run(once=True, provider_factory=lambda: self.fail('UI provider initialized'))

    def test_group_identity_requires_explicit_type_and_full_name(self):
        self.assertIsNone(group_name({'name': '私人好友群'}))
        self.assertIsNone(group_name({'chat_type': 'friend', 'chat_name': '群 A'}))
        self.assertIsNone(group_name({'chat_type': 'group', 'chat_name': '项目...'}))
        self.assertEqual(group_name({'chat_type': 'group', 'chat_name': '项目群'}), '项目群')

    def test_unknown_time_is_not_collection_time_and_ids_are_stable(self):
        items = [SimpleNamespace(type='text', content='请明天开会', sender='同事'),
                 SimpleNamespace(type='image', content='[图片]', sender='同事')]
        first = normalize_messages(items, '群 A')
        self.assertEqual(len(first), 1)
        self.assertIsNone(first[0]['sentAt'])
        self.assertEqual(first, normalize_messages(items, '群 A'))
        self.assertNotEqual(first[0]['id'], normalize_messages(items, '群 B')[0]['id'])

    def test_full_timestamp_header_is_propagated(self):
        items = [SimpleNamespace(type='time', time='2026-10-06T12:30:00'),
                 SimpleNamespace(type='text', content='明天开会', sender='同事')]
        self.assertEqual(normalize_messages(items, '群')[0]['sentAt'], '2026-10-06T12:30:00+08:00')

    def test_unselected_removed_paused_or_empty_category_groups_are_not_read(self):
        class Bridge:
            def __init__(self, context): self.context, self.posts = context, []
            def status(self, *args, **kwargs): pass
            def call(self, path, payload=None):
                if payload: self.posts.append(payload)
                return self.context
        class Provider:
            def __init__(self): self.reads = []
            def read_group(self, name):
                self.reads.append(name)
                return [{'id': 'm1', 'text': '请开会', 'sender': '同事', 'sentAt': None}]
        enabled = {'syncEnabled': True, 'categories': ['会议'], 'groups': [
            {'name': '群 A', 'enabled': 1}, {'name': '群 B', 'enabled': 0}]}
        provider, bridge = Provider(), Bridge(enabled)
        sync_selected(bridge, provider, enabled)
        self.assertEqual(provider.reads, ['群 A'])
        self.assertEqual(bridge.posts[0]['extraction'], 'local')
        for current in [{**enabled, 'syncEnabled': False}, {**enabled, 'categories': []},
                        {**enabled, 'groups': []}]:
            provider = Provider()
            sync_selected(Bridge(current), provider, enabled)
            self.assertEqual(provider.reads, [])


if __name__ == '__main__':
    unittest.main()
