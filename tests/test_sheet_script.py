"""Runs the Google Sheet script tests (tests/sheet_script_test.js) as part of the normal test run.

Run: .venv/bin/python -m unittest -v tests.test_sheet_script   (needs Node.js)
"""
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(shutil.which("node"), "Node.js is needed to test the Google Sheet script")
class SheetScriptTest(unittest.TestCase):
    def test_google_sheet_script(self):
        proc = subprocess.run(["node", os.path.join(HERE, "sheet_script_test.js")], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertNotIn("FAIL", proc.stdout)


if __name__ == "__main__":
    unittest.main()
