from __future__ import annotations

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BUILD_ROOT = PROJECT_ROOT / ".cache" / "oald-build"
DEFAULT_OUTPUT_ROOT = DEFAULT_BUILD_ROOT / "output"
DEFAULT_DB_PATH = DEFAULT_BUILD_ROOT / "build_state.sqlite"
DEFAULT_MDX_PATH = PROJECT_ROOT / "data" / "sources" / "oald" / "private" / "OALD 2024.09" / "oaldpe.mdx"

SCHEMA_VERSION = "2.0.0"
DATA_VERSION = "oald-2024.09"
PIPELINE_VERSION = "6.1.0"


def resolve_build_root(build_root: str | None = None) -> Path:
    if build_root:
        return Path(build_root).resolve()
    if os.environ.get("OALD_BUILD_ROOT"):
        return Path(os.environ["OALD_BUILD_ROOT"]).resolve()
    return DEFAULT_BUILD_ROOT


def resolve_output_root(build_root: Path) -> Path:
    if os.environ.get("OALD_OUTPUT_ROOT"):
        return Path(os.environ["OALD_OUTPUT_ROOT"]).resolve()
    return build_root / "output"


def resolve_db_path(build_root: Path) -> Path:
    return build_root / "build_state.sqlite"


def resolve_mdx_path(mdx_path: str | None = None) -> Path:
    if mdx_path:
        return Path(mdx_path).resolve()
    if os.environ.get("OALD_MDX_PATH"):
        return Path(os.environ["OALD_MDX_PATH"]).resolve()
    return DEFAULT_MDX_PATH
