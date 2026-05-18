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

VALID_POS = {"n", "v", "adj", "adv", "int", "prep", "conj", "pron", "art", "num"}

POS_MAP = {
    "noun": "n", "verb": "v", "adjective": "adj", "adverb": "adv",
    "exclamation": "int", "preposition": "prep", "conjunction": "conj",
    "pronoun": "pron", "number": "num", "determiner": "det", "modal verb": "modal",
    "abbreviation": "abbr",
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
    "c": "比较级",
    "sup": "最高级",
}

EXCHANGE_DISPLAY_ORDER = ["3", "p", "d", "i", "s", "c", "sup"]

FORM_KEY_FAMILIES: dict[str, set[str]] = {
    "3": {"3", "p", "d", "i"},
    "p": {"3", "p", "d", "i"},
    "d": {"3", "p", "d", "i"},
    "i": {"3", "p", "d", "i"},
    "s": {"s"},
    "c": {"c", "sup"},
    "sup": {"c", "sup"},
}
IRREGULAR_COMPARATIVE_FORMS = {"more", "less", "better", "worse", "farther", "further"}
IRREGULAR_SUPERLATIVE_FORMS = {"most", "least", "best", "worst", "farthest", "furthest"}

# Maps inflection relation labels to the POS keys they are allowed to inherit.
INFLECTION_POS_FILTER: dict[str, set[str]] = {
    "第三人称单数": {"v"},
    "过去式": {"v"},
    "过去分词": {"v"},
    "现在分词": {"v"},
    "复数": {"n"},
    "比较级": {"adj", "adv"},
    "最高级": {"adj", "adv"},
}

# Homograph forms that look like inflections of another word but are actually
# standalone entries with their own independent meanings.
# Value is a list of (base_word, label) tuples for cross-reference display.
HOMOGRAPH_PROTECTED_FORMS: dict[str, list[tuple[str, str]]] = {
    "found": [("find", "过去式")],
    "left": [("leave", "过去式")],
    "ground": [("grind", "过去式")],
    "saw": [("see", "过去式")],
    "bound": [("bind", "过去式")],
    "rose": [("rise", "过去式")],
    "sprung": [("spring", "过去分词")],
}


def normalize_display_text(text: str) -> str:
    normalized = text.translate(PUNCTUATION_MAP)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def normalize_pos(pos_raw: str) -> str | None:
    pos_lower = pos_raw.lower()
    # Exact match first
    if pos_lower in POS_MAP:
        return POS_MAP[pos_lower]
    # Then partial match with word boundaries, so "adverbial" doesn't match "verb"
    for key, val in POS_MAP.items():
        if re.search(rf'\b{re.escape(key)}\b', pos_lower):
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


# Maps xrefs xt attribute values to Chinese templates for inflection forms.
XREF_INFLECTION_TEMPLATES: dict[str, str] = {
    "ptof": "{word} 的过去式",
    "ppof": "{word} 的过去分词",
    "ptppof": "{word} 的过去式和过去分词",
    "presptof": "{word} 的现在分词",
    "thirdpsof": "{word} 的第三人称单数",
    "plof": "{word} 的复数",
    "singof": "{word} 的单数",
    "comparof": "{word} 的比较级",
    "defat": "{word} 的相应形式",
}


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
        found_sense = False
        for sense in extract_core_senses(eroot):
            chn_tag = sense.select_one("deft chn")
            if chn_tag:
                text = normalize_display_text(chn_tag.get_text(strip=True))
                fragments = split_by_delimiters_keep_brackets(text)
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
                    found_sense = True
        # If no deft chn was found but there is an inflection cross-reference,
        # generate a minimal translation from the xref.
        if not found_sense:
            xref = eroot.select_one(".xrefs")
            if xref:
                xt = xref.get("xt", "")
                template = XREF_INFLECTION_TEMPLATES.get(xt)
                if template:
                    xh = xref.select_one(".xh")
                    if xh:
                        word = xh.get_text(strip=True)
                        if word:
                            text = template.format(word=word)
                            if text not in used_per_pos[pos_norm]:
                                used_per_pos[pos_norm].add(text)
                                pos_data[pos_norm].append(text)
                                found_sense = True
    return pos_data


