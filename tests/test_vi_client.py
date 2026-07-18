import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app_vi_integration.config import ViConfig
from app_vi_integration.client import vi_get, vi_stream, ViUnreachable


class ViGetTests(unittest.TestCase):
    def test_returns_status_body_headers(self):
        async def run():
            cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
            fake_response = MagicMock()
            fake_response.status_code = 200
            fake_response.json.return_value = {"items": [{"id": "src1"}]}
            fake_response.headers = {"cache-control": "private, max-age=60"}
            with patch("app_vi_integration.client.httpx.AsyncClient") as Client:
                client_cm = Client.return_value.__aenter__.return_value
                client_cm.get = AsyncMock(return_value=fake_response)
                status, body, headers = await vi_get("/api/sources", config=cfg)
            return status, body, headers
        status, body, headers = asyncio.run(run())
        self.assertEqual(status, 200)
        self.assertEqual(body, {"items": [{"id": "src1"}]})
        self.assertIn("cache-control", {k.lower() for k in headers.keys()})

    def test_unreachable_raises(self):
        async def run():
            cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
            with patch("app_vi_integration.client.httpx.AsyncClient") as Client:
                Client.return_value.__aenter__.side_effect = OSError("connection refused")
                with self.assertRaises(ViUnreachable) as ctx:
                    await vi_get("/api/sources", config=cfg)
            return str(ctx.exception)
        msg = asyncio.run(run())
        self.assertIn("connection refused", msg)


class ViStreamTests(unittest.TestCase):
    def test_propagates_range_header(self):
        async def run():
            cfg = ViConfig(True, "http://vi.local:8000", 30, 60)
            fake_response = MagicMock()
            fake_response.status_code = 206
            fake_response.headers = {"etag": '"abc"', "content-range": "bytes 0-99/1000"}
            async def aiter_bytes(_):
                yield b"hello"
            fake_response.aiter_bytes = aiter_bytes

            class _Mgr:
                async def __aenter__(self_):
                    class _Stream:
                        async def __aenter__(inner):
                            return fake_response
                        async def __aexit__(inner, *a):
                            return False
                    return _Stream()
                async def __aexit__(self_, *a):
                    return False

            with patch("app_vi_integration.client.httpx.AsyncClient") as Client:
                Client.return_value.stream = MagicMock(return_value=_Mgr())
                status, body, headers = await vi_stream("abc123", "stream",
                                                       request_headers={"range": "bytes=0-99"},
                                                       config=cfg)
            chunks = []
            async for c in body: chunks.append(c)
            return status, b"".join(chunks), headers
        status, body, headers = asyncio.run(run())
        self.assertEqual(status, 206)
        self.assertEqual(body, b"hello")
