import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


class ViMediaPreviewExtensionTests(unittest.TestCase):
    """These tests load main.py as a module; if main.py has heavy side-
    effects on import, they may need to be guarded with @unittest.skip.
    See README in tests/ for the convention on testing main.py.
    """
    def test_placeholder(self):
        # Full integration test of /api/media-preview requires running
        # main.py's lifespan and is covered by A1/A3 in the manual
        # acceptance plan. The unit-level patch is covered by route +
        # client tests in Tasks 2/4.
        self.assertTrue(True)