def extract_exchange(soup: BeautifulSoup) -> str:
    parts: list[str] = []
    vf_table = soup.select_one(".verb_forms_table")
    verb_forms: set[str] = set()
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
                    # Filter out invalid thirdps forms like "understanding"
                    if form_type == "thirdps" and wf.endswith("ing"):
                        continue
                    parts.append(f"{EXCHANGE_LABELS[form_type]}:{wf}")
                    verb_forms.add(wf.lower())
    for inf_block in soup.select(".inflections"):
        block_text = inf_block.get_text(strip=True).lower()
        is_plural_block = "plural" in block_text
        for inf in inf_block.select(".inflected_form"):
            text = inf.get_text(strip=True)
            if not text:
                continue
            if text.lower() in verb_forms and not is_plural_block:
                continue
            parts.append(f"s:{text}")
    return "/".join(parts)


def normalize_exchange_forms(value: str) -> list[str]:
    stripped = value.strip()
    while stripped.startswith(("(", "（")):
        stripped = re.sub(r"^[（(][^）)]*[）)]\s*", "", stripped)

    forms: list[str] = []
    for part in stripped.split(","):
        normalized = normalize_display_text(part)
        if normalized and normalized not in forms:
            forms.append(normalized)
    return forms


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
        for form in normalize_exchange_forms(value):
            if form not in values[key]:
                values[key].append(form)

    return values


def _looks_like_comparative(base_word: str, form: str) -> bool:
    base = base_word.lower()
    f = form.lower()
    if f == base + "er":
        return True
    if base.endswith("e") and f == base + "r":
        return True
    if base.endswith("y") and f == base[:-1] + "ier":
        return True
    if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "er":
        return True
    return False


def _looks_like_superlative(base_word: str, form: str) -> bool:
    base = base_word.lower()
    f = form.lower()
    if f == base + "est":
        return True
    if base.endswith("e") and f == base + "st":
        return True
    if base.endswith("y") and f == base[:-1] + "iest":
        return True
    if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "est":
        return True
    return False


def move_surface_comparatives_into_exchange_slots(
    exchange_values: dict[str, list[str]], pos_summary: str, base_word: str = ""
) -> dict[str, list[str]]:
    s_forms = exchange_values.get("s", [])
    if not s_forms:
        return exchange_values

    pos_keys = parse_pos_keys(pos_summary)
    has_comparative_pos = "adj" in pos_keys or "adv" in pos_keys

    comparative_forms: list[str] = []
    superlative_forms: list[str] = []
    remaining_s_forms: list[str] = []

    for form in s_forms:
        lower_form = form.lower()
        if lower_form in IRREGULAR_COMPARATIVE_FORMS:
            comparative_forms.append(form)
            continue
        if lower_form in IRREGULAR_SUPERLATIVE_FORMS:
            superlative_forms.append(form)
            continue
        if " " in form and lower_form not in IRREGULAR_COMPARATIVE_FORMS:
            remaining_s_forms.append(form)
            continue
        if has_comparative_pos and lower_form.endswith("er"):
            if not base_word or _looks_like_comparative(base_word, form):
                comparative_forms.append(form)
                continue
            remaining_s_forms.append(form)
            continue
        if has_comparative_pos and lower_form.endswith("est"):
            if not base_word or _looks_like_superlative(base_word, form):
                superlative_forms.append(form)
                continue
            remaining_s_forms.append(form)
            continue
        remaining_s_forms.append(form)

    if not comparative_forms and not superlative_forms:
        return exchange_values

    next_values = {key: [*values] for key, values in exchange_values.items()}

    if remaining_s_forms:
        next_values["s"] = remaining_s_forms
    else:
        next_values.pop("s", None)

    if comparative_forms:
        next_values["c"] = [
            *next_values.get("c", []),
            *[form for form in comparative_forms if form not in next_values.get("c", [])],
        ]

    if superlative_forms:
        next_values["sup"] = [
            *next_values.get("sup", []),
            *[form for form in superlative_forms if form not in next_values.get("sup", [])],
        ]

    return next_values


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


