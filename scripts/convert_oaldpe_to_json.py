#!/usr/bin/env python3
"""
Convert OALDPE MDX to JSON shards for Bob plugin.
Output: dict/a.json, dict/b.json, ... containing word -> entry mappings.
"""

import json
import re
import os
from pathlib import Path
from typing import Any
from bs4 import BeautifulSoup
from readmdict import MDX

PROJECT_ROOT = Path(__file__).resolve().parent.parent
OALD_ROOT = PROJECT_ROOT / "vendor" / "oald" / "OALD 2024.09"
MDX_PATH = str(OALD_ROOT / "oaldpe.mdx")
OUTPUT_DIR = str(PROJECT_ROOT / "dict")
REPORT_INTERVAL = 10000

VALID_POS = {"n", "v", "adj", "adv", "int", "prep", "conj", "pron", "art"}

POS_MAP = {
    "noun": "n", "verb": "v", "adjective": "adj", "adverb": "adv",
    "exclamation": "int", "preposition": "prep", "conjunction": "conj",
    "pronoun": "pron", "determiner": "det", "modal verb": "modal",
    "number": "num", "abbreviation": "abbr",
}

EXCHANGE_LABELS = {"thirdps": "3", "past": "p", "pastpart": "d", "prespart": "i"}

PUNCTUATION_MAP = str.maketrans({
    "［": "[",
    "］": "]",
    "【": "[",
    "】": "]",
    "｛": "{",
    "｝": "}",
})

EXCHANGE_DISPLAY_LABELS = {
    "3": "第三人称单数",
    "p": "过去式",
    "d": "过去分词",
    "i": "现在分词",
    "s": "复数",
}

EXCHANGE_DISPLAY_ORDER = ["3", "p", "d", "i", "s"]


def normalize_display_text(text: str) -> str:
    normalized = text.translate(PUNCTUATION_MAP)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def normalize_pos(pos_raw: str) -> str | None:
    pos_lower = pos_raw.lower()
    # Exact match first
    if pos_lower in POS_MAP:
        return POS_MAP[pos_lower]
    # Then partial match, but avoid adverb -> verb
    for key, val in POS_MAP.items():
        if key in pos_lower:
            return val
    if "noun" in pos_lower:
        return "n"
    if "verb" in pos_lower:
        return "v"
    return None


def extract_phonetic(soup: BeautifulSoup) -> tuple[str, str]:
    phon_br = soup.select_one(".phons_br .phon")
    phon_us = soup.select_one(".phons_n_am .phon")
    br = phon_br.text.strip() if phon_br else ""
    us = phon_us.text.strip() if phon_us else ""
    return br.replace("/", ""), us.replace("/", "")


def extract_core_senses(eroot: BeautifulSoup) -> list:
    senses = []
    for sense in eroot.select("li.sense"):
        if sense.find_parent(class_="idioms"):
            continue
        senses.append(sense)
    return senses


def extract_meanings(soup: BeautifulSoup) -> dict[str, list[str]]:
    pos_data: dict[str, list[str]] = {}
    used_per_pos: dict[str, set[str]] = {}

    def count_chars(text: str) -> int:
        cleaned = re.sub(r"[（(].*?[）)]", "", text)
        return len(cleaned.strip())

    for eroot in soup.select(".oald-entry-root"):
        pos_tag = eroot.select_one(".pos")
        if not pos_tag:
            continue
        pos_norm = normalize_pos(pos_tag.get_text(strip=True))
        if not pos_norm or pos_norm not in VALID_POS:
            continue
        if pos_norm not in pos_data:
            pos_data[pos_norm] = []
            used_per_pos[pos_norm] = set()
        for sense in extract_core_senses(eroot):
            chn_tag = sense.select_one("deft chn")
            if chn_tag:
                text = normalize_display_text(chn_tag.get_text(strip=True))
                fragments = [f.strip() for f in re.split(r"[,;，；]", text) if f.strip()]
                if not fragments:
                    continue
                # Sort by char count (excluding brackets), shortest first
                fragments_sorted = sorted(fragments, key=count_chars)
                best = None
                for f in fragments_sorted:
                    if f not in used_per_pos[pos_norm]:
                        best = f
                        break
                if best:
                    used_per_pos[pos_norm].add(best)
                    pos_data[pos_norm].append(best)
    return pos_data


