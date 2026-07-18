import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration import router_settings


def _setup_client(data_dir):
    app = FastAPI()
    app.include_router(router_settings.router)
    # Inject data_dir via env var so router can locate storage_settings.json.
    os.environ["INFINITE_CANVAS_DATA_DIR"] = str(data_dir)
    return TestClient(app)


class ViSettingsRouterTests(unittest.TestCase):
    def test_get_returns_defaults_when_missing(self):
        with tempfile.TemporaryDirectory() as td:
            r = _setup_client(td).get("/api/vi/settings")
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertFalse(body["enabled"])
        self.assertEqual(body["base_url"], "http://127.0.0.1:8000")
        self.assertEqual(body["timeout_s"], 30)
        self.assertEqual(body["cache_ttl_s"], 60)

    def test_patch_writes_video_index_preserves_dirs(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "storage_settings.json"
            p.write_text(json.dumps({"dirs": {"upload": "/var/data/input",
                                              "generated": "/var/data/output",
                                              "local": "/var/data/local"}}, ensure_ascii=False),
                         encoding="utf-8")
            client = _setup_client(td)
            r = client.patch("/api/vi/settings",
                             json={"enabled": True, "base_url": "http://my-vi:8000"})
            self.assertEqual(r.status_code, 200)
            data = json.loads(p.read_text("utf-8"))
            self.assertTrue(data["video_index"]["enabled"])
            self.assertEqual(data["video_index"]["base_url"], "http://my-vi:8000")
            # dirs preserved
            self.assertEqual(data["dirs"]["upload"], "/var/data/input")
            self.assertEqual(data["dirs"]["generated"], "/var/data/output")
            self.assertEqual(data["dirs"]["local"], "/var/data/local")
