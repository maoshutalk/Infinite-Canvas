"""Project VI sources into IC's asset_library.json.

Reads VI `/api/sources` and creates/updates/removes IC library nodes
prefixed `vi_<source_id>`. Default IC libraries are never touched.
Idempotent across process restarts.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from time import time
from typing import Callable, Awaitable, Optional

from .client import vi_get, ViUnreachable
from .config import load_vi_config


logger = logging.getLogger(__name__)


VI_LIBRARY_TYPE = "remote_video_index"
VI_PLUGIN_TAG = "vi"
VI_LIBRARY_PREFIX = "vi_"

_VI_CATEGORIES = [
    {"id": "video", "name": "视频", "type": "video"},
    {"id": "image", "name": "图片", "type": "image"},
    {"id": "music", "name": "音乐", "type": "music"},
    {"id": "audio", "name": "音频", "type": "audio"},
]


async def sync_vi_libraries(settings: Optional[dict] = None,
                            *,
                            library_path: Optional[Path] = None,
                            vi_get_fn: Callable[..., Awaitable] = vi_get,
                            ) -> None:
    """Reconcile VI sources with IC asset_library.json.

    Parameters
    ----------
    settings : dict, optional
        Storage settings dict. If omitted, `load_vi_config(settings_dict)`
        uses defaults.
    library_path : Path, optional
        Override the asset_library.json path. main.py passes
        DATA_DIR/asset_library.json. When None (test/dev), sync is
        a no-op — there is nothing to reconcile.
    vi_get_fn : callable, optional
        Injection point for tests.

    Notes
    -----
    Network failures and VI errors are logged as warnings; they never
    raise. Any VI library node whose source id is missing from the
    current /api/sources response is removed — higher orchestration
    layers may apply a "consecutive empty polls" rule before calling.
    """
    if library_path is None:
        logger.debug("VI sync: no library_path; skipping")
        return

    cfg = load_vi_config(settings or {})
    if not cfg.enabled:
        logger.debug("VI plugin disabled; sync skipped")
        return

    try:
        lib = json.loads(library_path.read_text("utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        logger.warning("VI sync: cannot read %s; skipping", library_path)
        return

    libraries = lib.get("libraries") if isinstance(lib.get("libraries"), list) else []

    # Network call: if VI is unreachable we keep the existing VI nodes
    # and return — preserves state across transient outages.
    try:
        status, body, _ = await vi_get_fn("/api/sources", config=cfg)
    except ViUnreachable as e:
        logger.warning("VI sync: unreachable, keeping existing nodes: %s", e)
        return
    if status != 200 or not isinstance(body, dict):
        logger.warning("VI sync: unexpected status %s, skipping", status)
        return

    vi_items = body.get("items") or []
    vi_ids = {item["id"] for item in vi_items if isinstance(item, dict)
              and isinstance(item.get("id"), str)}

    # 1) Update existing, add new
    seen_ids = set()
    for item in vi_items:
        if not isinstance(item, dict):
            continue
        sid = item.get("id")
        if not isinstance(sid, str) or not sid:
            continue
        lib_id = f"{VI_LIBRARY_PREFIX}{sid}"
        seen_ids.add(lib_id)
        node = {"id": lib_id,
                "name": str(item.get("display_name") or sid),
                "type": VI_LIBRARY_TYPE,
                "plugin": VI_PLUGIN_TAG,
                "readonly": True,
                "categories": [dict(c) for c in _VI_CATEGORIES]}
        # Replace in place if exists, otherwise append.
        replaced = False
        for i, l in enumerate(libraries):
            if isinstance(l, dict) and l.get("id") == lib_id:
                libraries[i] = node
                replaced = True
                break
        if not replaced:
            libraries.append(node)

    # 2) Remove VI nodes not seen in this run.
    # Per the brief's test contract: any VI node whose source id does not
    # appear in the current /api/sources response is removed. The
    # "consecutive empty polls" rule from spec §3.B lives at a higher
    # orchestration layer, not here.
    libraries = [l for l in libraries
                 if not (isinstance(l, dict)
                         and l.get("id", "").startswith(VI_LIBRARY_PREFIX)
                         and l.get("id") not in seen_ids)]

    lib["libraries"] = libraries
    lib["updated_at"] = int(time() * 1000)

    library_path.write_text(json.dumps(lib, ensure_ascii=False, indent=2),
                            encoding="utf-8")
