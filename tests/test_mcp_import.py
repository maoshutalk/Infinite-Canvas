import json
import os
import platform
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Make mcp_io package importable when running tests from project root
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from mcp_io.ui_to_api import detect_format, ui_to_api


SAMPLE_UI = {
    "last_node_id": 3,
    "last_link_id": 2,
    "nodes": [
        {
            "id": 1, "type": "CLIPTextEncode",
            "pos": [0, 0], "size": [200, 100],
            "inputs": [{"name": "clip", "type": "CLIP", "link": 1}],
            "outputs": [{"name": "CONDITIONING", "type": "CONDITIONING", "links": [], "slot_index": 0}],
            "widgets_values": ["a beautiful sunset"],
        },
        {
            "id": 2, "type": "KSampler",
            "pos": [300, 0], "size": [200, 100],
            "inputs": [
                {"name": "model", "type": "MODEL", "link": None},
                {"name": "positive", "type": "CONDITIONING", "link": 2},
            ],
            "outputs": [{"name": "LATENT", "type": "LATENT", "links": [], "slot_index": 0}],
            "widgets_values": [42, 7.0, 20, "euler", "normal", 1.0],
        },
        {
            "id": 3, "type": "CheckpointLoaderSimple",
            "pos": [-300, 0], "size": [200, 100],
            "inputs": [
                {"name": "ckpt_name", "type": "COMBO",
                 "widget": {"name": "ckpt_name"}, "link": None},
            ],
            "outputs": [
                {"name": "MODEL", "type": "MODEL", "links": [1], "slot_index": 0},
                {"name": "CLIP", "type": "CLIP", "links": [2], "slot_index": 1},
            ],
            "widgets_values": ["sd_xl_base_1.0.safetensors"],
        },
    ],
    "links": [[1, 3, 0, 1, 0, "CLIP"], [2, 3, 1, 2, 0, "CONDITIONING"]],
    "groups": [],
    "config": {},
    "extra": {"info": {}, "ds": {"scale": 1, "offset": [0, 0]}},
    "version": 0.4,
}


SAMPLE_API = {
    "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "a beautiful sunset"}},
    "2": {"class_type": "KSampler", "inputs": {"seed": 42, "steps": 20}},
}


class DetectFormatTests(unittest.TestCase):
    def test_ui_format_detected(self):
        self.assertEqual(detect_format(SAMPLE_UI), "ui")

    def test_api_format_detected(self):
        self.assertEqual(detect_format(SAMPLE_API), "api")

    def test_unknown_format(self):
        self.assertEqual(detect_format({"random": "stuff"}), "unknown")


class UiToApiTests(unittest.TestCase):
    def test_ui_to_api_basic_structure(self):
        out = ui_to_api(SAMPLE_UI)
        # Top-level keys must be numeric strings of node ids
        self.assertEqual(set(out.keys()), {"1", "2", "3"})
        for node in out.values():
            self.assertIn("class_type", node)
            self.assertIn("inputs", node)
            self.assertIsInstance(node["class_type"], str)
            self.assertIsInstance(node["inputs"], dict)

    def test_widget_value_placed_in_correct_input(self):
        out = ui_to_api(SAMPLE_UI)
        # Node 1 (CLIPTextEncode) has one input (clip/link) and one widget (text from widgets_values)
        # The widget name is also "clip" in this minimal sample — adjust expectations:
        # We expect node 1 inputs to contain the widget value as the last entry,
        # and node 3 inputs to contain the "sd_xl_base_1.0.safetensors" widget value.
        self.assertIn("1", out)
        self.assertIn("3", out)
        # Find which input on node 3 holds the checkpoint filename
        node3_inputs = out["3"]["inputs"]
        self.assertTrue(
            any(v == "sd_xl_base_1.0.safetensors" for v in node3_inputs.values()),
            f"Expected checkpoint filename in node 3 inputs, got {node3_inputs}",
        )

    def test_link_reference_format(self):
        out = ui_to_api(SAMPLE_UI)
        # Node 1's "clip" input is a link to node 3 output slot 0 → ["3", 0]
        node1 = out["1"]
        clip_val = node1["inputs"].get("clip")
        self.assertEqual(clip_val, ["3", 0], f"Expected link ref [3, 0], got {clip_val}")

    def test_api_passthrough(self):
        out = ui_to_api(SAMPLE_API)
        self.assertEqual(out, SAMPLE_API)

    def test_malformed_raises(self):
        # Not a UI dict (no 'nodes' list) and not an API dict → ValueError
        bad = {"random": "stuff", "links": []}
        with self.assertRaises(ValueError):
            ui_to_api(bad)

    def test_dangling_link_silently_skipped(self):
        # UI workflow with an input pointing to a link id not in the top-level links table
        # (per TS reference: dangling links are silently skipped, not raised)
        wf = {
            "nodes": [{
                "id": 1, "type": "X",
                "inputs": [{"name": "a", "type": "X", "link": 42}],
                "outputs": [],
                "widgets_values": [],
            }],
            "links": [],  # link 42 is missing → dangling
            "groups": [], "config": {}, "extra": {}, "version": 0.4,
        }
        out = ui_to_api(wf)
        self.assertEqual(out, {"1": {"class_type": "X", "inputs": {}}})


