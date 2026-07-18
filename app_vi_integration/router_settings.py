"""Video Index plugin settings endpoints.

GET /api/vi/settings   -> echo current video_index config
PATCH /api/vi/settings -> persist to INFINITE_CANVAS_DATA_DIR/storage_settings.json

storage_settings.json is shared with main.py's load_storage_settings which
only reads the `dirs` field. We preserve `dirs` and update only the
`video_index` key — a round-trip safe merge.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request

from .config import load_vi_config, save_vi_config


router = APIRouter(prefix="/api/vi", tags=["video-index-plugin-settings"])


def _settings_path(_request: Request) -> Path:
    """Locate storage_settings.json via INFINITE_CANVAS_DATA_DIR env var.

    The env var is set once by main.py's register() block (Task 3) at process
    start. Tests inject it directly.
    """
    data_dir = os.environ.get("INFINITE_CANVAS_DATA_DIR", ".")
    return Path(data_dir) / "storage_settings.json"


def _load_or_default(path: Path) -> dict:
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return {}


@router.get("/settings")
async def get_settings(request: Request):
    data = _load_or_default(_settings_path(request))
    cfg = load_vi_config(data)
    return {
        "enabled": cfg.enabled,
        "base_url": cfg.base_url,
        "timeout_s": cfg.timeout_s,
        "cache_ttl_s": cfg.cache_ttl_s,
    }


@router.patch("/settings")
async def patch_settings(payload: dict, request: Request):
    if not isinstance(payload, dict):
        raise HTTPException(400, "payload must be an object")
    path = _settings_path(request)
    data = _load_or_default(path)
    save_vi_config(data, **payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    cfg = load_vi_config(data)
    return {
        "enabled": cfg.enabled,
        "base_url": cfg.base_url,
        "timeout_s": cfg.timeout_s,
        "cache_ttl_s": cfg.cache_ttl_s,
    }
