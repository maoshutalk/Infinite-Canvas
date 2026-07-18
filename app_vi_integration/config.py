"""Video Index plugin configuration load/save."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

_DEFAULTS = {
    "enabled": False,
    "base_url": "http://127.0.0.1:8000",
    "timeout_s": 30,
    "cache_ttl_s": 60,
}

_KNOWN_KEYS = frozenset(_DEFAULTS.keys())


@dataclass(frozen=True)
class ViConfig:
    enabled: bool
    base_url: str
    timeout_s: int
    cache_ttl_s: int


def load_vi_config(settings: dict) -> ViConfig:
    raw = settings.get("video_index") or {}
    if not isinstance(raw, dict):
        raw = {}
    merged = {**_DEFAULTS, **{k: v for k, v in raw.items() if k in _KNOWN_KEYS}}
    base = str(merged["base_url"]).rstrip("/") or _DEFAULTS["base_url"]
    return ViConfig(
        enabled=bool(merged["enabled"]),
        base_url=base,
        timeout_s=int(merged["timeout_s"]) or _DEFAULTS["timeout_s"],
        cache_ttl_s=int(merged["cache_ttl_s"]) or _DEFAULTS["cache_ttl_s"],
    )


def save_vi_config(settings: dict, **updates) -> None:
    """Patch known keys only; reject unknown keys to keep dict clean."""
    cur = settings.get("video_index")
    if not isinstance(cur, dict):
        cur = {}
    for k, v in updates.items():
        if k not in _KNOWN_KEYS:
            continue
        if k == "enabled":
            cur[k] = bool(v)
        else:
            cur[k] = v
    settings["video_index"] = cur
