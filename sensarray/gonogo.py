"""Templates, control limits, and Go/No-Go.

A template is a named set of metrics with control limits (e.g. "PVD 350C qual").
A mission is GO only when every limited metric is inside [LSL, USL]; a metric
that could not be computed counts as NO-GO.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class ControlLimit:
    metric: str
    lsl: float | None = None
    usl: float | None = None
    target: float | None = None

    def check(self, value: float | None) -> bool:
        if value is None:
            return False
        if self.lsl is not None and value < self.lsl:
            return False
        if self.usl is not None and value > self.usl:
            return False
        return True


@dataclass
class Template:
    name: str
    limits: list[ControlLimit] = field(default_factory=list)
    tags: dict[str, str] = field(default_factory=dict)  # which tool/chamber/recipe it applies to

    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(asdict(self), indent=2))

    @classmethod
    def load(cls, path: str | Path) -> "Template":
        d = json.loads(Path(path).read_text())
        return cls(d["name"], [ControlLimit(**c) for c in d["limits"]], d.get("tags", {}))

    @classmethod
    def from_baseline(cls, name: str, summaries: list[dict], metrics: list[str],
                      k_sigma: float = 3.0) -> "Template":
        """Create control limits as mean +/- k*sigma of known-good missions."""
        import numpy as np
        limits = []
        for m in metrics:
            v = np.array([s[m] for s in summaries if s.get(m) is not None], dtype=float)
            if v.size < 2:
                raise ValueError(f"need 2+ baseline values for {m}")
            mu, sd = float(v.mean()), float(v.std(ddof=1))
            limits.append(ControlLimit(m, mu - k_sigma * sd, mu + k_sigma * sd, mu))
        return cls(name, limits)


@dataclass
class GoNoGoResult:
    go: bool
    details: list[dict]


def evaluate(summary: dict, template: Template) -> GoNoGoResult:
    details = []
    for lim in template.limits:
        value = summary.get(lim.metric)
        ok = lim.check(value)
        details.append({"metric": lim.metric, "value": value, "lsl": lim.lsl,
                        "usl": lim.usl, "pass": ok})
    return GoNoGoResult(all(d["pass"] for d in details), details)
