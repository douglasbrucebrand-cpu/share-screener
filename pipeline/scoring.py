"""Exact Python port of momentum() and fundamentals() from tech-growth-screener.html.

The aim is bit-for-bit agreement with the original JavaScript, so a few JS
behaviours are reproduced on purpose:
  * Math.round rounds halves up (Python's round() rounds halves to even).
  * Number.toFixed(0) rounds halves away from zero on the exact binary value.
  * Sums run left to right from 0 (Python 3.12+'s sum() compensates for
    rounding error, which JS's reduce does not).
  * `x || 1` treats 0, NaN and null as false.
  * Division by zero gives Infinity/NaN rather than raising an error.

Missing values: a missing number is passed in as NaN (or None), which behaves
like JavaScript's NaN, so the rule that depends on it simply does not pass.
"""
import math
from decimal import Decimal, ROUND_HALF_UP

NAN = float("nan")


# ---------- JavaScript-compatible helpers ----------

def _num(x):
    """None -> NaN, otherwise float."""
    return NAN if x is None else float(x)


def _truthy(x):
    """JavaScript truthiness for numbers / null."""
    return x is not None and x == x and x != 0


def _div(a, b):
    """JavaScript division (no ZeroDivisionError)."""
    if b != 0:
        return a / b
    if a == 0 or a != a or b != b:
        return NAN
    return math.copysign(math.inf, a) * math.copysign(1.0, b)


def js_round(x):
    """Math.round: nearest integer, halves go up."""
    r = math.floor(x)
    return int(r + 1) if x - r >= 0.5 else int(r)


def js_to_fixed0(x):
    """Number.prototype.toFixed(0)."""
    if x != x:
        return "NaN"
    if math.isinf(x):
        return "Infinity" if x > 0 else "-Infinity"
    return str(Decimal(x).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def sma(a, n):
    if len(a) < n:
        return None
    total = 0
    for v in a[-n:]:
        total += v
    return total / n


def max_dd(a):
    peak, dd = a[0], 0
    for v in a:
        if v > peak:
            peak = v
        d = _div(v - peak, peak)
        if d < dd:
            dd = d
    return dd


def _clamp_round(score):
    return js_round(max(0, min(100, score)))


# ---------- scoring (ported line for line) ----------

def momentum(closes, volumes):
    """closes/volumes: lists in date order, oldest first.

    Returns dict with score, sig (list of [label, cls]), ret1m, ret3m, vsSMA50.
    """
    c = [_num(x) for x in closes]
    v = [x if _truthy(x) else 0 for x in (_num(x) for x in volumes)]
    if len(c) < 60:
        return {"score": None, "sig": [], "ret1m": None, "ret3m": None, "vsSMA50": None}
    last = c[-1]
    s20 = sma(c, 20)
    s50 = sma(c, 50)
    # (The original also computes a 100-day average here but never uses it.)
    s50_prev = sma(c[: len(c) - 20], 50)
    ret1m = _div(last, c[len(c) - 22]) - 1
    ret3m = _div(last, c[len(c) - 64]) - 1 if len(c) >= 64 else None
    dd1m = max_dd(c[-22:])
    vol10 = sma(v, 10)
    vol50 = sma(v, 50)
    vol_ratio = _div(vol10, vol50) if _truthy(vol50) else 1
    vs_sma50 = _div(last, s50) - 1 if _truthy(s50) else None

    score = 0
    sig = []
    if _truthy(s50) and last > s50:
        score += 20
        sig.append(["Above 50-day", "g"])
    if _truthy(s20) and _truthy(s50) and s20 > s50:
        score += 15
        sig.append(["Short trend up", "g"])
    if _truthy(s50) and _truthy(s50_prev) and s50 > s50_prev:
        score += 15
        sig.append(["50-day rising", "g"])
    if ret1m > 0:
        score += min(20, ret1m / 0.12 * 20)
        sig.append([f"1M {js_to_fixed0(ret1m * 100)}%", "g" if ret1m > 0.03 else ""])
    if dd1m > -0.08:
        score += 15
        sig.append(["Steady", "g"])
    if vol_ratio > 1.05:
        score += 10
        sig.append(["Volume rising", "g"])
    if vs_sma50 is not None:
        if vs_sma50 < 0.25:
            score += 5
        elif vs_sma50 > 0.35:
            sig.append(["Overextended", "w"])
    return {"score": _clamp_round(score), "sig": sig, "ret1m": ret1m, "ret3m": ret3m, "vsSMA50": vs_sma50}


def fundamentals(years):
    """years: list of dicts {rev, gp, ni}, NEWEST FIRST (as the original expects).

    Returns dict with score, sig, revg.
    """
    if not years or len(years) < 2:
        return {"score": None, "sig": [], "revg": None}
    y = [{k: _num(r.get(k)) for k in ("rev", "gp", "ni")} for r in years]

    def denom(x):
        return abs(x if _truthy(x) else 1)

    revg = _div(y[0]["rev"] - y[1]["rev"], denom(y[1]["rev"]))
    revg_prev = _div(y[1]["rev"] - y[2]["rev"], denom(y[2]["rev"])) if len(y) >= 3 else None
    gm0 = _div(y[0]["gp"], y[0]["rev"]) if _truthy(y[0]["rev"]) else None
    gm1 = _div(y[1]["gp"], y[1]["rev"]) if _truthy(y[1]["rev"]) else None

    score = 0
    sig = []
    if math.isfinite(revg):
        score += max(0, min(50, revg / 0.30 * 50))
        sig.append([f"Rev {js_to_fixed0(revg * 100)}%", "g" if revg > 0.1 else ""])
    if revg_prev is not None and revg > revg_prev:
        score += 25
        sig.append(["Accelerating", "g"])
    if gm0 is not None and gm1 is not None and gm0 > gm1:
        score += 25
        sig.append(["Margins up", "g"])
    return {"score": _clamp_round(score), "sig": sig, "revg": revg}


def composite(mom_score, fund_score):
    """0.6 momentum + 0.4 fundamentals; momentum only if fundamentals missing."""
    if mom_score is None:
        return None
    if fund_score is None:
        return mom_score
    return js_round(0.6 * mom_score + 0.4 * fund_score)
