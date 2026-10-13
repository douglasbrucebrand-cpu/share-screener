"""Runs the analyst-call tests (tests/calls_test.js) as part of the normal test run.

Run: .venv/bin/python -m unittest -v tests.test_calls_js   (needs Node.js)
"""
import os
import shutil
import subprocess
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))


@unittest.skipUnless(shutil.which("node"), "Node.js is needed to test calls.js")
class CallsTest(unittest.TestCase):
    def test_calls_helpers(self):
        proc = subprocess.run(["node", os.path.join(HERE, "calls_test.js")], capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertNotIn("FAIL", proc.stdout)


if __name__ == "__main__":
    unittest.main()
