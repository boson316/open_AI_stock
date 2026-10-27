"""Pure research formulas; unavailable or inapplicable inputs yield None."""
from datetime import date
import math
from .models import Fact
from .supplemental import basis


def ratio(numerator, denominator):
    if numerator is None or denominator is None or denominator <= 0:
        return None
    result = numerator / denominator
    return result if math.isfinite(result) else None


def growth(current, previous):
    r = ratio(current, previous)
    return r - 1 if r is not None else None


def cagr(start, end, start_date: date, end_date: date):
    years = (end_date - start_date).days / 365.2425
    if years <= 0 or start is None or end is None or start <= 0 or end <= 0:
        return None
    return (end / start) ** (1 / years) - 1


def ttm(facts: list[Fact]):
    if len(facts) != 4 or any(f.start is None for f in facts):
        return None
    fs = sorted(facts, key=lambda f: f.end)
    if len({(f.metric, f.unit, basis(f)) for f in fs}) != 1:
        return None
    if any(not 70 <= (f.end - f.start).days + 1 <= 105 for f in fs):
        return None
    if any((b.start - a.end).days != 1 for a, b in zip(fs, fs[1:])):
        return None
    if not 350 <= (fs[-1].end - fs[0].start).days + 1 <= 380:
        return None
    return sum(f.value for f in fs)


def free_cash_flow(ocf, capex):
    return None if ocf is None or capex is None else ocf - abs(capex)


def pe(price, eps):
    return ratio(price, eps) if price is not None and price >= 0 else None


def roic(ebit, tax, average_capital):
    if ebit is None or tax is None or not 0 <= tax <= 1:
        return None
    return ratio(ebit * (1 - tax), average_capital)


def wacc(equity, debt, cost_equity, cost_debt, tax):
    if any(x is None for x in (equity, debt, cost_equity, cost_debt, tax)):
        return None
    if min(equity, debt, cost_equity, cost_debt) < 0 or not 0 <= tax <= 1 or equity + debt <= 0:
        return None
    return (equity * cost_equity + debt * cost_debt * (1 - tax)) / (equity + debt)