def extract_exchange(soup: BeautifulSoup) -> str:
    parts: list[str] = []
    vf_table = soup.select_one(".verb_forms_table")
    if vf_table:
        for tr in vf_table.select("tr"):
            form_type = tr.get("form", "")
            tds = tr.select("td")
            if len(tds) >= 1:
                td = tds[0]
                prefix = td.select_one(".vf_prefix")
                if prefix:
                    prefix.extract()
                wf = td.get_text(strip=True)
                if form_type in EXCHANGE_LABELS:
                    parts.append(f"{EXCHANGE_LABELS[form_type]}:{wf}")
    for inf in soup.select(".inflections .inflected_form"):
        text = inf.get_text(strip=True)
        if text:
            parts.append(f"s:{text}")
    return "/".join(parts)


def parse_exchange_values(exchange: str) -> dict[str, list[str]]:
    values: dict[str, list[str]] = {}
    if not exchange:
        return values

    for item in exchange.split("/"):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        if not key or not value:
            continue
        values.setdefault(key, [])
        if value not in values[key]:
            values[key].append(value)

    return values


def has_standalone_entry(word: str, lookup: dict[str, str]) -> bool:
    html = lookup.get(word)
    return bool(html and not html.startswith("@@@LINK="))


def build_relation(word: str, label: str) -> dict[str, str]:
    return {"word": word, "label": label}


def parse_pos_keys(pos_summary: str) -> set[str]:
    if not pos_summary:
        return set()

    keys = set()
    for item in pos_summary.split("/"):
        key, _, _ = item.partition(":")
        if key:
            keys.add(key)
    return keys


def supports_plural_relations(entry: dict[str, Any]) -> bool:
    return "n" in parse_pos_keys(entry.get("pos", ""))


def apply_relation_metadata(entry: dict[str, Any], *, entry_kind: str, display_word: str,
                            parent_relation: dict[str, str] | None,
                            child_relations: list[dict[str, str]]) -> dict[str, Any]:
    next_entry = {
        **entry,
        "entry_kind": entry_kind,
        "display_word": display_word,
        "parent_relation": parent_relation,
        "child_relations": child_relations,
    }
    return next_entry


def find_standalone_plural_parent(word: str, lookup: dict[str, str]) -> str | None:
    if not word.endswith("s") or word.endswith("ss"):
        return None

    candidate = word[:-1]
    if has_standalone_entry(candidate, lookup):
        return candidate

    return None


def extract_phrasal_verbs(soup: BeautifulSoup, lookup: dict[str, str]) -> list[dict]:
    pvs: list[dict] = []
    for pv in soup.select(".phrasal_verb_links .xh"):
        name = pv.get_text(strip=True)
        if not name:
            continue
        pv_key = name.replace(" ", "-").lower()
        pv_html = lookup.get(pv_key, "")
        if pv_html:
            pv_soup = BeautifulSoup(pv_html, "lxml")
            pv_meanings = extract_meanings(pv_soup)
            translation = build_translation(pv_meanings)
            if translation:
                pvs.append({"name": name, "translation": translation})
    return pvs


def build_exchange_lines(exchange: str) -> list[str]:
    if not exchange:
        return []
    values = {}
    for item in exchange.split("/"):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        if key and value:
            values[key] = value
    parts = []
    for key in EXCHANGE_DISPLAY_ORDER:
        value = values.get(key)
        label = EXCHANGE_DISPLAY_LABELS.get(key)
        if value and label:
            parts.append(f"{label}：{value}")
    return parts


def build_translation(pos_data: dict[str, list[str]]) -> str:
    lines = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron"]:
        if pos_norm in pos_data and pos_data[pos_norm]:
            text = "，".join(pos_data[pos_norm])
            lines.append(f"{pos_norm}. {text}")
    return "\n".join(lines)


def build_pos_freq(pos_data: dict[str, list[str]]) -> str:
    total = sum(len(v) for v in pos_data.values())
    if total == 0:
        return ""
    parts = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron"]:
        if pos_norm in pos_data and pos_data[pos_norm]:
            pct = round(len(pos_data[pos_norm]) / total * 100)
            parts.append(f"{pos_norm}:{pct}")
    return "/".join(parts)


def parse_entry(html: str, word: str, lookup: dict[str, str] = {}) -> dict | None:
    soup = BeautifulSoup(html, "lxml")

    phon_br, phon_us = extract_phonetic(soup)

    cn_data = extract_meanings(soup)
    if not cn_data:
        return None

    exchange = extract_exchange(soup)
    translation = build_translation(cn_data)
    pos = build_pos_freq(cn_data)
    phrasal_verbs = extract_phrasal_verbs(soup, lookup)

    return {
        "word": word,
        "phonetic": phon_br,
        "phonetic_us": phon_us,
        "translation": translation,
        "pos": pos,
        "exchange": exchange,
        "phrasal_verbs": phrasal_verbs,
    }