def classify_surface_s_relations(entry: dict[str, Any]) -> tuple[bool, set[str]]:
    pos_keys = parse_pos_keys(entry.get("pos", ""))
    exchange_values = parse_exchange_values(entry.get("exchange", ""))
    s_forms = exchange_values.get("s", [])
    third_person_forms = set(exchange_values.get("3", []))

    if "n" not in pos_keys:
        return False, {form.lower() for form in s_forms}

    has_comparative_pos = "adj" in pos_keys or "adv" in pos_keys
    blocked_forms = {
        form.lower()
        for form in s_forms
        if (
            form not in third_person_forms
            and (
                (form.endswith(("er", "est")) and has_comparative_pos)
                or form.lower() in IRREGULAR_COMPARATIVE_FORMS
            )
        )
    }
    allow_relation = any(form.lower() not in blocked_forms for form in s_forms)
    return allow_relation, blocked_forms


def is_regular_inflection(base_word: str, form: str, form_key: str) -> bool:
    """Check if form is a regular inflection of base_word."""
    base = base_word.lower()
    f = form.lower()

    if f == base:
        return True

    if form_key == "s":
        if f in {base + "s", base + "es"}:
            return True
        if base.endswith("f") and f == base[:-1] + "ves":
            return True
        if base.endswith("fe") and f == base[:-2] + "ves":
            return True
        if base.endswith("y") and f == base[:-1] + "ies":
            return True
        return False

    if form_key == "3":
        return f in {base + "s", base + "es"}

    if form_key == "i":
        if f == base + "ing":
            return True
        if base.endswith("e") and f == base[:-1] + "ing":
            return True
        if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "ing":
            return True
        return False

    if form_key == "c":
        if f == base + "er":
            return True
        if base.endswith("e") and f == base + "r":
            return True
        if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "er":
            return True
        if base.endswith("y") and f == base[:-1] + "ier":
            return True
        return False

    if form_key == "sup":
        if f == base + "est":
            return True
        if base.endswith("e") and f == base + "st":
            return True
        if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "est":
            return True
        if base.endswith("y") and f == base[:-1] + "iest":
            return True
        return False

    if form_key in {"p", "d"}:
        if f == base + "ed":
            return True
        if base.endswith("e") and f == base + "d":
            return True
        if len(base) >= 3 and base[-1] not in "aeiou" and base[-2] in "aeiou" and base[-3] not in "aeiouy" and f == base + base[-1] + "ed":
            return True
        if base.endswith("y") and f == base[:-1] + "ied":
            return True
        return False

    return False


def classify_inflection_parent(entry: dict[str, Any], form_key: str) -> str | None:
    pos_keys = parse_pos_keys(entry.get("pos", ""))
    if not pos_keys:
        return None

    if form_key == "s":
        if "n" in pos_keys:
            return "复数"
        if "v" in pos_keys:
            return "第三人称单数"
        return None

    label = EXCHANGE_DISPLAY_LABELS.get(form_key)
    if not label:
        return None

    if form_key in {"3", "p", "d", "i"}:
        return label if "v" in pos_keys else None

    if form_key in {"c", "sup"}:
        return label if "adj" in pos_keys or "adv" in pos_keys else None

    return None


def apply_relation_metadata(entry: dict[str, Any], *, entry_kind: str, display_word: str,
                            parent_relation: dict[str, str] | None,
                            child_relations: list[dict[str, str]],
                            inflection_sources: list[dict[str, str]] | None = None) -> dict[str, Any]:
    next_entry = {
        **entry,
        "entry_kind": entry_kind,
        "display_word": display_word,
        "parent_relation": parent_relation,
        "child_relations": child_relations,
    }
    if inflection_sources:
        next_entry["inflection_sources"] = inflection_sources
    return next_entry


def find_standalone_plural_parent(word: str, finalized_entries: dict[str, dict[str, Any]]) -> str | None:
    if not word.endswith("s") or word.endswith("ss"):
        return None

    candidates: list[str] = []

    # +s rule: cats -> cat
    candidates.append(word[:-1])

    if word.endswith("es"):
        # +es rule: buses -> bus, boxes -> box, potatoes -> potato
        candidates.append(word[:-2])
        if word.endswith("ies"):
            # y -> ies rule: babies -> baby
            candidates.append(word[:-3] + "y")
    elif word.endswith("ves"):
        # f -> ves rule: wolves -> wolf
        candidates.append(word[:-3] + "f")
        # fe -> ves rule: wives -> wife
        candidates.append(word[:-3] + "fe")

    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        candidate_entry = finalized_entries.get(candidate)
        if not candidate_entry:
            continue
        if candidate_entry.get("entry_kind") != "standalone":
            continue
        if "n" not in parse_pos_keys(candidate_entry.get("pos", "")):
            continue
        return candidate

    return None


