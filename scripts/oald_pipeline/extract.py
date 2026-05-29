from __future__ import annotations

from typing import Any

from readmdict import MDX

from . import extract_core as core
from .state import StateStore


def run_extract(mdx_path: str, store: StateStore) -> dict[str, Any]:
    core.MDX_PATH = mdx_path
    mdx = MDX(mdx_path, encoding="utf-8")
    lookup, alias_targets, total = core.build_lookup_index(mdx)
    final_target = core.resolve_link_chains(lookup, alias_targets)

    store.replace_many("extract_lookup", list(lookup.items()))
    store.replace_many("extract_links", [(key, {"target": target}) for key, target in final_target.items()])
    store.upsert_one("meta", "extract_summary", {"mdxPath": mdx_path, "totalEntries": total})

    return {
        "lookup": lookup,
        "finalTarget": final_target,
        "totalEntries": total,
    }
