from __future__ import annotations

from typing import Any

from readmdict import MDX

from .shared_core import *

def parse_entry(html: str, word: str, lookup: dict[str, str] = {}) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    phon_br, phon_us = extract_phonetic(soup)

    meaning_items = extract_meaning_items(soup)
    cn_data = {
        pos_norm: [meaning["text"] for meaning in meanings]
        for pos_norm, meanings in meaning_items.items()
        if meanings
    }
    if not cn_data:
        return None

    # v3.1.0/v3.1.1: Append "的" to adjective meanings that don't already
    # contain or end with "的".  If a segment already has "的" anywhere
    # (e.g. "特指的（与泛指相对）"), skip it to avoid "...的）的".
    def _ensure_adj_de(text: str) -> str:
        segments = text.split("；")
        result: list[str] = []
        for seg in segments:
            stripped = seg.strip()
            if not stripped:
                continue
            if "的" not in stripped and not stripped.endswith("的"):
                stripped += "的"
            result.append(stripped)
        return "；".join(result)

    if "adj" in cn_data:
        cn_data["adj"] = [_ensure_adj_de(text) for text in cn_data["adj"]]

    pos = build_pos_freq(cn_data)
    exchange_values = move_surface_comparatives_into_exchange_slots(parse_exchange_values(extract_exchange(soup)), pos, word)

    # NOTE: Removed n+v mixed-POS mirror heuristic (v3.0.0).
    # Previously, "script -> scripts" would auto-inherit the full verb timeline
    # because "3" was mirrored into "s". This caused inflection entries like
    # "scripts" to incorrectly carry "scripting/scripted" as child morphology.
    # Plural queryability for mixed-POS words is now handled exclusively via
    # explicit exchange/relation evidence, not heuristic inference.

    exchange = serialize_exchange_values(exchange_values)
    translation_parts = build_translation_parts(cn_data)
    translation_detail_parts = build_translation_detail_parts(meaning_items)
    translation = build_translation(cn_data)
    phrasal_verbs = extract_phrasal_verbs(soup, lookup)
    verb_forms = extract_verb_forms(soup)
    word_family = extract_word_family(soup)

    entry = {
        "word": word,
        "phonetic": phon_br,
        "phonetic_us": phon_us,
        "translation": translation,
        "translation_parts": translation_parts,
        "translation_detail_parts": translation_detail_parts,
        "pos": pos,
        "exchange": exchange,
        "phrasal_verbs": phrasal_verbs,
    }
    if verb_forms:
        entry["verb_forms"] = verb_forms
    if word_family:
        entry["word_family"] = word_family
    return entry


def propagate_word_families(entries: dict[str, dict[str, Any]]) -> None:
    for entry in list(entries.values()):
        family = entry.get("word_family")
        if not family:
            continue
        for item in family:
            member_word = item.get("word", "").lower()
            member_entry = entries.get(member_word)
            if not member_entry or member_entry.get("word_family"):
                continue
            member_entry["word_family"] = [dict(family_item) for family_item in family]


def build_lookup_index(mdx: MDX) -> tuple[dict[str, str], dict[str, str], int]:
    """Stage A-1: Build lookup index from MDX data."""
    print("Building lookup index...")
    lookup: dict[str, str] = {}
    alias_targets: dict[str, str] = {}
    for word_bytes, definition_bytes in mdx.items():
        word = word_bytes.decode("utf-8")
        html = definition_bytes.decode("utf-8")
        is_link = html.startswith("@@@LINK=")
        target = html.replace("@@@LINK=", "").strip() if is_link else ""

        existing_html = lookup.get(word)
        if existing_html is None:
            lookup[word] = html
            if is_link:
                alias_targets[word] = target
            continue

        existing_is_link = existing_html.startswith("@@@LINK=")
        if not is_link:
            if existing_is_link:
                lookup[word] = html
            continue

        if existing_is_link:
            lookup[word] = html
        alias_targets[word] = target
    print(f"Lookup entries: {len(lookup)}")
    return lookup, alias_targets, len(mdx)


