import os
import sys
import unittest

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


if __name__ == "__main__":
    unittest.main()