import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration.config import load_vi_config, save_vi_config


class DefaultsTests(unittest.TestCase):
    def test_no_settings_uses_defaults(self):
        cfg = load_vi_config({})
        self.assertFalse(cfg.enabled)
        self.assertEqual(cfg.base_url, "http://127.0.0.1:8000")
        self.assertEqual(cfg.timeout_s, 30)
        self.assertEqual(cfg.cache_ttl_s, 60)

    def test_trailing_slash_stripped(self):
        cfg = load_vi_config({"video_index": {"base_url": "http://127.0.0.1:8000/"}})
        self.assertEqual(cfg.base_url, "http://127.0.0.1:8000")

    def test_unknown_keys_ignored(self):
        cfg = load_vi_config({"video_index": {"enabled": True, "hacker": "x"}})
        self.assertTrue(cfg.enabled)
        # unknown key NOT in dataclass; nothing to assert beyond passing


class SaveTests(unittest.TestCase):
    def test_save_known_keys(self):
        s = {}
        save_vi_config(s, enabled=True, base_url="http://vi.local:9000")
        self.assertTrue(s["video_index"]["enabled"])
        self.assertEqual(s["video_index"]["base_url"], "http://vi.local:9000")

    def test_save_unknown_keys_ignored(self):
        s = {}
        save_vi_config(s, enabled=True, rogue="hi")
        self.assertNotIn("rogue", s.get("video_index", {}))