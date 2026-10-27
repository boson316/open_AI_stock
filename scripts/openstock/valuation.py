"""Explicit split adjustment on a consistent per-share basis, never inferred.

Pass only verified corporate action events. A 2-for-1 event has ratio=2.
This does not attempt dividend total-return adjustment.
"""
from dataclasses import dataclass
from datetime import date
from math import isfinite


@dataclass(frozen=True)
class Split:
    effective: date
    ratio: float
    source: str

    def __post_init__(self):
        if not isfinite(self.ratio) or self.ratio <= 0 or not self.source.startswith("https://"):
            raise ValueError("Split requires positive ratio and verified source URL")


def split_factor(observed: date, basis: date, splits: list[Split]):
    if observed > basis:
        raise ValueError("Basis must be at or after observed date")
    factor = 1.0
    for split in splits:
        if observed < split.effective <= basis:
            factor *= split.ratio
    return factor


def adjust_per_share(value, observed: date, basis: date, splits: list[Split]):
    return None if value is None else value / split_factor(observed, basis, splits)
