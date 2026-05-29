from __future__ import annotations

from typing import Any


def validate_summary(summary: dict[str, Any]) -> None:
    metrics = summary["metrics"]
    if metrics["danglingNavigableTargets"] != 0:
        raise RuntimeError(f"danglingNavigableTargets must be 0, got {metrics['danglingNavigableTargets']}")
    if metrics["entryCount"] <= 0:
        raise RuntimeError("entryCount must be positive")
    if metrics["counts"]["standalone"] <= 0:
        raise RuntimeError("standalone count must be positive")
    if metrics["shardCount"] <= 0:
        raise RuntimeError("shardCount must be positive")

