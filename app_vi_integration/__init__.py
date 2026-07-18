"""Video Index plugin for Infinite-Canvas.

Mirrors the mcp_io plugin pattern: discrete module under
app_vi_integration/ that registers itself with the FastAPI app only when
storage_settings.video_index.enabled is true.

Public surface:
    register(app, settings, library_path=None) -- call once at app startup
        (library_path is the IC asset_library.json; passed to sync_vi_libraries)
    load_vi_config(settings) -- read the dataclass
    save_vi_config(settings, **updates) -- patch the persisted dict
"""
from __future__ import annotations
from pathlib import Path
from typing import Optional

PLUGIN_ID = "vi"
PLUGIN_NAME = "Video Index"
PLUGIN_VERSION = "0.1.0"

__all__ = ["PLUGIN_ID", "PLUGIN_NAME", "PLUGIN_VERSION", "register",
           "load_vi_config", "save_vi_config"]


def register(app, settings, library_path: Optional[Path] = None):
    """Idempotent registration; no-op when the plugin is disabled.

    library_path: optional Path to IC's asset_library.json. When provided
    (by main.py at boot, with DATA_DIR/asset_library.json), this is the
    file sync_vi_libraries reconciles. When None, sync is skipped
    silently — useful for tests that exercise only the routers.
    """
    cfg = load_vi_config(settings)
    if not cfg.enabled:
        return  # silent; do not import routers
    from . import router_json as _rj, router_media as _rm
    app.include_router(_rj.router)
    app.include_router(_rm.router)
    from . import router_settings as _rs
    app.include_router(_rs.router)
    if library_path is not None:
        from .sync import sync_vi_libraries
        # sync_vi_libraries is async; register() is sync, so run it inline.
        # Errors here must NOT break app startup — log and continue.
        import asyncio
        import logging as _logging
        try:
            asyncio.run(sync_vi_libraries(settings, library_path=library_path))
        except Exception as _e:
            _logging.getLogger(__name__).warning("VI sync failed at startup: %s", _e)


# Re-exports for direct imports in tests
from .config import load_vi_config, save_vi_config  # noqa: E402