def resolve_link_chains(lookup: dict[str, str], alias_targets: dict[str, str]) -> dict[str, str]:
    """Stage A-2: Resolve @@@LINK= chains to final targets."""
    print("Resolving link chains...")
    final_target: dict[str, str] = {}
    for word, html in lookup.items():
        if not html.startswith("@@@LINK="):
            continue

        target = html.replace("@@@LINK=", "").strip()
        visited = {word}
        while target in lookup and lookup[target].startswith("@@@LINK=") and target not in visited:
            visited.add(target)
            target = lookup[target].replace("@@@LINK=", "").strip()
        if has_standalone_entry(target, lookup):
            final_target[word] = target

    for word, target in alias_targets.items():
        if has_standalone_entry(target, lookup):
            final_target[word] = target

    print(f"Resolved links: {len(final_target)}")
    return final_target


def parse_non_link_entries(lookup: dict[str, str]) -> dict[str, dict[str, Any]]:
    """Stage A-3: Parse non-link entries from raw HTML."""
    print("Stage A: Parsing non-link entries...")
    processed = 0
    skipped = 0
    standalone_cache: dict[str, dict[str, Any]] = {}

    for word, html in lookup.items():
        if html.startswith("@@@LINK="):
            continue

        data = parse_entry(html, word, lookup)
        if data is None:
            skipped += 1
            continue

        standalone_cache[word.lower()] = apply_relation_metadata(
            data,
            entry_kind="standalone",
            display_word=word,
        )
        processed += 1
        if processed % REPORT_INTERVAL == 0:
            print(f"  Processed: {processed}")

    print(f"Stage A complete: {processed} entries, {skipped} skipped")
    return standalone_cache


def main() -> None:
    """Run the complete OALDPE MDX to JSON conversion pipeline.

    The pipeline consists of four stages:

    Stage A - Parse source entries from MDX:
    1. Build a lookup index from all MDX entries, handling duplicate keys by
       preferring non-link entries over @@@LINK= aliases.
    2. Resolve @@@LINK= chains to their final target words.
    3. Parse all non-link entries into structured entry dicts (phonetics,
       translations, POS, exchange forms, phrasal verbs, word families).
    4. Propagate word family data to members that lack their own family info.

    Stage C - Derive morphology & relations:
    1. Build relation metadata: child relations (base -> inflected forms),
       parent relations (inflected form -> base), relation edges, and blocked
       surface forms that should not create relations.
    2. Finalize standalone entries by attaching relation edges and determining
       parent/inflection status for each entry.
    3. Process link entries: convert @@@LINK= aliases into either inflection
       entries (if they map to a known inflected form) or alias entries.
    4. Materialize missing inflection entries: create synthetic entries for
       inflected forms that don't have their own standalone entry.

    Stage D - Render & shard:
    1. Group all finalized entries by first character.
    2. Write each group to a compact JSON shard file in the output directory.
    3. Print a summary with entry counts and file sizes.

    Side effects:
        - Reads the MDX file at MDX_PATH.
        - Writes JSON shard files to OUTPUT_DIR.
        - Prints progress and summary to stdout.
    """
    print("Loading MDX dictionary...")
    mdx = MDX(MDX_PATH, encoding="utf-8")
    total = len(mdx)
    print(f"Total entries: {total}")

    # Stage A: Parse source entries from MDX
    lookup, alias_targets, total = build_lookup_index(mdx)
    final_target = resolve_link_chains(lookup, alias_targets)
    standalone_cache = parse_non_link_entries(lookup)
    propagate_word_families(standalone_cache)

    # Stage C: Derive morphology & relations
    (
        child_relations_map,
        parent_relations_map,
        relation_edges_map,
        blocked_surface_forms_by_base,
    ) = build_relation_metadata(standalone_cache)

    finalized_entries = finalize_standalone_entries(
        standalone_cache,
        child_relations_map,
        parent_relations_map,
        relation_edges_map,
    )

    link_processed = process_link_entries(
        finalized_entries,
        final_target,
        parent_relations_map,
        relation_edges_map,
        blocked_surface_forms_by_base,
        lookup,
    )

    materialize_missing_inflections(finalized_entries)

    # Stage D: Render & shard
    write_shards(finalized_entries, total, len(standalone_cache), link_processed)


