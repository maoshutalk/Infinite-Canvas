"""
UI-format <-> API-format conversion for ComfyUI workflows.

Ports the algorithm from comfyui-mcp/src/tools/load_workflow.ts.
Pure functions, no I/O, no third-party imports.

Differences from the plan's draft algorithm:
- detect_format checks the first node's `type` field (per TS), not just `nodes` list presence
- Dangling link references are silently skipped (per TS robustness notes), not raised
- ComfyUI's "control_after_generate" hidden widget marker is stripped if present
"""

from typing import Any, Dict, Optional


# Public type aliases (informational)
ApiWorkflow = Dict[str, Dict[str, Any]]  # {node_id_str: {class_type, inputs}}

# Hidden "control_after_generate" marker values that ComfyUI appends after seed widgets
_CONTROL_MARKERS = {"fixed", "randomize", "increment", "decrement"}


def detect_format(workflow: Any) -> str:
    """Return 'ui', 'api', or 'unknown'.

    UI: top-level has 'nodes' array; if non-empty, the first node must have a 'type' string.
    API: every top-level key is a numeric string, and every value has 'class_type' (string) and 'inputs' (object).
    """
    if not workflow or not isinstance(workflow, dict):
        return "unknown"

    nodes = workflow.get("nodes")
    if isinstance(nodes, list):
        if len(nodes) == 0:
            return "ui"
        first = nodes[0]
        if isinstance(first, dict) and isinstance(first.get("type"), str):
            return "ui"

    keys = list(workflow.keys())
    if keys and all(isinstance(k, str) and k.isdigit() for k in keys):
        if all(
            isinstance(workflow[k], dict)
            and isinstance(workflow[k].get("class_type"), str)
            and isinstance(workflow[k].get("inputs"), dict)
            for k in keys
        ):
            return "api"

    return "unknown"


def ui_to_api(workflow: Any) -> ApiWorkflow:
    """Convert a UI-format ComfyUI workflow to API format.

    Algorithm (ported from comfyui-mcp/src/tools/load_workflow.ts):
      1. Build link_id -> (src_node_str, src_slot_int) lookup from top-level `links`.
      2. For each node, walk its `inputs` list:
         - input has `"widget"` field set → consume next value from `widgets_values`
         - input has non-null `"link"` → look up source via link_lookup and emit `[src_node_str, src_slot_int]`
         - else: skip (optional input with no connection)
      3. Dangling link references are silently skipped (no throw).

    Strip ComfyUI's hidden "control_after_generate" widget marker when present.

    Raises ValueError when input is not a UI or API workflow object.
    """
    if not workflow or not isinstance(workflow, dict):
        raise ValueError("uiToApi: input is not an object")

    fmt = detect_format(workflow)
    if fmt == "api":
        return workflow  # passthrough
    if fmt != "ui":
        raise ValueError(
            "Not a recognized ComfyUI workflow (neither UI nor API format)"
        )

    # Build link_id -> (src_node_str, src_slot_int) lookup
    link_lookup: Dict[int, list] = {}
    links = workflow.get("links") or []
    for link in links:
        if not isinstance(link, list) or len(link) < 3:
            continue
        link_id, src_node, src_slot = link[0], link[1], link[2]
        if isinstance(link_id, int) and src_node is not None and src_slot is not None:
            link_lookup[link_id] = [str(src_node), src_slot]

    out: ApiWorkflow = {}
    nodes = workflow.get("nodes") or []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        node_id = n.get("id")
        node_type = n.get("type")
        if node_id is None or not isinstance(node_type, str):
            continue

        widget_values: list = n.get("widgets_values") or []
        if not isinstance(widget_values, list):
            widget_values = []
        input_defs: list = n.get("inputs") or []
        if not isinstance(input_defs, list):
            input_defs = []

        # Detect hidden "control_after_generate" widget marker: appears as an extra
        # widget value right after a numeric seed when the widget input count is one less.
        widget_input_count = sum(
            1
            for inp in input_defs
            if isinstance(inp, dict) and inp.get("widget")
        )
        has_seed_control_marker = (
            len(widget_values) >= 2
            and len(widget_values) == widget_input_count + 1
            and isinstance(widget_values[0], (int, float))
            and not isinstance(widget_values[0], bool)
            and widget_values[1] in _CONTROL_MARKERS
        )
        conversion_widget_values: list = (
            [widget_values[0], *widget_values[2:]] if has_seed_control_marker else widget_values
        )

        # Walk input definitions; widget slots consume widgets_values positionally
        api_inputs: Dict[str, Any] = {}
        widget_idx = 0
        for inp in input_defs:
            if not isinstance(inp, dict):
                continue
            name = inp.get("name")
            if not isinstance(name, str):
                continue
            if inp.get("widget"):
                # Widget input — pull next value from widgets_values
                if widget_idx < len(conversion_widget_values):
                    api_inputs[name] = conversion_widget_values[widget_idx]
                    widget_idx += 1
                # else: widget defined but no value provided; skip
            elif inp.get("link") is not None:
                # Connected link — resolve via link_lookup
                found = link_lookup.get(inp["link"])
                if found is not None:
                    api_inputs[name] = found
                # else: dangling link reference; skip silently
            # else: optional input with no connection; skip

        out[str(node_id)] = {
            "class_type": node_type,
            "inputs": api_inputs,
        }

    return out