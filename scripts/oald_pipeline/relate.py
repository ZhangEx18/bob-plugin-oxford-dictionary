from __future__ import annotations

from typing import Any

from . import relate_core as core
from .report import summarize_entries
from .state import StateStore

CHUNK_SIZE = 5000


def _build_relation_metadata_stream(store: StateStore) -> None:
    print("Stage C-1: Building relation metadata...")
    store.clear_table("relation_parents")
    store.clear_table("relation_edges")
    store.clear_table("blocked_forms")

    parent_rows: list[tuple[str, Any]] = []
    edge_rows: list[tuple[str, Any]] = []
    blocked_rows: list[tuple[str, Any]] = []

    for _, entry in store.iter_rows("normalized_entries", chunk_size=CHUNK_SIZE):
        base_word = entry["word"].lower()
        exchange_values = core.parse_exchange_values(entry.get("exchange", ""))
        allow_plural_relations, blocked_forms = core.classify_surface_s_relations(entry)
        if blocked_forms:
            blocked_rows.append((base_word, sorted(blocked_forms)))

        for key in core.EXCHANGE_DISPLAY_ORDER:
            label = core.classify_inflection_parent(entry, key)
            if key == "s" and not allow_plural_relations:
                continue
            for form in exchange_values.get(key, []):
                form_key = form.lower()
                if form_key in blocked_forms or not label:
                    continue
                edge_rows.append((
                    f"{base_word}|inflection|{label}|{form}",
                    {
                        "owner": base_word,
                        "edge": core.build_relation_edge(
                            relation_type="inflection",
                            target=form,
                            label=label,
                            direction="outgoing",
                            navigable=True,
                            display="exchange",
                            source="exchange",
                        ),
                    },
                ))
                if form_key == base_word:
                    continue
                parent_rows.append((
                    f"{form_key}|{base_word}|{label}",
                    {
                        "word": entry["word"],
                        "label": "原形",
                        "_inflection_label": label,
                    },
                ))

        s_forms = exchange_values.get("s", [])
        thirdps_forms = exchange_values.get("3", [])
        if (
            s_forms
            and thirdps_forms
            and base_word not in core.IRREGULAR_PLURALS
            and "n" in core.parse_pos_keys(entry.get("pos", ""))
        ):
            if any(f.lower() == base_word for f in s_forms):
                for form in thirdps_forms:
                    form_key = form.lower()
                    if form_key == base_word or form_key in blocked_forms:
                        continue
                    if not core.is_regular_inflection(base_word, form_key, "s"):
                        continue
                    label = "复数"
                    edge_rows.append((
                        f"{base_word}|inflection|{label}|{form}",
                        {
                            "owner": base_word,
                            "edge": core.build_relation_edge(
                                relation_type="inflection",
                                target=form,
                                label=label,
                                direction="outgoing",
                                navigable=True,
                                display="exchange",
                                source="derived",
                            ),
                        },
                    ))
                    parent_rows.append((
                        f"{form_key}|{base_word}|{label}",
                        {
                            "word": entry["word"],
                            "label": "原形",
                            "_inflection_label": label,
                        },
                    ))

        if len(parent_rows) >= CHUNK_SIZE:
            store.upsert_many_chunked("relation_parents", parent_rows, chunk_size=CHUNK_SIZE)
            parent_rows.clear()
        if len(edge_rows) >= CHUNK_SIZE:
            store.upsert_many_chunked("relation_edges", edge_rows, chunk_size=CHUNK_SIZE)
            edge_rows.clear()
        if len(blocked_rows) >= CHUNK_SIZE:
            store.upsert_many_chunked("blocked_forms", blocked_rows, chunk_size=CHUNK_SIZE)
            blocked_rows.clear()

    for _, entry in store.iter_rows("normalized_entries", chunk_size=CHUNK_SIZE):
        base_word = entry["word"].lower()
        pos_keys = core.parse_pos_keys(entry.get("pos", ""))
        if "n" not in pos_keys:
            continue
        exchange_values = core.parse_exchange_values(entry.get("exchange", ""))
        existing_s = set(f.lower() for f in exchange_values.get("s", []))
        if existing_s:
            continue
        detail_parts = entry.get("translation_detail_parts", [])
        noun_details = [
            d for part in detail_parts
            if part.get("pos") == "n."
            for d in part.get("details", [])
        ]
        if noun_details and all(d.get("countability") == "uncountable" for d in noun_details):
            continue
        inferred = core.infer_plural_form(entry["word"])
        if not inferred or inferred.lower() == base_word:
            continue
        inf_key = inferred.lower()
        blocked_payload = store.load_one("blocked_forms", base_word) or []
        blocked = set(blocked_payload)
        if inf_key in blocked or inf_key in existing_s:
            continue
        label = core.EXCHANGE_DISPLAY_LABELS.get("s", "复数")
        edge_rows.append((
            f"{base_word}|inflection|{label}|{inferred}",
            {
                "owner": base_word,
                "edge": core.build_relation_edge(
                    relation_type="inflection",
                    target=inferred,
                    label=label,
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                ),
            },
        ))
        parent_rows.append((
            f"{inf_key}|{base_word}|{label}",
            {
                "word": entry["word"],
                "label": "原形",
                "_inflection_label": label,
            },
        ))

        if len(parent_rows) >= CHUNK_SIZE:
            store.upsert_many_chunked("relation_parents", parent_rows, chunk_size=CHUNK_SIZE)
            parent_rows.clear()
        if len(edge_rows) >= CHUNK_SIZE:
            store.upsert_many_chunked("relation_edges", edge_rows, chunk_size=CHUNK_SIZE)
            edge_rows.clear()

    if parent_rows:
        store.upsert_many_chunked("relation_parents", parent_rows, chunk_size=CHUNK_SIZE)
    if edge_rows:
        store.upsert_many_chunked("relation_edges", edge_rows, chunk_size=CHUNK_SIZE)
    if blocked_rows:
        store.upsert_many_chunked("blocked_forms", blocked_rows, chunk_size=CHUNK_SIZE)

    print("Stage C-1 complete")


