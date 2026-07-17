"""
Locate and load the comfyui-mcp server's config file.

Mirrors comfyui-mcp/src/config.ts loadConfig():
- macOS:   ~/Library/Application Support/comfyui-mcp/config.json
- Windows: %APPDATA%/comfyui-mcp/config.json
- Linux:   ~/.config/comfyui-mcp/config.json

We never spawn the MCP process. We only read this file at request time.
"""

import json
import os
import platform
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

DEFAULT_COMFYUI_URL = "http://127.0.0.1:8188"


@dataclass
class Config:
    exists: bool
    path: Path
    workflows_dir: Optional[Path]
    comfyui_url: Optional[str]
    comfyui_url_default: str
    raw: Optional[dict]
    error: Optional[str]


def resolve_config_path() -> Path:
    """Return the platform-specific path to the MCP config.json (may not exist)."""
    system = platform.system()
    if system == "Darwin":
        return Path.home() / "Library" / "Application Support" / "comfyui-mcp" / "config.json"
    if system == "Windows":
        appdata = os.environ.get("APPDATA") or str(Path.home())
        return Path(appdata) / "comfyui-mcp" / "config.json"
    # Linux and others
    return Path.home() / ".config" / "comfyui-mcp" / "config.json"


def load_config(path: Path) -> Config:
    """Read MCP config.json and populate a Config dataclass.

    Behavior:
    - File missing: exists=False, urls/dirs None, error=None.
    - File present, valid JSON: populate fields; comfyui_url from config or default.
    - File present, invalid JSON: exists=True, error=parse message, comfyui_url=default.
    - workflowsDir may be absolute or relative; we leave it as Path and resolve later.
    """
    if not path.exists():
        return Config(
            exists=False,
            path=path,
            workflows_dir=None,
            comfyui_url=None,
            comfyui_url_default=DEFAULT_COMFYUI_URL,
            raw=None,
            error=None,
        )

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return Config(
            exists=True,
            path=path,
            workflows_dir=None,
            comfyui_url=DEFAULT_COMFYUI_URL,
            comfyui_url_default=DEFAULT_COMFYUI_URL,
            raw=None,
            error=f"Failed to parse {path}: {exc}",
        )

    if not isinstance(raw, dict):
        return Config(
            exists=True,
            path=path,
            workflows_dir=None,
            comfyui_url=DEFAULT_COMFYUI_URL,
            comfyui_url_default=DEFAULT_COMFYUI_URL,
            raw=None,
            error=f"{path} root is not a JSON object",
        )

    comfyui_section = raw.get("comfyui") if isinstance(raw.get("comfyui"), dict) else {}
    url = comfyui_section.get("url") if isinstance(comfyui_section.get("url"), str) else None
    url = url or DEFAULT_COMFYUI_URL

    workflows_dir_raw = raw.get("workflowsDir")
    workflows_dir: Optional[Path] = None
    if isinstance(workflows_dir_raw, str) and workflows_dir_raw.strip():
        workflows_dir = Path(workflows_dir_raw).expanduser()

    return Config(
        exists=True,
        path=path,
        workflows_dir=workflows_dir,
        comfyui_url=url,
        comfyui_url_default=DEFAULT_COMFYUI_URL,
        raw=raw,
        error=None,
    )


def match_instance(url: Optional[str], instances: List[str]) -> Optional[str]:
    """Return the host:port from `instances` that equals the normalized URL.

    Normalization: lowercase, strip http(s):// prefix, strip trailing slash.
    Returns None if url is None or no instance matches.
    """
    if not url:
        return None
    norm = url.strip().lower()
    for prefix in ("http://", "https://"):
        if norm.startswith(prefix):
            norm = norm[len(prefix):]
    norm = norm.rstrip("/")
    return norm if norm in instances else None