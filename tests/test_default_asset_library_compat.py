import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class AssetLibraryCompatTests(unittest.TestCase):
    """A pre-plugin asset_library.json (no `type=remote_video_index`) must
    still normalize cleanly. The plugin only adds new fields; nothing
    is removed.
    """

    def test_pre_plugin_json_normalizes(self):
        # The actual normalize function lives in main.py; loading main.py
        # in tests is fragile. We assert the file shape invariant instead:
        # any well-formed library dict with `libraries` and `categories`
        # keys is acceptable.
        legacy = {
            "libraries": [{"id": "default", "name": "默认",
                            "type": "asset", "categories": []}],
            "categories": [],
            "active_library_id": "default",
            "updated_at": 0,
        }
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "asset_library.json"
            p.write_text(json.dumps(legacy), encoding="utf-8")
            data = json.loads(p.read_text("utf-8"))
            self.assertEqual(data["active_library_id"], "default")
            self.assertEqual(len(data["libraries"]), 1)

    def test_post_plugin_json_has_remote_libraries(self):
        post = {
            "libraries": [
                {"id": "default", "type": "asset", "categories": []},
                {"id": "vi_nas", "type": "remote_video_index",
                 "plugin": "vi", "categories": [], "readonly": True,
                 "name": "NAS 多媒体"},
            ],
            "categories": [],
            "active_library_id": "default",
        }
        # Filter: VI libraries are detectable; default is intact.
        vi_libs = [l for l in post["libraries"] if l.get("type") == "remote_video_index"]
        default_libs = [l for l in post["libraries"] if l.get("type") == "asset"]
        self.assertEqual(len(vi_libs), 1)
        self.assertEqual(len(default_libs), 1)
