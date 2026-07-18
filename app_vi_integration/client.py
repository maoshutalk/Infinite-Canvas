"""Thin httpx wrapper for the Video Index FastAPI contract."""
from __future__ import annotations

import httpx
from typing import AsyncIterator, Optional, Tuple

from .config import ViConfig


class ViUnreachable(Exception):
    """Raised when the Video Index service cannot be reached."""

# Headers that must NOT be propagated back to clients when proxying.
# FastAPI / Starlette manages these; copying causes "response already
# started" or "headers already sent" runtime errors.
_RESPONSE_HEADER_DENYLIST = frozenset({
    "transfer-encoding", "content-encoding", "connection",
    "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "upgrade",
})


async def vi_get(path: str, *, params: Optional[dict] = None,
                 config: ViConfig) -> Tuple[int, dict, dict]:
    if not config.enabled:
        raise ViUnreachable("Video Index plugin disabled")
    url = f"{config.base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=config.timeout_s) as client:
            r = await client.get(url, params=params or {})
    except (httpx.RequestError, OSError) as e:
        raise ViUnreachable(str(e)) from None
    return r.status_code, r.json(), dict(r.headers)


async def vi_stream(asset_id: str, kind: str, *,
                    request_headers: dict, config: ViConfig
                    ) -> Tuple[int, AsyncIterator[bytes], dict]:
    """Stream VI asset bytes. Only `range` and the conditional headers
    are forwarded upstream. The returned (status, iter, headers) lets the
    caller build a StreamingResponse that preserves upstream semantics.
    """
    if not config.enabled:
        raise ViUnreachable("Video Index plugin disabled")
    if kind not in {"stream", "thumbnail", "preview"}:
        raise ValueError(f"unknown vi media kind: {kind}")
    forward = {}
    for h in ("range", "if-none-match", "if-modified-since"):
        v = request_headers.get(h)
        if v:
            forward[h] = v
    url = f"{config.base_url}/api/assets/{asset_id}/{kind}"

    async def _gen(resp):
        async for chunk in resp.aiter_bytes(64 * 1024):
            yield chunk

    class _CM:
        def __init__(self, cm):
            self._cm = cm
        async def __aenter__(self):
            self._resp_cm = await self._cm.__aenter__()
            return await self._resp_cm.__aenter__()
        async def __aexit__(self, *a):
            try:
                await self._resp_cm.__aexit__(*a)
            finally:
                await self._cm.__aexit__(*a)

    try:
        client = httpx.AsyncClient(timeout=config.timeout_s)
        upstream = client.stream("GET", url, headers=forward)
        outer = _CM(upstream)
        resp = await outer.__aenter__()
    except (httpx.RequestError, OSError) as e:
        raise ViUnreachable(str(e)) from None

    headers = {k: v for k, v in resp.headers.items()
               if k.lower() not in _RESPONSE_HEADER_DENYLIST}
    return resp.status_code, _gen(resp), headers
