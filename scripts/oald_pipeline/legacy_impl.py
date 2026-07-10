from __future__ import annotations

import subprocess
import sys
import warnings
from pathlib import Path
from typing import Any

from .extract_core import build_lookup_index, resolve_link_chains
from .normalize_core import parse_entry, propagate_word_families
from .relate_core import (
    LinkProcessingContext,
    build_relation_metadata,
    finalize_standalone_entries,
    materialize_missing_inflections,
    process_link_entries as process_link_context,
)
from .shard_writer import write_shards as write_shards_to
from .shared_core import *  # noqa: F403 - legacy import compatibility

warnings.warn(
    "oald_pipeline.legacy_impl is deprecated; use the staged pipeline modules",
    DeprecationWarning,
    stacklevel=2,
)


def write_shards(
    finalized_entries: dict[str, dict[str, Any]],
    total: int,
    processed: int,
    link_processed: int,
) -> None:
    output_dir = Path(OUTPUT_DIR)  # noqa: F405 - exported by shared_core
    shard_paths = write_shards_to(finalized_entries, output_dir)
    total_size = sum(path.stat().st_size for path in shard_paths)
    print(f"  Total MDX entries: {total}")
    print(f"  Non-link entries: {processed}")
    print(f"  Link entries: {link_processed}")
    print(f"  Total JSON entries: {len(finalized_entries)}")
    print(f"  Total size: {total_size / 1024 / 1024:.1f} MB")
    print(f"  Output: {output_dir}")


def process_link_entries(
    finalized_entries: dict[str, dict[str, Any]],
    final_target: dict[str, str],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
    blocked_surface_forms_by_base: dict[str, set[str]],
    lookup: dict[str, str],
) -> int:
    return process_link_context(
        LinkProcessingContext(
            finalized_entries=finalized_entries,
            final_target=final_target,
            parent_relations_map=parent_relations_map,
            relation_edges_map=relation_edges_map,
            blocked_surface_forms_by_base=blocked_surface_forms_by_base,
            lookup=lookup,
        )
    )


def main() -> int:
    script = Path(__file__).resolve().parents[1] / "build_oald_data.py"
    completed = subprocess.run(
        [sys.executable, str(script), "--stage", "all"],
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
