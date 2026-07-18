import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration import router_media
from app_vi_integration.config import ViConfig


def _client_with_config(cfg):
    app = FastAPI()
    app.include_router(router_media.router)
    app.state.vi_config_provider = lambda: cfg
    return TestClient(app)


class StreamTests(unittest.TestCase):
    def test_stream_passes_through_range(self):
        cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
        async def _gen(_resp): yield b"hello-bytes"

        async def fake_stream(asset_id, kind, *, request_headers, config):
            return 206, _gen(None), {"etag": '"v1"', "content-range": "bytes 0-10/100"}

        with patch("app_vi_integration.router_media.vi_stream",
                   new=fake_stream):
            client = _client_with_config(cfg)
            r = client.get("/api/vi/assets/abc/stream",
                           headers={"range": "bytes=0-10"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.content, b"hello-bytes")
        self.assertEqual(r.headers.get("etag"), '"v1"')

    def test_disabled_returns_409(self):
        cfg = ViConfig(False, "", 30, 60)
        r = _client_with_config(cfg).get("/api/vi/assets/abc/thumbnail")
        self.assertEqual(r.status_code, 409)
