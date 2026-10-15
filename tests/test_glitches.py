"""One-day price glitches from Yahoo (e.g. a JSE day in rand instead of cents) must be repaired.

Run: .venv/bin/python -m unittest -v tests.test_glitches
"""
import unittest

from pipeline.fetch import repair_glitches


def rows(closes):
    return [(f"2025-04-{i + 20:02d}", c, 1000, c * 0.99, c * 1.01) for i, c in enumerate(closes)]


class GlitchTest(unittest.TestCase):
    def test_rand_instead_of_cents_is_corrected(self):
        # Standard Bank, 25/04/2025: 22768.98 cents -> 228.80 (rand) -> 23315.50 cents
        fixed, notes = repair_glitches(rows([22700, 22768.98, 228.80, 23315.50, 23400]), "SBK.JO")
        self.assertAlmostEqual(fixed[2][1], 22880.0)
        self.assertAlmostEqual(fixed[2][3], 228.80 * 0.99 * 100)    # low and high fixed too
        self.assertEqual(len(fixed), 5)
        self.assertIn("corrected", notes[0])

    def test_cents_instead_of_rand_is_corrected(self):
        fixed, _ = repair_glitches(rows([100, 101, 10150, 102, 103]))
        self.assertAlmostEqual(fixed[2][1], 101.5)

    def test_other_one_day_glitch_is_dropped(self):
        fixed, notes = repair_glitches(rows([3.0, 3.1, 0.01, 3.05, 3.2]), "QUBT")
        self.assertEqual([r[1] for r in fixed], [3.0, 3.1, 3.05, 3.2])
        self.assertIn("dropped", notes[0])

    def test_real_big_moves_are_left_alone(self):
        # a genuine crash that doesn't bounce straight back, and a genuine doubling
        for closes in ([18.23, 8.45, 8.1, 7.9], [0.48, 1.02, 1.1, 1.05], [100, 120, 90, 95]):
            fixed, notes = repair_glitches(rows(closes))
            self.assertEqual([r[1] for r in fixed], closes)
            self.assertEqual(notes, [])

    def test_latest_day_only_fixed_if_exact_cents_slip(self):
        fixed, _ = repair_glitches(rows([22700, 22768, 227.9]))          # latest day: x100 slip
        self.assertAlmostEqual(fixed[-1][1], 22790.0)
        fixed, _ = repair_glitches(rows([100, 101, 30]))                  # latest day: big but not x100
        self.assertEqual(fixed[-1][1], 30)


if __name__ == "__main__":
    unittest.main()
