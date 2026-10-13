"""Runs the Google Sheet script tests (tests/sheet_script_test.js) as part of the normal test run.

Run: .venv/bin/python -m unittest -v tests.test_sheet_script   (needs Node.js)
"""
import os
import shutil
import subprocess
import tempfile
import unittest

import run_screener

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(shutil.which("node"), "Node.js is needed to test the Google Sheet script")
class SheetScriptTest(unittest.TestCase):
    def test_google_sheet_script(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "edited.json")
            out_tracked = os.path.join(tmp, "tracked.json")
            proc = subprocess.run(["node", os.path.join(HERE, "sheet_script_test.js")], capture_output=True, text=True,
                                  env=dict(os.environ, WL_OUT=out, WL_OUT_TRACKED=out_tracked))
            self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
            self.assertNotIn("FAIL", proc.stdout)
            # A watchlist edited from the website must pass the update script's own checks.
            wl = run_screener.read_watchlists(out)
            self.assertIn("MTN.JO", wl["tabs"][1]["groups"][0]["tickers"])
            # ...and so must one with a "tracked" list added by tagging a call.
            self.assertEqual(run_screener.read_watchlists(out_tracked)["tracked"], ["MTN.JO"])


if __name__ == "__main__":
    unittest.main()
