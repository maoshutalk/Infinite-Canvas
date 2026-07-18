import asyncio
import os
import sys
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, AsyncMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration.sync import sync_vi_libraries


class SyncTests(unittest.TestCase):
    def test_creates_library_node_per_source(self):
        async def fake_vi_get(path, *, params=None, config):
            return 200, {"items": [
                {"id": "nas", "display_name": "NAS 多媒体"},
                {"id": "p2", "display_name": "Personal"},
            ], "total": 2}, {}
        with tempfile.TemporaryDirectory() as td:
            lib_path = Path(td) / "asset_library.json"
            lib_path.write_text(json.dumps({
                "libraries": [{"id": "default", "name": "默认",
                               "type": "asset", "categories": []}],
                "categories": [],
                "active_library_id": "default",
                "updated_at": 0,
            }), encoding="utf-8")

            async def run():
                await sync_vi_libraries({"video_index": {"enabled": True}},
                                       library_path=lib_path,
                                       vi_get_fn=fake_vi_get)
            asyncio.run(run())

            data = json.loads(lib_path.read_text("utf-8"))
            libs = data["libraries"]
            vi_libs = [l for l in libs if l["id"].startswith("vi_")]
            self.assertEqual(len(vi_libs), 2)
            self.assertEqual({l["id"] for l in vi_libs}, {"vi_nas", "vi_p2"})
            self.assertEqual({l["type"] for l in vi_libs}, {"remote_video_index"})
            # default library is intact
            defaults = [l for l in libs if l["id"] == "default"]
            self.assertEqual(len(defaults), 1)

    def test_deletes_removed_source_node(self):
        async def fake_vi_get(path, *, params=None, config):
            return 200, {"items": [], "total": 0}, {}
        with tempfile.TemporaryDirectory() as td:
            lib_path = Path(td) / "asset_library.json"
            lib_path.write_text(json.dumps({
                "libraries": [
                    {"id": "default", "name": "默认", "type": "asset", "categories": []},
                    {"id": "vi_old", "name": "Old", "type": "remote_video_index",
                     "plugin": "vi", "categories": []},
                ],
                "categories": [],
                "active_library_id": "default",
                "updated_at": 0,
            }), encoding="utf-8")

            async def run():
                await sync_vi_libraries({"video_index": {"enabled": True}},
                                       library_path=lib_path,
                                       vi_get_fn=fake_vi_get)
            asyncio.run(run())

            data = json.loads(lib_path.read_text("utf-8"))
            ids = {l["id"] for l in data["libraries"]}
            self.assertNotIn("vi_old", ids)
            self.assertIn("default", ids)

    def test_renames_source_keeps_id_stable(self):
        async def fake_vi_get(path, *, params=None, config):
            return 200, {"items": [
                {"id": "nas", "display_name": "NAS 新名"},
            ], "total": 1}, {}
        with tempfile.TemporaryDirectory() as td:
            lib_path = Path(td) / "asset_library.json"
            lib_path.write_text(json.dumps({
                "libraries": [
                    {"id": "vi_nas", "name": "NAS 旧名", "type": "remote_video_index",
                     "plugin": "vi", "categories": []},
                ],
                "categories": [],
                "active_library_id": "vi_nas",
                "updated_at": 0,
            }), encoding="utf-8")

            async def run():
                await sync_vi_libraries({"video_index": {"enabled": True}},
                                       library_path=lib_path,
                                       vi_get_fn=fake_vi_get)
            asyncio.run(run())

            data = json.loads(lib_path.read_text("utf-8"))
            vi = next(l for l in data["libraries"] if l["id"] == "vi_nas")
            self.assertEqual(vi["name"], "NAS 新名")
            self.assertEqual(data["active_library_id"], "vi_nas")
