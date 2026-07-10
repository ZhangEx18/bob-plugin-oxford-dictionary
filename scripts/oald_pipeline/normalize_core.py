from __future__ import annotations

from typing import Any

from bs4 import BeautifulSoup

from .shared_core import (
    build_pos_freq,
    build_translation,
    build_translation_detail_parts,
    build_translation_parts,
    extract_exchange,
    extract_meaning_items,
    extract_phonetic,
    extract_phrasal_verbs,
    extract_verb_forms,
    extract_word_family,
    move_surface_comparatives_into_exchange_slots,
    parse_exchange_values,
    serialize_exchange_values,
)

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