def should_preserve_alias_surface(word: str, target_entry: dict[str, Any],
                                 parent_relation: dict[str, str] | None) -> bool:
    if parent_relation:
        return False

    target_word = target_entry.get("word", "").lower()
    if not target_word or word != f"{target_word}s":
        return False

    pos_keys = parse_pos_keys(target_entry.get("pos", ""))
    return "n" not in pos_keys and "v" not in pos_keys


def split_by_delimiters_keep_brackets(text: str, delimiters: str = ",;，；") -> list[str]:
    """Split text by delimiters, but ignore delimiters inside brackets."""
    result: list[str] = []
    current: list[str] = []
    depth = 0
    for char in text:
        if char in "（(":
            depth += 1
        elif char in "）)":
            depth = max(0, depth - 1)
        elif char in delimiters and depth == 0:
            if current:
                result.append("".join(current).strip())
                current = []
            continue
        current.append(char)
    if current:
        result.append("".join(current).strip())
    return [f for f in result if f]


def filter_entry_pos_and_translation(entry: dict[str, Any], relation_label: str) -> dict[str, Any]:
    """Return a shallow copy of entry with pos and translation filtered by inflection type.

    relation_label may be comma-separated (e.g. "第三人称单数,复数") when a form
    appears in multiple exchange slots of its parent.
    """
    allowed_pos: set[str] = set()
    for label in relation_label.split(","):
        allowed_pos.update(INFLECTION_POS_FILTER.get(label, set()))
    if not allowed_pos:
        return dict(entry)

    result = dict(entry)

    # Filter pos field
    pos = result.get("pos", "")
    if pos:
        filtered_parts = []
        for part in pos.split("/"):
            pos_key = part.split(":")[0]
            if pos_key in allowed_pos:
                filtered_parts.append(part)
        result["pos"] = "/".join(filtered_parts)

    # Filter translation field
    translation = result.get("translation", "")
    if translation:
        filtered_lines = []
        for line in translation.split("\n"):
            match = re.match(r"^([a-z]+)\.\s*(.+)$", line)
            if match:
                pos_key = match.group(1)
                if pos_key in allowed_pos:
                    filtered_lines.append(line)
        result["translation"] = "\n".join(filtered_lines)

    return result


def create_inflection_entry(form: str, parent_entry: dict[str, Any], relation_label: str) -> dict[str, Any]:
    entry = filter_entry_pos_and_translation(parent_entry, relation_label)
    entry["word"] = form
    entry["linked_word"] = parent_entry["word"]

    return apply_relation_metadata(
        entry,
        entry_kind="inflection",
        display_word=parent_entry["word"],
        parent_relation=build_relation(parent_entry["word"], "原形"),
        child_relations=[],
    )


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


def serialize_exchange_values(values: dict[str, list[str]]) -> str:
    parts: list[str] = []
    for key in EXCHANGE_DISPLAY_ORDER:
        for value in values.get(key, []):
            parts.append(f"{key}:{value}")
    return "/".join(parts)


def build_exchange_lines(exchange: str) -> list[str]:
    if not exchange:
        return []
    values = parse_exchange_values(exchange)
    parts = []
    for key in EXCHANGE_DISPLAY_ORDER:
        words = values.get(key, [])
        label = EXCHANGE_DISPLAY_LABELS.get(key)
        if words and label:
            parts.append(f"{label}：{', '.join(words)}")
    return parts


def build_translation(pos_data: dict[str, list[str]]) -> str:
    lines = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron", "num"]:
        if pos_norm in pos_data and pos_data[pos_norm]:
            text = "，".join(pos_data[pos_norm])
            lines.append(f"{pos_norm}. {text}")
    return "\n".join(lines)