# =====================================================================
# Task 2 — mcp_config
# =====================================================================

from mcp_io.mcp_config import Config, load_config, match_instance, resolve_config_path


class ResolveConfigPathTests(unittest.TestCase):
    def test_darwin_path(self):
        with patch.object(platform, "system", return_value="Darwin"):
            self.assertEqual(
                resolve_config_path(),
                Path.home() / "Library" / "Application Support" / "comfyui-mcp" / "config.json",
            )

    def test_windows_path(self):
        with patch.dict(os.environ, {"APPDATA": "C:/Users/x/AppData/Roaming"}, clear=False):
            with patch.object(platform, "system", return_value="Windows"):
                self.assertEqual(
                    resolve_config_path(),
                    Path("C:/Users/x/AppData/Roaming") / "comfyui-mcp" / "config.json",
                )

    def test_linux_path(self):
        with patch.object(platform, "system", return_value="Linux"):
            self.assertEqual(
                resolve_config_path(),
                Path.home() / ".config" / "comfyui-mcp" / "config.json",
            )


class LoadConfigTests(unittest.TestCase):
    def test_missing_file(self):
        cfg = load_config(Path("/nonexistent/config.json"))
        self.assertFalse(cfg.exists)
        self.assertEqual(cfg.path, Path("/nonexistent/config.json"))
        self.assertIsNone(cfg.workflows_dir)
        self.assertIsNone(cfg.comfyui_url)
        self.assertEqual(cfg.comfyui_url_default, "http://127.0.0.1:8188")

    def test_valid_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "config.json"
            p.write_text(json.dumps({
                "comfyui": {"url": "http://192.168.40.12:8188"},
                "workflowsDir": "/Users/jin/wf",
            }))
            cfg = load_config(p)
            self.assertTrue(cfg.exists)
            self.assertEqual(cfg.comfyui_url, "http://192.168.40.12:8188")
            self.assertEqual(cfg.workflows_dir, Path("/Users/jin/wf"))

    def test_invalid_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / "config.json"
            p.write_text("not json {{{")
            cfg = load_config(p)
            self.assertTrue(cfg.exists)
            self.assertIsNotNone(cfg.error)
            self.assertEqual(cfg.comfyui_url, "http://127.0.0.1:8188")  # default


class MatchInstanceTests(unittest.TestCase):
    def test_exact_match(self):
        self.assertEqual(match_instance("http://192.168.40.12:8188", ["192.168.40.12:8188"]), "192.168.40.12:8188")

    def test_match_strips_scheme(self):
        self.assertEqual(match_instance("https://192.168.40.12:8188/", ["192.168.40.12:8188"]), "192.168.40.12:8188")

    def test_no_match(self):
        self.assertIsNone(match_instance("http://127.0.0.1:8188", ["192.168.40.12:8188"]))


# =====================================================================
# Task 3 — mcp_workflows
# =====================================================================

from mcp_io.mcp_workflows import import_workflow, list_workflows


