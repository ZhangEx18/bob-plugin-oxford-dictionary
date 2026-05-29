from __future__ import annotations

from typing import Any


def summarize_entries(entries: dict[str, dict[str, Any]]) -> dict[str, Any]:
    counts = {"standalone": 0, "inflection": 0, "alias": 0}
    dangling_targets = 0
    synthetic_relations = 0
    word_family_missing = 0
    verb_form_missing = 0

    for entry in entries.values():
        kind = entry.get("entry_kind", "")
        if kind in counts:
            counts[kind] += 1
        if entry.get("entry_kind") == "standalone" and not entry.get("word_family"):
            word_family_missing += 1
        if entry.get("entry_kind") == "standalone" and "v" in entry.get("pos", "") and not entry.get("verb_forms"):
            verb_form_missing += 1

        for relation in entry.get("relations", []):
            if relation.get("source") == "derived":
                synthetic_relations += 1
            if relation.get("navigable") and relation.get("target", "").lower() not in entries:
                dangling_targets += 1

    shard_chars = sorted({key[0].lower() if key else "_" for key in entries.keys()})
    return {
        "entryCount": len(entries),
        "counts": counts,
        "danglingNavigableTargets": dangling_targets,
        "syntheticRelationCount": synthetic_relations,
        "wordFamilyMissingCount": word_family_missing,
        "verbFormMissingCount": verb_form_missing,
        "shardCount": len(shard_chars),
        "shards": shard_chars,
    }

