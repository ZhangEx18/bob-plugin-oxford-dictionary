from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PipelinePaths:
    build_root: Path
    output_root: Path
    db_path: Path
    dict_dir: Path
    manifest_path: Path


@dataclass(frozen=True)
class BuildContext:
    mdx_path: Path
    paths: PipelinePaths


JsonDict = dict[str, Any]