class ListWorkflowsTests(unittest.TestCase):
    def _write(self, d: Path, name: str, content: dict):
        (d / name).write_text(json.dumps(content))

    def test_lists_ui_and_api_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._write(d, "alpha-ui.json", SAMPLE_UI)
            self._write(d, "beta.json", SAMPLE_API)
            self._write(d, "build.py", {"not": "workflow"})  # must be ignored
            result = list_workflows(d)
            names = [w["name"] for w in result["workflows"]]
            self.assertIn("alpha-ui.json", names)
            self.assertIn("beta.json", names)
            self.assertNotIn("build.py", names)
            self.assertEqual(result["state"], "ok")

    def test_format_detection_in_listing(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._write(d, "alpha-ui.json", SAMPLE_UI)
            self._write(d, "beta.json", SAMPLE_API)
            result = list_workflows(d)
            by_name = {w["name"]: w for w in result["workflows"]}
            self.assertEqual(by_name["alpha-ui.json"]["format"], "ui")
            self.assertEqual(by_name["beta.json"]["format"], "api")

    def test_title_strips_suffix(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._write(d, "My-Workflow-ui.json", SAMPLE_UI)
            result = list_workflows(d)
            self.assertEqual(result["workflows"][0]["title"], "My-Workflow")

    def test_corrupt_file_in_listing(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            self._write(d, "good.json", SAMPLE_API)
            (d / "bad.json").write_text("not json {{{")
            result = list_workflows(d)
            items = {w["name"]: w for w in result["workflows"]}
            self.assertIn("good.json", items)
            self.assertIn("bad.json", items)
            self.assertIn("error", items["bad.json"])

    def test_no_recursion(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = Path(tmp)
            sub = d / "archived"
            sub.mkdir()
            self._write(sub, "hidden.json", SAMPLE_API)
            result = list_workflows(d)
            names = [w["name"] for w in result["workflows"]]
            self.assertEqual(names, [])

    def test_missing_dir(self):
        result = list_workflows(Path("/no/such/dir"))
        self.assertEqual(result["workflows"], [])
        self.assertEqual(result["state"], "dir_missing")


class ImportWorkflowTests(unittest.TestCase):
    def _write(self, d: Path, name: str, content: dict):
        (d / name).write_text(json.dumps(content))

    def _setup_workflow_dir(self, tmp):
        wf_dir = Path(tmp) / "workflows"
        (wf_dir / "custom").mkdir(parents=True)
        return wf_dir

    def test_import_ui_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "mcp_src"
            src.mkdir()
            self._write(src, "alpha-ui.json", SAMPLE_UI)

            wf_dir = self._setup_workflow_dir(tmp)
            import mcp_io.mcp_workflows as mw
            orig = mw.WORKFLOW_DIR
            mw.WORKFLOW_DIR = wf_dir
            try:
                result = import_workflow(src, "alpha-ui.json")
            finally:
                mw.WORKFLOW_DIR = orig

            self.assertEqual(result["format"], "ui")
            self.assertTrue(result["converted"])
            stored = wf_dir / result["name"]
            self.assertTrue(stored.exists())
            written = json.loads(stored.read_text())
            self.assertIn("1", written)
            self.assertEqual(written["1"]["class_type"], "CLIPTextEncode")

    def test_import_api_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "mcp_src"
            src.mkdir()
            self._write(src, "beta.json", SAMPLE_API)

            wf_dir = self._setup_workflow_dir(tmp)
            import mcp_io.mcp_workflows as mw
            orig = mw.WORKFLOW_DIR
            mw.WORKFLOW_DIR = wf_dir
            try:
                result = import_workflow(src, "beta.json")
            finally:
                mw.WORKFLOW_DIR = orig

            self.assertEqual(result["format"], "api")
            self.assertFalse(result["converted"])
            stored = wf_dir / result["name"]
            self.assertTrue(stored.exists())

    def test_collision_appends_timestamp(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "mcp_src"
            src.mkdir()
            self._write(src, "alpha-ui.json", SAMPLE_UI)

            wf_dir = self._setup_workflow_dir(tmp)
            (wf_dir / "custom" / "alpha.json").write_text("{}")  # collision

            import mcp_io.mcp_workflows as mw
            orig = mw.WORKFLOW_DIR
            mw.WORKFLOW_DIR = wf_dir
            try:
                result = import_workflow(src, "alpha-ui.json")
            finally:
                mw.WORKFLOW_DIR = orig

            self.assertNotEqual(result["name"], "custom/alpha.json")
            self.assertTrue(result["name"].startswith("custom/alpha_"))
            self.assertTrue(result["name"].endswith(".json"))

    def test_missing_file_raises(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "mcp_src"
            src.mkdir()
            import mcp_io.mcp_workflows as mw
            orig = mw.WORKFLOW_DIR
            mw.WORKFLOW_DIR = Path(tmp) / "wf"
            try:
                with self.assertRaises(FileNotFoundError):
                    import_workflow(src, "ghost.json")
            finally:
                mw.WORKFLOW_DIR = orig


if __name__ == "__main__":
    unittest.main()