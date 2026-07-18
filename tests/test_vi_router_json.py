import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration import router_json
from app_vi_integration.config import ViConfig


def _client_with_config(cfg: ViConfig):
    app = FastAPI()
    app.include_router(router_json.router)
    @app.middleware("http")
    async def inject(request, call_next):
        request.app.state.vi_config = cfg
        return await call_next(request)
    return TestClient(app)


class HealthTests(unittest.TestCase):
    def test_health_ok(self):
        cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
        with patch("app_vi_integration.router_json.vi_get", new=AsyncMock(
            return_value=(200, {"items": [], "total": 0}, {}))):
            r = _client_with_config(cfg).get("/api/vi/health")
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()["ok"])

    def test_disabled_returns_409(self):
        cfg = ViConfig(False, "", 30, 60)
        r = _client_with_config(cfg).get("/api/vi/health")
        self.assertEqual(r.status_code, 409)
        self.assertIn("disabled", r.json()["detail"])


class SourcesTests(unittest.TestCase):
    def test_list_sources_forwards_cache_header(self):
        cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
        with patch("app_vi_integration.router_json.vi_get", new=AsyncMock(
            return_value=(200, {"items": [{"id": "s1", "display_name": "NAS"}], "total": 1},
                          {"cache-control": "private, max-age=60"}))):
            r = _client_with_config(cfg).get("/api/vi/sources")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["items"][0]["id"], "s1")
        self.assertIn("max-age=60", r.headers.get("cache-control", ""))