def main():
    print("Loading MDX dictionary...")
    mdx = MDX(MDX_PATH, encoding="utf-8")
    total = len(mdx)
    print(f"Total entries: {total}")

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

    print("Phase 1: Processing non-link entries...")
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
            parent_relation=None,
            child_relations=[],
        )
        processed += 1
        if processed % REPORT_INTERVAL == 0:
            print(f"  Processed: {processed}")

    print(f"Phase 1 complete: {processed} entries, {skipped} skipped")

    print("Phase 2: Building relation metadata...")
    child_relations_map: dict[str, list[dict[str, str]]] = {}
    parent_relations_map: dict[str, dict[str, str]] = {}

    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        allow_plural_relations = supports_plural_relations(entry)
        for key in EXCHANGE_DISPLAY_ORDER:
            label = EXCHANGE_DISPLAY_LABELS.get(key)
            if key == "s" and not allow_plural_relations:
                continue
            for form in exchange_values.get(key, []):
                form_key = form.lower()
                if not label or form_key == base_word:
                    continue
                child_relations_map.setdefault(base_word, [])
                relation = build_relation(form, label)
                if relation not in child_relations_map[base_word]:
                    child_relations_map[base_word].append(relation)
                if form_key not in parent_relations_map:
                    parent_relations_map[form_key] = build_relation(entry["word"], "原形")

    finalized_entries: dict[str, dict[str, Any]] = {}
    for word_key, entry in standalone_cache.items():
        finalized_entries[word_key] = apply_relation_metadata(
            entry,
            entry_kind="standalone",
            display_word=entry["word"],
            parent_relation=None,
            child_relations=child_relations_map.get(word_key, []),
        )

    print("Phase 3: Processing link entries...")
    link_processed = 0
    link_skipped = 0

    for word, target in final_target.items():
        word_key = word.lower()
        if word_key in finalized_entries:
            continue

        target_key = target.lower()
        target_entry = finalized_entries.get(target_key)
        if not target_entry:
            link_skipped += 1
            continue

        parent_relation = parent_relations_map.get(word_key)
        display_word = target_entry["word"]
        if not parent_relation:
            plural_parent = find_standalone_plural_parent(word_key, lookup)
            if plural_parent:
                parent_entry = finalized_entries.get(plural_parent)
                if parent_entry:
                    parent_relation = build_relation(parent_entry["word"], "原形")
                    display_word = parent_entry["word"]
                    child_relations_map.setdefault(plural_parent, [])
                    relation = build_relation(word, "复数")
                    if relation not in child_relations_map[plural_parent]:
                        child_relations_map[plural_parent].append(relation)
                        parent_entry["child_relations"] = child_relations_map[plural_parent]
        elif has_standalone_entry(parent_relation["word"], lookup):
            display_word = parent_relation["word"]

        entry_kind = "inflection" if parent_relation else "alias"
        data = apply_relation_metadata(
            {
                **target_entry,
                "word": word,
                "linked_word": target_entry["word"],
            },
            entry_kind=entry_kind,
            display_word=display_word,
            parent_relation=parent_relation,
            child_relations=[],
        )
        finalized_entries[word_key] = data
        link_processed += 1
        if link_processed % REPORT_INTERVAL == 0:
            print(f"  Links processed: {link_processed}")

    print(f"Phase 3 complete: {link_processed} links, {link_skipped} skipped")

    print("Preparing shards...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    shards: dict[str, dict[str, dict[str, Any]]] = {}
    for word_key, entry in finalized_entries.items():
        first_char = word_key[0].lower() if word_key else "_"
        shards.setdefault(first_char, {})
        shards[first_char][word_key] = entry

    print(f"\nWriting JSON shards to {OUTPUT_DIR}...")
    total_size = 0
    for char, entries in sorted(shards.items()):
        path = os.path.join(OUTPUT_DIR, f"{char}.json")
        content = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        size = os.path.getsize(path)
        total_size += size
        print(f"  {char}.json: {len(entries)} entries, {size / 1024 / 1024:.1f} MB")

    print(f"\nDone!")
    print(f"  Total MDX entries: {total}")
    print(f"  Non-link entries: {processed}")
    print(f"  Link entries: {link_processed}")
    print(f"  Total JSON entries: {len(finalized_entries)}")
    print(f"  Total size: {total_size / 1024 / 1024:.1f} MB")
    print(f"  Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