def _group_rows_by_prefix(rows: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for composite_key, payload in rows.items():
        word_key = composite_key.split("|", 1)[0]
        grouped.setdefault(word_key, []).append(payload)
    return grouped


def run_relate(store: StateStore) -> dict[str, Any]:
    if not store.load_one("meta", "extract_summary"):
        raise RuntimeError("extract stage state is missing")
    if not store.has_key("normalized_entries", "a"):
        normalized_count = sum(1 for _ in store.iter_rows("normalized_entries", chunk_size=CHUNK_SIZE))
        if normalized_count == 0:
            raise RuntimeError("normalize stage state is missing")

    _build_relation_metadata_stream(store)

    standalone_cache = store.load_all("normalized_entries")
    relation_edge_rows = store.load_all("relation_edges")
    parent_rows = store.load_all("relation_parents")
    blocked_rows = store.load_all("blocked_forms")
    final_target_rows = store.load_all("extract_links")
    lookup = store.load_all("extract_lookup")
    extract_summary = store.load_one("meta", "extract_summary") or {}

    relation_edges_map = {
        key: [item["edge"] for item in items]
        for key, items in _group_rows_by_prefix(relation_edge_rows).items()
    }
    parent_relations_map = {
        key: items
        for key, items in _group_rows_by_prefix(parent_rows).items()
    }
    blocked_surface_forms_by_base = {
        key: set(payload)
        for key, payload in blocked_rows.items()
    }
    final_target = {key: payload["target"] for key, payload in final_target_rows.items()}

    print("Stage C-2: Finalizing standalone entries...")
    finalized_entries = core.finalize_standalone_entries(
        standalone_cache,
        {},
        parent_relations_map,
        relation_edges_map,
    )
    print("Stage C-2 complete")

    link_processed = core.process_link_entries(
        finalized_entries,
        final_target,
        parent_relations_map,
        relation_edges_map,
        blocked_surface_forms_by_base,
        lookup,
    )
    materialized = core.materialize_missing_inflections(finalized_entries)
    metrics = summarize_entries(finalized_entries)

    store.replace_many_chunked("final_entries", list(finalized_entries.items()), chunk_size=CHUNK_SIZE)
    store.upsert_one(
        "build_metrics",
        "summary",
        {
            "linkProcessed": link_processed,
            "materializedInflections": materialized,
            "metrics": metrics,
            "totalEntries": extract_summary.get("totalEntries", 0),
        },
    )

    return {
        "finalizedEntries": finalized_entries,
        "linkProcessed": link_processed,
        "materializedInflections": materialized,
        "metrics": metrics,
        "totalEntries": extract_summary.get("totalEntries", 0),
    }
