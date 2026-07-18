"""Byte-stream pass-through for Video Index asset media.

The three endpoints accept GET and HEAD (HEAD is required so the canvas
can issue conditional fetches). Range requests and If-None-Match are
forwarded to VI; the upstream ETag and 304 responses are preserved.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from .client import vi_stream, ViUnreachable
from .config import ViConfig


router = APIRouter(prefix="/api/vi", tags=["video-index-plugin-media"])


_KINDS = ("stream", "thumbnail", "preview")


def _cfg(request: Request) -> ViConfig:
    provider = getattr(request.app.state, "vi_config_provider", None)
    if provider:
        return provider()
    return ViConfig(False, "", 30, 60)


def _forward_headers(request: Request) -> dict:
    h = {}
    for k in ("range", "if-none-match", "if-modified-since"):
        v = request.headers.get(k)
        if v:
            h[k] = v
    return h


@router.api_route("/assets/{asset_id}/stream",
                  methods=["GET", "HEAD"], include_in_schema=False)
async def asset_stream(asset_id: str, request: Request):
    return await _proxy_media(asset_id, "stream", request)


@router.api_route("/assets/{asset_id}/thumbnail",
                  methods=["GET", "HEAD"], include_in_schema=False)
async def asset_thumbnail(asset_id: str, request: Request):
    return await _proxy_media(asset_id, "thumbnail", request)


@router.api_route("/assets/{asset_id}/preview",
                  methods=["GET", "HEAD"], include_in_schema=False)
async def asset_preview(asset_id: str, request: Request):
    return await _proxy_media(asset_id, "preview", request)


async def _proxy_media(asset_id: str, kind: str, request: Request):
    cfg = _cfg(request)
    if not cfg.enabled:
        raise HTTPException(409, "Video Index plugin disabled")
    if kind not in _KINDS:
        raise HTTPException(404, f"unknown media kind: {kind}")
    try:
        status, body_iter, headers = await vi_stream(
            asset_id, kind,
            request_headers=_forward_headers(request),
            config=cfg,
        )
    except ViUnreachable as e:
        raise HTTPException(503, f"Video Index unreachable: {e}") from None

    if request.method == "HEAD":
        # Consume the iterator so the connection is properly released;
        # FastAPI needs a single Response for HEAD, not a stream.
        async for _ in body_iter:
            break
        return Response(status_code=status, headers=headers)

    async def gen():
        async for chunk in body_iter:
            yield chunk

    return StreamingResponse(gen(), status_code=status, headers=headers)

