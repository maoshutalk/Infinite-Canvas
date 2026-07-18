"""JSON pass-through routes for the Video Index plugin.

These forward requests to VI's public FastAPI contract on whatever
base_url is configured. No transformation; if VI changes a payload
shape, we let it pass through unchanged. Cache-Control is set on the
JSONResponse so IC's reverse-proxy and browser cache behave correctly.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from .client import vi_get, ViUnreachable
from .config import ViConfig

router = APIRouter(prefix="/api/vi", tags=["video-index-plugin"])


def _cfg(request: Request) -> ViConfig:
    return getattr(request.app.state, "vi_config", ViConfig(False, "", 30, 60))


async def _proxy_json(request: Request, path: str, *, params: Optional[dict] = None,
                      cache_max_age: Optional[int] = None, no_store: bool = False) -> JSONResponse:
    cfg = _cfg(request)
    if not cfg.enabled:
        raise HTTPException(status_code=409, detail="Video Index plugin disabled")
    try:
        status, body, _ = await vi_get(path, params=params, config=cfg)
    except ViUnreachable as e:
        raise HTTPException(status_code=503, detail=f"Video Index unreachable: {e}") from None
    headers = {"Cache-Control": "no-store"} if no_store else {}
    if cache_max_age is not None and not no_store:
        headers["Cache-Control"] = f"private, max-age={cache_max_age}"
    return JSONResponse(content=body, status_code=status, headers=headers)


@router.get("/health")
async def health(request: Request):
    cfg = _cfg(request)
    if not cfg.enabled:
        raise HTTPException(409, "Video Index plugin disabled")
    try:
        status, body, _ = await vi_get("/api/sources", config=cfg)
        return {"ok": status == 200, "detail": body, "status": status}
    except ViUnreachable as e:
        return {"ok": False, "detail": str(e), "status": 503}


@router.get("/sources")
async def list_sources(request: Request):
    cfg = _cfg(request)
    return await _proxy_json(request, "/api/sources", cache_max_age=cfg.cache_ttl_s)


@router.get("/sources/{source_id}")
async def get_source(source_id: str, request: Request):
    cfg = _cfg(request)
    return await _proxy_json(request, f"/api/sources/{source_id}", cache_max_age=cfg.cache_ttl_s)


@router.get("/library")
async def library(request: Request, type: Optional[str] = None,
                  limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                  sort: Optional[str] = None, tags: Optional[str] = None,
                  date_from: Optional[str] = None, date_to: Optional[str] = None,
                  duration_min: Optional[float] = None, duration_max: Optional[float] = None,
                  source_id: Optional[str] = None):
    cfg = _cfg(request)
    params = {k: v for k, v in dict(type=type, limit=limit, offset=offset, sort=sort, tags=tags,
                                     date_from=date_from, date_to=date_to,
                                     duration_min=duration_min, duration_max=duration_max).items()
              if v is not None}
    if source_id:
        params["source_id"] = source_id
    return await _proxy_json(request, "/api/library", params=params, cache_max_age=cfg.cache_ttl_s)


@router.get("/assets/{asset_id}")
async def asset_detail(asset_id: str, request: Request):
    cfg = _cfg(request)
    return await _proxy_json(request, f"/api/assets/{asset_id}", cache_max_age=cfg.cache_ttl_s)


@router.get("/assets/{asset_id}/caption")
async def asset_caption(asset_id: str, request: Request):
    return await _proxy_json(request, f"/api/assets/{asset_id}/caption")


@router.get("/assets/{asset_id}/frames")
async def asset_frames(asset_id: str, request: Request):
    return await _proxy_json(request, f"/api/assets/{asset_id}/frames")


@router.get("/search")
async def search(request: Request, q: str = Query(..., min_length=1), mode: str = "lexical",
                 limit: int = Query(50, ge=1, le=100), media_type: Optional[str] = None):
    params = {"q": q, "mode": mode, "limit": limit}
    if media_type:
        params["media_type"] = media_type
    return await _proxy_json(request, "/api/search", params=params, no_store=True)
