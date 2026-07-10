from __future__ import annotations

from typing import Any

from readmdict import MDX

from .extract_core import build_lookup_index, resolve_link_chains
from .state import StateStore


def run_extract(mdx_path: str, store: StateStore) -> dict[str, Any]:
    mdx = MDX(mdx_path, encoding="utf-8")
    lookup, alias_targets, total = build_lookup_index(mdx)
    final_target = resolve_link_chains(lookup, alias_targets)

    store.replace_many("extract_lookup", list(lookup.items()))
    store.replace_many("extract_links", [(key, {"target": target}) for key, target in final_target.items()])
    store.upsert_one("meta", "extract_summary", {"mdxPath": mdx_path, "totalEntries": total})

    return {
        "lookup": lookup,
        "finalTarget": final_target,
        "totalEntries": total,
    }
