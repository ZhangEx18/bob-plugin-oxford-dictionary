from __future__ import annotations

from typing import Any

from .normalize_core import parse_entry, propagate_word_families
from .shared_core import apply_relation_metadata
from .state import StateStore


CHUNK_SIZE = 5000


def _flush_chunk(store: StateStore, chunk: list[tuple[str, dict[str, Any]]]) -> None:
    if not chunk:
        return
    store.upsert_many_chunked("normalized_entries", chunk, chunk_size=CHUNK_SIZE)
    chunk.clear()


def run_normalize(store: StateStore) -> dict[str, Any]:
    lookup = store.load_all("extract_lookup")
    if not lookup:
        raise RuntimeError("extract stage state is missing")

    print("Stage A: Parsing non-link entries...")
    processed = 0
    skipped = 0
    standalone_cache: dict[str, dict[str, Any]] = {}
    pending_rows: list[tuple[str, dict[str, Any]]] = []

    store.clear_table("normalized_entries")
    for word, html in lookup.items():
        if html.startswith("@@@LINK="):
            continue

        data = parse_entry(html, word, lookup)
        if data is None:
            skipped += 1
            continue

        normalized_entry = apply_relation_metadata(
            data,
            entry_kind="standalone",
            display_word=word,
        )
        key = word.lower()
        standalone_cache[key] = normalized_entry
        pending_rows.append((key, normalized_entry))
        processed += 1

        if processed % CHUNK_SIZE == 0:
            _flush_chunk(store, pending_rows)
            print(f"  Processed: {processed}")

    _flush_chunk(store, pending_rows)
    print(f"Stage A complete: {processed} entries, {skipped} skipped")
    propagate_word_families(standalone_cache)
    store.replace_many_chunked("normalized_entries", list(standalone_cache.items()))
    extract_summary = store.load_one("meta", "extract_summary") or {}
    return {
        "standaloneCache": standalone_cache,
        "totalEntries": extract_summary.get("totalEntries", 0),
    }
