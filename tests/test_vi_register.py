"""Regression test for register() coroutine-await fix.

register() is a sync function but sync_vi_libraries is async.
register() must execute the coroutine (e.g. via asyncio.run) — not just
create a coroutine object that is silently discarded. This test fails
on the pre-fix code: register() returns without mutating the library
file because the coroutine was never awaited.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration import register
from app_vi_integration.sync import sync_vi_libraries


class RegisterSyncRegressionTests(unittest.TestCase):
    def test_register_runs_sync_coroutine(self):
        """register() must actually execute sync_vi_libraries, not just create a coroutine."""
        async def fake_vi_get(path, *, params=None, config):
            return 200, {"items": [
                {"id": "nas", "display_name": "NAS"},
            ], "total": 1}, {}

        with tempfile.TemporaryDirectory() as td:
            lib_path = Path(td) / "asset_library.json"
            lib_path.write_text(json.dumps({
                "libraries": [{"id": "default", "name": "默认",
                               "type": "asset", "categories": []}],
                "categories": [],
                "active_library_id": "default",
                "updated_at": 0,
            }), encoding="utf-8")

            from fastapi import FastAPI
            app = FastAPI()
            # sync_vi_libraries has vi_get_fn as kwarg-only; patch the
            # function's __kwdefaults__ so the default resolves to fake.
            orig = sync_vi_libraries.__kwdefaults__.get("vi_get_fn")
            sync_vi_libraries.__kwdefaults__["vi_get_fn"] = fake_vi_get
            try:
                register(app,
                         {"video_index": {"enabled": True}},
                         library_path=lib_path)
            finally:
                sync_vi_libraries.__kwdefaults__["vi_get_fn"] = orig

            data = json.loads(lib_path.read_text("utf-8"))
            ids = {l["id"] for l in data["libraries"]}
            self.assertIn("vi_nas", ids,
                          msg="register() did not execute sync — vi_nas missing from library")
            # updated_at must have been bumped by sync
            self.assertGreater(data["updated_at"], 0)
            # default library is intact
            self.assertIn("default", ids)

    def test_register_swallows_sync_errors(self):
        """If sync raises, register() must NOT crash app startup."""
        async def fake_vi_get(path, *, params=None, config):
            raise RuntimeError("VI is down")

        with tempfile.TemporaryDirectory() as td:
            lib_path = Path(td) / "asset_library.json"
            lib_path.write_text(json.dumps({
                "libraries": [{"id": "default", "name": "默认",
                               "type": "asset", "categories": []}],
                "categories": [],
                "active_library_id": "default",
                "updated_at": 0,
            }), encoding="utf-8")

            from fastapi import FastAPI
            app = FastAPI()
            orig = sync_vi_libraries.__kwdefaults__.get("vi_get_fn")
            sync_vi_libraries.__kwdefaults__["vi_get_fn"] = fake_vi_get
            try:
                # Must NOT raise — startup must continue
                register(app,
                         {"video_index": {"enabled": True}},
                         library_path=lib_path)
            finally:
                sync_vi_libraries.__kwdefaults__["vi_get_fn"] = orig
            # App startup survived; routers still mounted
            route_paths = {r.path for r in app.routes if hasattr(r, "path")}
            self.assertIn("/api/vi/health", route_paths)


if __name__ == "__main__":
    unittest.main()