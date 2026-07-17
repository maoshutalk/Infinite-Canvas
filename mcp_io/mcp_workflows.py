"""
List and import workflows from the comfyui-mcp workflowsDir.

list_workflows: read-only scan, returns metadata + per-file format detection.
import_workflow: read file, optionally convert UI->API, write to WORKFLOW_DIR/custom/.
"""

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from .ui_to_api import detect_format, ui_to_api


# Mirror main.py constants; overridden in tests via direct module attribute.
WORKFLOW_DIR = Path(__file__).resolve().parent.parent / "workflows"
CUSTOM_WORKFLOW_FOLDER = "custom"


def _title_from_name(name: str) -> str:
    stem = name
    if stem.endswith(".json"):
        stem = stem[:-5]
    for suffix in ("-ui", "-api"):
        if stem.endswith(suffix):
            stem = stem[: -len(suffix)]
    return stem


def _safe_read_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} root is not a JSON object")
    return data


def list_workflows(workflows_dir: Optional[Path]) -> Dict[str, Any]:
    """Return a list of *.json workflow files at the top level of `workflows_dir`.

    - No recursion into subdirectories.
    - Filter by `.json` extension only (excludes .py build scripts).
    - Each item: {name, format, size, mtime, title} or {name, error}.
    - Returns {"workflows": [...], "workflows_dir": str|None, "state": "ok"|"dir_missing"}.
    """
    if workflows_dir is None or not workflows_dir.exists() or not workflows_dir.is_dir():
        return {
            "workflows": [],
            "workflows_dir": str(workflows_dir) if workflows_dir else None,
            "state": "dir_missing",
        }

    items: List[Dict[str, Any]] = []
    for entry in sorted(workflows_dir.iterdir()):
        if not entry.is_file():
            continue
        if entry.suffix.lower() != ".json":
            continue
        stat = entry.stat()
        item: Dict[str, Any] = {
            "name": entry.name,
            "format": "unknown",
            "size": stat.st_size,
            "mtime": int(stat.st_mtime * 1000),
            "title": _title_from_name(entry.name),
        }
        try:
            data = _safe_read_json(entry)
            item["format"] = detect_format(data)
        except Exception as exc:
            item["error"] = str(exc)
        items.append(item)

    return {
        "workflows": items,
        "workflows_dir": str(workflows_dir),
        "state": "ok",
    }


def _collision_safe_target(stem: str, custom_dir: Path, source_mtime: float) -> str:
    """Return 'custom/<stem>.json' if free, else 'custom/<stem>_<YYYYMMDD-HHMMSS>.json'."""
    plain = custom_dir / f"{stem}.json"
    if not plain.exists():
        return f"{CUSTOM_WORKFLOW_FOLDER}/{stem}.json"
    suffix = datetime.fromtimestamp(source_mtime).strftime("%Y%m%d-%H%M%S")
    return f"{CUSTOM_WORKFLOW_FOLDER}/{stem}_{suffix}.json"


def import_workflow(workflows_dir: Path, name: str) -> Dict[str, Any]:
    """Read a workflow file from MCP, convert if UI, write to WORKFLOW_DIR/custom/.

    Raises FileNotFoundError if name is not in workflows_dir.
    Raises ValueError on invalid JSON or UI->API conversion failure.
    """
    # Path-traversal defense: reject names that escape workflows_dir.
    src_path = (workflows_dir / name).resolve()
    workflows_dir_resolved = workflows_dir.resolve()
    if (
        src_path != workflows_dir_resolved
        and workflows_dir_resolved not in src_path.parents
    ):
        raise ValueError(f"Path traversal blocked: {name}")
    if not src_path.exists():
        raise FileNotFoundError(f"{name} not found in {workflows_dir}")

    raw = _safe_read_json(src_path)
    fmt = detect_format(raw)

    if fmt == "ui":
        converted = ui_to_api(raw)
        node_count = len(converted)
        payload = converted
        converted_flag = True
    elif fmt == "api":
        payload = raw
        node_count = len(payload)
        converted_flag = False
    else:
        raise ValueError(f"Workflow format unrecognized: {fmt}")

    stem = Path(name).stem
    for sfx in ("-ui", "-api"):
        if stem.endswith(sfx):
            stem = stem[: -len(sfx)]

    custom_dir = WORKFLOW_DIR / CUSTOM_WORKFLOW_FOLDER
    custom_dir.mkdir(parents=True, exist_ok=True)

    stored_name = _collision_safe_target(stem, custom_dir, src_path.stat().st_mtime)
    target_path = WORKFLOW_DIR / stored_name
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    return {
        "name": stored_name,
        "format": fmt,
        "converted": converted_flag,
        "node_count": node_count,
    }


def import_workflows(workflows_dir: Path, names: list) -> Dict[str, Any]:
    """Import multiple workflows. Returns {results: [...], imported: int, failed: int}.

    Each result is {name, ok, stored?, format?, converted?, node_count?, error?}.
    Errors from individual files do not abort the batch — every name gets a result.
    """
    results: List[Dict[str, Any]] = []
    imported = 0
    failed = 0
    for name in names:
        if not isinstance(name, str) or not name:
            results.append({"name": str(name), "ok": False, "error": "invalid name"})
            failed += 1
            continue
        try:
            r = import_workflow(workflows_dir, name)
            results.append({
                "name": name,
                "ok": True,
                "stored": r["name"],
                "format": r["format"],
                "converted": r["converted"],
                "node_count": r["node_count"],
            })
            imported += 1
        except FileNotFoundError as exc:
            results.append({"name": name, "ok": False, "error": str(exc)})
            failed += 1
        except (ValueError, OSError) as exc:
            results.append({"name": name, "ok": False, "error": str(exc)})
            failed += 1
    return {"results": results, "imported": imported, "failed": failed}