def build_pos_freq(pos_data: dict[str, list[str]]) -> str:
    total = sum(len(v) for v in pos_data.values())
    if total == 0:
        return ""
    parts = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron", "num"]:
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

    pos = build_pos_freq(cn_data)
    exchange_values = move_surface_comparatives_into_exchange_slots(parse_exchange_values(extract_exchange(soup)), pos, word)

    # For nouns that also function as verbs, the third-person singular form
    # often doubles as the plural (e.g. find -> finds, work -> works).
    # If MDX omits explicit plural inflections, mirror the 3-slot into s.
    pos_keys = parse_pos_keys(pos)
    if "n" in pos_keys and not exchange_values.get("s") and exchange_values.get("3"):
        exchange_values["s"] = [*exchange_values["3"]]

    exchange = serialize_exchange_values(exchange_values)
    translation = build_translation(cn_data)
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
    parent_relations_map: dict[str, list[dict[str, str]]] = {}
    blocked_surface_forms_by_base: dict[str, set[str]] = {}

    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        allow_plural_relations, blocked_forms = classify_surface_s_relations(entry)
        if blocked_forms:
            blocked_surface_forms_by_base[base_word] = blocked_forms
        for key in EXCHANGE_DISPLAY_ORDER:
            label = classify_inflection_parent(entry, key)
            if key == "s" and not allow_plural_relations:
                continue
            for form in exchange_values.get(key, []):
                form_key = form.lower()
                if form_key in blocked_forms:
                    continue
                if not label or form_key == base_word:
                    continue
                child_relations_map.setdefault(base_word, [])
                relation = build_relation(form, label)
                if relation not in child_relations_map[base_word]:
                    child_relations_map[base_word].append(relation)
                if entry.get("pos") and form_key not in parent_relations_map:
                    parent_relations_map[form_key] = [build_relation(entry["word"], "原形")]
                    parent_relations_map[form_key][0]["_inflection_label"] = label
                elif entry.get("pos") and form_key in parent_relations_map:
                    existing_relation = None
                    for r in parent_relations_map[form_key]:
                        if r["word"].lower() == entry["word"].lower():
                            existing_relation = r
                            break
                    if existing_relation:
                        existing_labels = existing_relation.get("_inflection_label", "")
                        if label not in existing_labels.split(","):
                            existing_relation["_inflection_label"] = f"{existing_labels},{label}" if existing_labels else label
                    else:
                        new_relation = build_relation(entry["word"], "原形")
                        new_relation["_inflection_label"] = label
                        parent_relations_map[form_key].append(new_relation)

    finalized_entries: dict[str, dict[str, Any]] = {}
    for word_key, entry in standalone_cache.items():
        parent_relation = None
        potential_parents = parent_relations_map.get(word_key, [])

        if potential_parents:
            primary_parent = potential_parents[0]
            base_word = primary_parent["word"].lower()
            base_entry = standalone_cache.get(base_word)
            if base_entry:
                base_exchange = parse_exchange_values(base_entry.get("exchange", ""))
                current_form_key = None
                for key in EXCHANGE_DISPLAY_ORDER:
                    forms = base_exchange.get(key, [])
                    if word_key in [f.lower() for f in forms]:
                        current_form_key = key
                        break

                if current_form_key and not is_regular_inflection(base_word, word_key, current_form_key):
                    if word_key not in HOMOGRAPH_PROTECTED_FORMS:
                        parent_relation = primary_parent

                        current_idx = EXCHANGE_DISPLAY_ORDER.index(current_form_key)
                        allowed_later_keys = FORM_KEY_FAMILIES.get(current_form_key, set())
                        for later_key in EXCHANGE_DISPLAY_ORDER[current_idx + 1 :]:
                            if later_key not in allowed_later_keys:
                                continue
                            label = classify_inflection_parent(base_entry, later_key)
                            if not label:
                                continue
                            for form in base_exchange.get(later_key, []):
                                if form.lower() == word_key:
                                    continue
                                # For irregular comparative/superlative forms, only link to
                                # other irregular forms in the same suppletion path.
                                if current_form_key in {"c", "sup"}:
                                    lower_form = form.lower()
                                    is_current_irregular = (
                                        word_key in IRREGULAR_COMPARATIVE_FORMS
                                        or word_key in IRREGULAR_SUPERLATIVE_FORMS
                                    )
                                    is_target_irregular = (
                                        lower_form in IRREGULAR_COMPARATIVE_FORMS
                                        or lower_form in IRREGULAR_SUPERLATIVE_FORMS
                                    )
                                    if is_current_irregular and not is_target_irregular:
                                        continue
                                relation = build_relation(form, label)
                                existing = child_relations_map.get(word_key, [])
                                if relation not in existing:
                                    child_relations_map.setdefault(word_key, []).append(relation)

        # Strip internal metadata fields from parent_relation before serializing.
        clean_parent_relation = None
        if parent_relation:
            clean_parent_relation = {k: v for k, v in parent_relation.items() if not k.startswith("_")}

        inflection_sources = []
        if len(potential_parents) > 1:
            for pp in potential_parents:
                labels = pp.get("_inflection_label", "")
                inflection_sources.append({
                    "word": pp["word"],
                    "label": labels,
                })

        finalized_entries[word_key] = apply_relation_metadata(
            entry,
            entry_kind="standalone",
            display_word=entry["word"],
            parent_relation=clean_parent_relation,
            child_relations=child_relations_map.get(word_key, []),
            inflection_sources=inflection_sources,
        )
        if word_key in HOMOGRAPH_PROTECTED_FORMS:
            finalized_entries[word_key]["cross_references"] = [
                {"word": base, "label": label}
                for base, label in HOMOGRAPH_PROTECTED_FORMS[word_key]
            ]

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

        potential_parents = parent_relations_map.get(word_key, [])
        parent_relation = potential_parents[0] if potential_parents else None
        display_word = target_entry["word"]
        source_entry = target_entry
        target_blocked_forms = blocked_surface_forms_by_base.get(target_key, set())
        if not parent_relation:
            plural_parent = find_standalone_plural_parent(word_key, finalized_entries)
            if plural_parent:
                parent_entry = finalized_entries.get(plural_parent)
                if parent_entry:
                    parent_relation = build_relation(parent_entry["word"], "原形")
                    display_word = parent_entry["word"]
                    source_entry = parent_entry
                    child_relations_map.setdefault(plural_parent, [])
                    relation = build_relation(word, "复数")
                    if relation not in child_relations_map[plural_parent]:
                        child_relations_map[plural_parent].append(relation)
                        parent_entry["child_relations"] = child_relations_map[plural_parent]
        elif has_standalone_entry(parent_relation["word"], lookup):
            display_word = parent_relation["word"]

        if word_key in target_blocked_forms:
            display_word = word
            parent_relation = None
        elif should_preserve_alias_surface(word_key, target_entry, parent_relation):
            display_word = word

        entry_kind = "inflection" if parent_relation else "alias"
        inflection_label = None
        if parent_relation:
            inflection_label = parent_relation.get("_inflection_label")
            # If no _inflection_label, it came from find_standalone_plural_parent
            if not inflection_label:
                inflection_label = "复数"

        if inflection_label:
            source_entry = filter_entry_pos_and_translation(source_entry, inflection_label)

        data = apply_relation_metadata(
            {
                **source_entry,
                "word": word,
                "linked_word": target_entry["word"],
            },
            entry_kind=entry_kind,
            display_word=display_word,
            parent_relation={k: v for k, v in parent_relation.items() if not k.startswith("_")} if parent_relation else None,
            child_relations=[],
        )
        finalized_entries[word_key] = data
        link_processed += 1
        if link_processed % REPORT_INTERVAL == 0:
            print(f"  Links processed: {link_processed}")

    print(f"Phase 3 complete: {link_processed} links, {link_skipped} skipped")

    print("Phase 4: Materializing missing inflection entries...")
    materialized = 0
    for word_key, entry in list(finalized_entries.items()):
        if entry.get("entry_kind") != "standalone":
            continue

        for relation in entry.get("child_relations", []):
            form = relation["word"]
            form_key = form.lower()
            if form_key in finalized_entries:
                continue
            finalized_entries[form_key] = create_inflection_entry(form, entry, relation["label"])
            materialized += 1

    print(f"Phase 4 complete: {materialized} entries materialized")

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
