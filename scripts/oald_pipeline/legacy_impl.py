#!/usr/bin/env python3
"""
Convert OALDPE MDX to JSON shards for Bob plugin.
Output: dict/a.json, dict/b.json, ... containing word -> entry mappings.

Legacy implementation compatibility layer.

This module is no longer the pipeline entrypoint. The staged pipeline lives in
`scripts/oald_pipeline/{extract,normalize,relate,emit}.py`.

Current role of this file:
- keep the mature parsing and relation algorithms available while the staged
  pipeline is being decomposed further
- provide stable low-level helpers reused by the new pipeline modules

Constraints:
- do not add new orchestration logic here
- new stage control flow belongs in the staged pipeline modules
- long-term goal is to shrink this file until only truly shared helpers remain
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

VALID_POS = {
    "n", "v", "adj", "adv", "int", "prep", "conj", "pron", "art", "num",
    "det", "modal", "abbr", "ordinal", "aux", "linking", "phrv", "idm",
    "prefix", "suffix", "combining", "short", "symbol", "infmarker",
}

# Mapping from OALD's full POS labels to compact POS keys.
# Example: "noun" -> "n", "phrasal verb" -> "phrv".
# Used by normalize_pos() to canonicalize part-of-speech strings.
POS_MAP = {
    "noun": "n", "verb": "v", "adjective": "adj", "adverb": "adv",
    "exclamation": "int", "preposition": "prep", "conjunction": "conj",
    "pronoun": "pron", "number": "num", "determiner": "det", "modal verb": "modal",
    "abbreviation": "abbr", "ordinal number": "ordinal", "auxiliary verb": "aux",
    "linking verb": "linking", "phrasal verb": "phrv", "idiom": "idm",
    "prefix": "prefix", "suffix": "suffix", "combining form": "combining",
    "short form": "short", "symbol": "symbol", "indefinite article": "art",
    "definite article": "art", "infinitive marker": "infmarker",
}

POS_DISPLAY = {
    "n": "n.", "v": "v.", "adj": "adj.", "adv": "adv.", "int": "int.",
    "prep": "prep.", "conj": "conj.", "pron": "pron.", "art": "art.",
    "num": "num.", "det": "det.", "modal": "modal.", "abbr": "abbr.",
    "ordinal": "ordinal.", "aux": "aux.", "linking": "linking.",
    "phrv": "phrv.", "idm": "idm.", "prefix": "prefix.", "suffix": "suffix.",
    "combining": "combining.", "short": "short.", "symbol": "symbol.",
    "infmarker": "infmarker.",
}

# Mapping from MDX verb form attribute names to compact exchange keys.
# These keys are used in the exchange string format (e.g., "3:walks/p:walked").
# "thirdps" -> "3" (3rd person singular), "past" -> "p", "pastpart"/"ptpp" -> "d" (past participle), "prespart" -> "i" (present participle).
EXCHANGE_LABELS = {"thirdps": "3", "past": "p", "pastpart": "d", "ptpp": "d", "prespart": "i"}

PUNCTUATION_MAP = str.maketrans({
    "［": "[",
    "］": "]",
    "【": "[",
    "】": "]",
    "｛": "{",
    "｝": "}",
    "（": "(",
    "）": ")",
    "，": ",",
    ";": "；",
})

# Chinese display labels for exchange keys.
# Maps compact exchange keys to human-readable Chinese labels used in
# the UI and relation metadata. Used by build_exchange_lines() and
# classify_inflection_parent().
EXCHANGE_DISPLAY_LABELS = {
    "3": "第三人称单数",
    "p": "过去式",
    "d": "过去分词",
    "i": "现在分词",
    "s": "复数",
    "c": "比较级",
    "sup": "最高级",
}
VERB_FORM_LABELS = {
    "root": "原形",
    "thirdps": "第三人称单数",
    "past": "过去式",
    "pastpart": "过去分词",
    "ptpp": "过去分词",
    "prespart": "现在分词",
}

# Display order for exchange keys when serializing or rendering exchange strings.
# This order ensures verb forms (3rd person, past, past participle, present participle)
# appear before noun/adjective forms (plural, comparative, superlative).
# Used by serialize_exchange_values() and build_exchange_lines().
EXCHANGE_DISPLAY_ORDER = ["3", "p", "d", "i", "s", "c", "sup"]
WORD_FAMILY_POS = {
    "noun": "noun",
    "verb": "verb",
    "adjective": "adjective",
    "adverb": "adverb",
    "n": "noun",
    "v": "verb",
    "adj": "adjective",
    "adv": "adverb",
}

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

# Mapping of irregular nouns to their plural forms.
# Used by infer_plural_form() to avoid generating regular plural forms
# for words that have irregular plurals (e.g., "child" -> "children").
IRREGULAR_PLURALS: dict[str, str] = {
    "child": "children",
    "man": "men",
    "woman": "women",
    "foot": "feet",
    "tooth": "teeth",
    "mouse": "mice",
    "goose": "geese",
    "ox": "oxen",
    "person": "people",
    "cactus": "cacti",
    "focus": "foci",
    "fungus": "fungi",
    "nucleus": "nuclei",
    "syllabus": "syllabi",
    "analysis": "analyses",
    "crisis": "crises",
    "phenomenon": "phenomena",
    "criterion": "criteria",
    "datum": "data",
}

# Delimiter used to join multiple meaning fragments within a single meaning item.
# Example: "fragment1, fragment2" becomes a single meaning text.
FRAGMENT_JOINER = ","

# Delimiter used to join multiple meaning items when building the final translation string.
# Example: "n. meaning1；meaning2" separates different meanings for display.
MEANING_JOINER = "；"
QUALIFIER_LEFT = "("
QUALIFIER_RIGHT = ")"

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

# Maps inflection relation labels to the exchange keys they are allowed to inherit.
# None means keep all (used for the base form).
LABEL_TO_EXCHANGE_KEY: dict[str, str | None] = {
    "原形": None,
    "第三人称单数": "3",
    "过去式": "p",
    "过去分词": "d",
    "现在分词": "i",
    "复数": "s",
    "比较级": "c",
    "最高级": "sup",
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
    pos_lower = normalize_display_text(pos_raw).lower()
    if not pos_lower:
        return None

    parts = [
        part.strip()
        for part in re.split(r"\s*,\s*|\s*/\s*|\s+and\s+", pos_lower)
        if part.strip()
    ]
    if len(parts) > 1:
        mapped_parts = [normalize_pos(part) for part in parts]
        valid_parts = [part for part in mapped_parts if part]
        return "+".join(valid_parts) if valid_parts else None

    # Exact match first. This keeps OALD labels like "modal verb" distinct
    # instead of collapsing them to the generic "v".
    if pos_lower in POS_MAP:
        return POS_MAP[pos_lower]

    for key in sorted(POS_MAP, key=len, reverse=True):
        val = POS_MAP[key]
        if re.search(rf'\b{re.escape(key)}\b', pos_lower):
            return val

    return None


def format_pos_label(pos_norm: str) -> str:
    labels = [
        POS_DISPLAY.get(part, f"{part}.")
        for part in pos_norm.split("+")
        if part
    ]
    return " / ".join(labels)


def is_valid_pos_norm(pos_norm: str | None) -> bool:
    if not pos_norm:
        return False
    return all(part in VALID_POS for part in pos_norm.split("+") if part)


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


def strip_bracket_content(text: str) -> str:
    return re.sub(r"[（(].*?[）)]", "", text)


def strip_long_brackets_only(text: str, max_chinese_chars: int = 7) -> str:
    """Remove only bracket blocks whose Chinese char count exceeds the threshold."""
    def replacer(match: re.Match[str]) -> str:
        """Regex replacer callback that decides whether to keep or drop a bracket block.

        Called by re.sub() for each bracket match found in the text.
        Counts Chinese characters inside the brackets; if the count exceeds
        max_chinese_chars, the entire bracket block is removed (returns empty string).
        Otherwise the original match is preserved unchanged.

        Args:
            match: A regex Match object for a bracket block pattern [（(](.*?)[）)].

        Returns:
            Empty string to remove the bracket block, or the original matched text to keep it.
        """
        content = match.group(1)
        chinese_count = len(re.findall(r"[一-鿿]", content))
        if chinese_count > max_chinese_chars:
            return ""
        return match.group(0)

    result = re.sub(r"[（(](.*?)[）)]", replacer, text)
    return re.sub(r"\s+", " ", result).strip()


def build_meaning_dedupe_key(text: str) -> str:
    cleaned = normalize_display_text(strip_bracket_content(text))
    return re.sub(r"[，,；;、\s]+", "", cleaned)


def extract_semantic_qualifier(sense: BeautifulSoup) -> str:
    qualifiers: list[str] = []
    for chn_tag in sense.select(".dis-g chn"):
        qualifier = normalize_display_text(chn_tag.get_text(strip=True))
        if qualifier and qualifier not in qualifiers:
            qualifiers.append(qualifier)
    return ",".join(qualifiers)


def extract_countability(sense: BeautifulSoup) -> str | None:
    grammar_text = " ".join(
        normalize_display_text(grammar_tag.get_text(" ", strip=True))
        for grammar_tag in sense.select(".grammar")
    ).lower()
    grammar_tokens = set(re.findall(r"[a-z]+", grammar_text))
    has_countable = "countable" in grammar_tokens
    has_uncountable = "uncountable" in grammar_tokens

    if has_countable and has_uncountable:
        return "both"
    if has_countable:
        return "countable"
    if has_uncountable:
        return "uncountable"
    return None


def merge_countability_values(values: list[str | None]) -> str | None:
    normalized_values = {value for value in values if value}
    if not normalized_values:
        return None
    if len(normalized_values) == 1:
        return next(iter(normalized_values))
    return None


def prepend_qualifier(text: str, qualifier: str) -> str:
    normalized_text = normalize_display_text(text)
    if not qualifier or normalized_text.startswith((QUALIFIER_LEFT, "（")):
        return normalized_text
    return f"{QUALIFIER_LEFT}{qualifier}{QUALIFIER_RIGHT}{normalized_text}"


def extract_unique_fragments(text: str) -> list[str]:
    raw_fragments: list[str] = []
    for fragment in split_by_delimiters_keep_brackets(text):
        normalized_fragment = normalize_display_text(fragment)
        if not normalized_fragment:
            continue
        raw_fragments.append(normalized_fragment)

    # Count dedupe-key frequencies and track max bracket length per key.
    key_counts: dict[str, int] = {}
    key_max_bracket_chinese: dict[str, int] = {}
    for fragment in raw_fragments:
        key = build_meaning_dedupe_key(fragment)
        if key:
            key_counts[key] = key_counts.get(key, 0) + 1
            chinese_counts = [
                len(re.findall(r"[一-鿿]", m))
                for m in re.findall(r"[（(](.*?)[）)]", fragment)
            ]
            max_chinese = max(chinese_counts) if chinese_counts else 0
            if max_chinese > key_max_bracket_chinese.get(key, 0):
                key_max_bracket_chinese[key] = max_chinese

    fragments: list[str] = []
    seen_keys: set[str] = set()
    for fragment in raw_fragments:
        key = build_meaning_dedupe_key(fragment)
        if not key or key in seen_keys:
            continue
        seen_keys.add(key)

        clean_fragment = strip_bracket_content(fragment).strip()
        should_strip = False
        max_bracket_chinese = key_max_bracket_chinese.get(key, 0)

        # v3.2.0 rule 1: multiple fragments deduped to same key.
        # Strip brackets only if any bracket content exceeds 7 Chinese chars.
        # Otherwise keep the first fragment's brackets.
        if key_counts.get(key, 0) > 1:
            if max_bracket_chinese > 7:
                should_strip = True
        # v3.2.0 rule 2: single fragment with bracket content > 7 Chinese chars.
        # Strip only the long brackets, keep short ones.
        elif clean_fragment != fragment and max_bracket_chinese > 7:
            clean_fragment = strip_long_brackets_only(fragment)
            fragments.append(clean_fragment if clean_fragment else fragment)
            continue

        fragments.append(clean_fragment if should_strip else fragment)

    return fragments


def pick_followup_fragment(fragments: list[str], qualifier: str) -> str | None:
    if not fragments:
        return None
    if qualifier:
        preferred_fragments = [fragment for fragment in fragments if build_meaning_dedupe_key(fragment) != "存在"]
        if preferred_fragments:
            return preferred_fragments[0]
    return fragments[0]


def _extract_labels_text(sense: BeautifulSoup) -> str:
    """Extract label text from a sense element."""
    labels = sense.select(".labels .lb")
    return " ".join(
        normalize_display_text(lb.get_text(strip=True))
        for lb in labels
    )


def collect_sense_records(eroot: BeautifulSoup) -> list[dict[str, Any]]:
    core_senses = extract_core_senses(eroot)
    fallback_senses = eroot.select("li.sense") if not core_senses else []
    candidate_senses = core_senses or fallback_senses
    sense_records: list[dict[str, Any]] = []
    for sense in candidate_senses:
        chn_tag = sense.select_one("deft chn")
        if not chn_tag:
            continue
        text = normalize_display_text(chn_tag.get_text(strip=True))
        if not text:
            continue
        # v3.2.0: Detect old-fashioned marker and append it to the end.
        labels_text = _extract_labels_text(sense)
        if "old-fashioned" in labels_text.lower() or "老式用法" in labels_text:
            text = f"{text} [老式用法]"
        sense_records.append(
            {
                "text": text,
                "qualifier": extract_semantic_qualifier(sense),
                "countability": extract_countability(sense),
            }
        )
    if sense_records:
        return sense_records

    xref = eroot.select_one(".xrefs")
    if not xref:
        return []
    xt = xref.get("xt", "")
    template = XREF_INFLECTION_TEMPLATES.get(xt)
    if not template:
        return []
    xh = xref.select_one(".xh")
    if not xh:
        return []
    word = xh.get_text(strip=True)
    if not word:
        return []
    return [{"text": template.format(word=word), "qualifier": "", "countability": None}]


def select_primary_fragments(
    sense_records: list[dict[str, Any]], used_keys: set[str]
) -> tuple[list[str], str, list[str | None], list[dict[str, Any]]]:
    pending_records: list[dict[str, Any]] = []
    primary_fragments: list[str] = []
    primary_qualifier = ""
    primary_countability_values: list[str | None] = []

    for index, record in enumerate(sense_records):
        fragments = [
            fragment
            for fragment in extract_unique_fragments(record["text"])
            if build_meaning_dedupe_key(fragment) not in used_keys
        ]
        if not fragments:
            continue

        if index == 0:
            primary_qualifier = record["qualifier"]
            primary_fragments = fragments[:2]
            if primary_fragments:
                primary_countability_values.append(record.get("countability"))
            if len(primary_fragments) < 2:
                pending_records.append(
                    {
                        "qualifier": record["qualifier"],
                        "fragments": fragments[len(primary_fragments):],
                        "countability": record.get("countability"),
                    }
                )
            for fragment in primary_fragments:
                used_keys.add(build_meaning_dedupe_key(fragment))
            continue

        pending_records.append(
            {
                "qualifier": record["qualifier"],
                "fragments": fragments,
                "countability": record.get("countability"),
            }
        )

    return primary_fragments, primary_qualifier, primary_countability_values, pending_records


def fill_primary_from_followups(
    primary_fragments: list[str],
    primary_countability_values: list[str | None],
    pending_records: list[dict[str, Any]],
    used_keys: set[str],
) -> tuple[list[str], list[str | None]]:
    next_fragments = [*primary_fragments]
    next_countability_values = [*primary_countability_values]
    for pending_record in pending_records:
        if len(next_fragments) >= 2:
            break
        for fragment in pending_record["fragments"]:
            dedupe_key = build_meaning_dedupe_key(fragment)
            if dedupe_key in used_keys:
                continue
            next_fragments.append(fragment)
            next_countability_values.append(pending_record.get("countability"))
            used_keys.add(dedupe_key)
            if len(next_fragments) >= 2:
                break
    return next_fragments, next_countability_values


def build_meaning_items(sense_records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(sense_records) == 1:
        only_record = sense_records[0]
        return [{
            "text": prepend_qualifier(only_record["text"], only_record["qualifier"]),
            "countability": only_record.get("countability"),
        }]

    used_keys: set[str] = set()
    meanings: list[dict[str, Any]] = []
    primary_fragments, primary_qualifier, primary_countability_values, pending_records = select_primary_fragments(sense_records, used_keys)

    if primary_fragments:
        primary_fragments, primary_countability_values = fill_primary_from_followups(
            primary_fragments,
            primary_countability_values,
            pending_records,
            used_keys,
        )
        meanings.append({
            "text": prepend_qualifier(FRAGMENT_JOINER.join(primary_fragments), primary_qualifier),
            "countability": merge_countability_values(primary_countability_values),
        })

    for pending_record in pending_records:
        fragments = [
            fragment
            for fragment in pending_record["fragments"]
            if build_meaning_dedupe_key(fragment) not in used_keys
        ]
        if not fragments:
            continue
        followup_fragment = pick_followup_fragment(fragments, str(pending_record["qualifier"]))
        if not followup_fragment:
            continue
        used_keys.add(build_meaning_dedupe_key(followup_fragment))
        meanings.append({
            "text": prepend_qualifier(followup_fragment, str(pending_record["qualifier"])),
            "countability": pending_record.get("countability"),
        })

    return meanings


def extract_meaning_items(soup: BeautifulSoup) -> dict[str, list[dict[str, Any]]]:
    sense_records_by_pos: dict[str, list[dict[str, Any]]] = {}

    for eroot in soup.select(".oald-entry-root"):
        pos_tag = eroot.select_one(".pos")
        if not pos_tag:
            continue
        pos_norm = normalize_pos(pos_tag.get_text(strip=True))
        if not is_valid_pos_norm(pos_norm):
            continue

        sense_records = collect_sense_records(eroot)
        if sense_records:
            sense_records_by_pos.setdefault(pos_norm, []).extend(sense_records)

    pos_data: dict[str, list[dict[str, Any]]] = {}
    for pos_norm, sense_records in sense_records_by_pos.items():
        meanings = build_meaning_items(sense_records)
        if meanings:
            pos_data[pos_norm] = meanings

    return pos_data


def extract_meanings(soup: BeautifulSoup) -> dict[str, list[str]]:
    """Extract Chinese meaning texts grouped by POS from an MDX entry's HTML.

    Walks through all .oald-entry-root elements in the parsed HTML, collects
    sense records for each valid POS, deduplicates and filters meaning fragments,
    then returns a mapping from normalized POS key to a list of meaning strings.

    The meaning joining logic works as follows:
    - For single-sense entries, the qualifier (if any) is prepended to the text.
    - For multi-sense entries, up to 2 primary fragments are selected from the
      first sense record. If fewer than 2, follow-up fragments from subsequent
      senses are used to fill the primary slot (up to 2 total).
    - Remaining fragments from other senses become separate meaning items,
      each with its own qualifier prepended.
    - Fragments are deduplicated by a cleaned key (brackets and punctuation
      removed) to avoid redundant meanings.

    Args:
        soup: A BeautifulSoup object parsed from an MDX entry's HTML.

    Returns:
        A dict mapping POS keys (e.g., "n", "v", "adj") to lists of meaning strings.
        Empty meanings are filtered out.
    """
    return {
        pos_norm: [meaning["text"] for meaning in meanings]
        for pos_norm, meanings in extract_meaning_items(soup).items()
        if meanings
    }


def extract_exchange(soup: BeautifulSoup) -> str:
    """Extract word form exchanges (inflections) from an MDX entry's HTML.

    Combines data from two sources:
    1. The verb_forms_table: contains structured verb forms (3rd person singular,
       past tense, past participle, present participle) mapped to compact keys.
    2. The inflections block: contains plural forms and other inflected forms.

    Verb forms from the table are mapped using EXCHANGE_LABELS (e.g., "thirdps" -> "3").
    Invalid third-person forms ending in "ing" (like "understanding") are filtered out
    since they are typically gerunds, not true 3rd person singular forms.

    Inflection block forms are all tagged with "s:" (plural slot). Forms that already
    appear in the verb_forms_table are skipped to avoid duplication, unless the block
    explicitly mentions "plural" (to handle cases where a plural form coincidentally
    matches a verb form).

    Args:
        soup: A BeautifulSoup object parsed from an MDX entry's HTML.

    Returns:
        An exchange string in the format "key:form/key:form/...", e.g. "3:walks/p:walked/s:walks".
        Returns an empty string if no exchange forms are found.
    """
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


def extract_verb_forms(soup: BeautifulSoup) -> list[dict[str, str]]:
    """Extract structured verb form data from an MDX entry's verb_forms_table.

    Parses the HTML table containing verb conjugations (root, 3rd person singular,
    past tense, past participle, present participle) and returns a list of
    structured form objects. Each object contains the form label (e.g., "过去式"),
    the inflected word, optional subject pronoun (e.g., "I", "he/she/it"),
    optional phonetic transcription, and the raw form type key.

    Duplicate entries are deduplicated by a composite key of (form_type, label,
    subject, word) to handle cases where the same form appears multiple times
    in the table (e.g., shared past/past participle forms).

    Args:
        soup: A BeautifulSoup object parsed from an MDX entry's HTML.

    Returns:
        A list of dicts, each representing a verb form with keys:
        - "label": Human-readable Chinese label (e.g., "过去式")
        - "word": The inflected form text
        - "form" (optional): Raw form type key (e.g., "past", "thirdps")
        - "subject" (optional): Subject pronoun prefix if present
        - "phonetic" (optional): Phonetic transcription without slashes
    """
    forms: list[dict[str, str]] = []
    vf_table = soup.select_one(".verb_forms_table")
    if not vf_table:
        return forms

    seen: set[tuple[str, str, str]] = set()
    for tr in vf_table.select("tr"):
        form_type = tr.get("form", "")
        label = VERB_FORM_LABELS.get(form_type, normalize_display_text(tr.get_text(" ", strip=True)))
        tds = tr.select("td")
        if not tds:
            continue

        word_cell = tds[0]
        prefix = word_cell.select_one(".vf_prefix")
        subject = normalize_display_text(prefix.get_text(" ", strip=True)) if prefix else ""
        if prefix:
            prefix.extract()

        form_word = normalize_display_text(word_cell.get_text(" ", strip=True))
        if not form_word:
            continue

        phonetic_tag = tr.select_one(".phon")
        item: dict[str, str] = {
            "label": label,
            "word": form_word,
        }
        if form_type:
            item["form"] = form_type
        if subject:
            item["subject"] = subject
        if phonetic_tag:
            item["phonetic"] = phonetic_tag.get_text(strip=True).replace("/", "")

        key = (item.get("form", ""), item["label"], item.get("subject", ""), item["word"])
        if key in seen:
            continue
        seen.add(key)
        forms.append(item)

    return forms


def normalize_word_family_pos(pos_text: str) -> str:
    normalized = normalize_display_text(pos_text).lower().replace(".", "")
    return WORD_FAMILY_POS.get(normalized, normalized)


def extract_word_family(soup: BeautifulSoup) -> list[dict[str, str]]:
    containers = soup.select('[unbox="wordfamily"], .wordfamily, .word_family')
    if not containers:
        containers = [
            tag.parent
            for tag in soup.find_all(string=re.compile(r"\bWord Family\b", re.I))
            if tag.parent
        ]

    result: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for container in containers:
        text = normalize_display_text(container.get_text(" ", strip=True))
        if "word family" not in text.lower():
            continue

        structured_items = []
        for item in container.select(".p"):
            word_tag = item.select_one(".wfw")
            pos_tag = item.select_one(".wfp")
            if not word_tag or not pos_tag:
                continue
            word_text = normalize_display_text(word_tag.get_text(" ", strip=True))
            pos = normalize_word_family_pos(pos_tag.get("wfp") or pos_tag.get_text(" ", strip=True))
            if not word_text or not pos:
                continue
            key = (word_text.lower(), pos)
            if key in seen:
                continue
            seen.add(key)
            structured_items.append({"word": word_text, "pos": pos, "relation": "词族"})
        if structured_items:
            result.extend(structured_items)
            continue

        for bracket in container.find_all(string=re.compile(r"[（(]\s*[≠=]")):
            bracket.extract()

        candidates = container.select(".w, .xh, .headword, a[href*='entry://'], a[href*='/definition/']")
        if candidates:
            for candidate in candidates:
                word_text = normalize_display_text(candidate.get_text(" ", strip=True))
                if not word_text or word_text.lower() == "word family":
                    continue
                next_text = ""
                sibling = candidate.find_next_sibling()
                if sibling:
                    next_text = normalize_display_text(sibling.get_text(" ", strip=True))
                pos = normalize_word_family_pos(next_text)
                if pos not in WORD_FAMILY_POS.values():
                    parent_text = normalize_display_text(candidate.parent.get_text(" ", strip=True)) if candidate.parent else ""
                    match = re.search(rf"\b{re.escape(word_text)}\b\s+(noun|verb|adjective|adverb|n\.?|v\.?|adj\.?|adv\.?)\b", parent_text, re.I)
                    pos = normalize_word_family_pos(match.group(1)) if match else ""
                if not pos:
                    continue
                key = (word_text.lower(), pos)
                if key not in seen:
                    seen.add(key)
                    result.append({"word": word_text, "pos": pos, "relation": "词族"})
            if result:
                return result

        clean_text = re.sub(r"[（(]\s*[≠=].*?[）)]", " ", text)
        matches = re.finditer(r"\b([A-Za-z][A-Za-z'-]*)\b\s+(noun|verb|adjective|adverb|n\.?|v\.?|adj\.?|adv\.?)\b", clean_text, re.I)
        for match in matches:
            word_text = match.group(1)
            if word_text.lower() == "word":
                continue
            pos = normalize_word_family_pos(match.group(2))
            key = (word_text.lower(), pos)
            if key not in seen:
                seen.add(key)
                result.append({"word": word_text, "pos": pos, "relation": "词族"})

    return result


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


# Primary processing: migrates comparative/superlative forms from s-slot
# to c/sup slots during data generation. The TypeScript runtime has a
# safety net for any edge cases missed here (~239 entries).
def move_surface_comparatives_into_exchange_slots(
    exchange_values: dict[str, list[str]], pos_summary: str, base_word: str = ""
) -> dict[str, list[str]]:
    """Move comparative/superlative forms from the 's' slot to 'c'/'sup' slots.

    The MDX source sometimes places comparative and superlative forms in the
    generic 's' exchange slot (alongside plural forms). This function scans
    the 's' slot, identifies forms that are actually comparatives or superlatives,
    and moves them to their proper dedicated slots ('c' for comparative, 'sup'
    for superlative).

    Movement logic:
    - Known irregular comparatives (e.g., "more", "better") -> 'c' slot.
    - Known irregular superlatives (e.g., "most", "best") -> 'sup' slot.
    - Multi-word forms (contain space) -> stay in 's' (not comparative/superlative).
    - Forms ending in "er" with adjective/adverb POS -> 'c' slot if they look
      like regular comparatives of the base word.
    - Forms ending in "est" with adjective/adverb POS -> 'sup' slot if they look
      like regular superlatives of the base word.
    - All other forms remain in the 's' slot.

    If the 's' slot becomes empty after movement, it is removed entirely.

    Args:
        exchange_values: Parsed exchange values dict (key -> list of forms).
        pos_summary: POS summary string (e.g., "n:50/v:50") to check for adj/adv.
        base_word: The base word for comparative/superlative validation. Optional;
            if empty, endings are trusted without base-word verification.

    Returns:
        A new exchange_values dict with comparatives/superlatives moved to
        their proper slots. The original dict is not mutated.
    """
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
    """Build a simple relation object linking a word to a label.

    Creates a minimal relation dict used for child/parent relation maps.
    The relation represents that `word` is related to the base word via
    the inflection type described by `label` (e.g., "复数", "过去式").

    Args:
        word: The related word (inflected form or base form).
        label: The relation label describing the inflection type.

    Returns:
        A dict with "word" and "label" keys.
    """
    return {"word": word, "label": label}


def build_pos_scope(label: str) -> list[str]:
    pos_order = ["n", "v", "adj", "adv"]
    allowed = INFLECTION_POS_FILTER.get(label, set())
    return [pos for pos in pos_order if pos in allowed]


def build_relation_edge(*, relation_type: str, target: str, label: str,
                        direction: str = "outgoing", navigable: bool = True,
                        display: str = "exchange", source: str = "exchange",
                        primary: bool = False) -> dict[str, Any]:
    """Build a structured relation edge for the relation_edges_map.

    A relation edge represents a directed link from a base word to a related
    form (or vice versa). It includes metadata about the relation type,
    navigability (whether the user can click through), display category,
    and source of the relation (exchange data vs. derived inference).

    The edge structure includes:
    - type: The relation category ("inflection", "origin", "xref")
    - target: The target word this edge points to
    - label: Human-readable label (e.g., "复数", "过去式")
    - direction: "outgoing" (base -> form) or "incoming" (form -> base)
    - navigable: Whether the UI should make this edge clickable
    - display: Display category ("exchange" or "reference")
    - source: Origin of the relation ("exchange", "derived", "protected")
    - pos_scope (optional): List of POS keys this relation applies to
    - primary (optional): Whether this is the primary relation for the target

    Args:
        relation_type: Category of relation ("inflection", "origin", "xref").
        target: The target word this edge points to.
        label: Human-readable label for the relation.
        direction: Edge direction, "outgoing" or "incoming". Defaults to "outgoing".
        navigable: Whether the edge is clickable in the UI. Defaults to True.
        display: Display category for UI rendering. Defaults to "exchange".
        source: Origin of the relation data. Defaults to "exchange".
        primary: Whether this is the primary relation. Defaults to False.

    Returns:
        A dict representing the relation edge with all metadata fields.
    """
    edge: dict[str, Any] = {
        "type": relation_type,
        "target": target,
        "label": label,
        "direction": direction,
        "navigable": navigable,
        "display": display,
        "source": source,
    }
    pos_scope = build_pos_scope(label)
    if pos_scope:
        edge["pos_scope"] = pos_scope
    if primary:
        edge["primary"] = True
    return edge


def append_relation_edge(target_map: dict[str, list[dict[str, Any]]],
                         word_key: str,
                         edge: dict[str, Any]) -> None:
    edges = target_map.setdefault(word_key, [])
    if edge not in edges:
        edges.append(edge)


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
    """Classify surface 's' slot forms to distinguish plural from comparative/superlative.

    The 's' exchange slot is overloaded: it can contain plural forms (for nouns),
    but MDX sometimes also places comparative/superlative-like forms there
    (e.g., "faster", "fastest" for adjectives). This function determines which
    forms in the 's' slot should be treated as genuine plural relations vs.
    which should be blocked (because they are actually comparatives/superlatives).

    Classification logic:
    - If the entry has no noun POS, all 's' forms are blocked (no plural relations).
    - If the entry has adjective/adverb POS, forms ending in "er"/"est" that are
      NOT also in the 3rd-person slot are flagged as blocked (they are comparatives).
    - Forms matching known irregular comparatives (e.g., "more", "better") are also blocked.
    - At least one non-blocked form must remain for plural relations to be allowed.

    Args:
        entry: A parsed entry dict containing "pos" and "exchange" fields.

    Returns:
        A tuple of (allow_relation, blocked_forms):
        - allow_relation: True if at least one 's' form can be treated as plural.
        - blocked_forms: Set of lowercase form strings that should NOT be treated as plural.
    """
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
    """Check if a given form is a regular inflection of the base word.

    Determines whether `form` can be derived from `base_word` using standard
    English inflection rules for the given `form_key`. This is used to
    distinguish regular inflections (which can be inferred algorithmically)
    from irregular ones (which must be explicitly recorded).

    Regular inflection rules covered:
    - "s" (plural): +s, +es, f->ves, fe->ves, y->ies
    - "3" (3rd person singular): +s, +es
    - "i" (present participle): +ing, e->ing, consonant doubling (run->running)
    - "c" (comparative): +er, e->r, consonant doubling, y->ier
    - "sup" (superlative): +est, e->st, consonant doubling, y->iest
    - "p"/"d" (past/past participle): +ed, e->d, consonant doubling, y->ied

    Args:
        base_word: The base/lemma form of the word.
        form: The potentially inflected form to check.
        form_key: The exchange key indicating the inflection type ("s", "3", "i", "c", "sup", "p", "d").

    Returns:
        True if `form` is a regular inflection of `base_word` for the given type.
    """
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


def infer_plural_form(word: str) -> str | None:
    """Infer the regular plural form of a noun using English pluralization rules.

    Applies standard English pluralization rules to derive the plural form
    from a singular noun. Irregular plurals are looked up in IRREGULAR_PLURALS
    rather than being generated by rule.

    Pluralization rules applied (in order):
    1. Irregular lookup: Check IRREGULAR_PLURALS for exceptions (e.g., "child" -> "children").
    2. Sibilants: Nouns ending in s, x, z, ch, sh -> +es (box -> boxes).
    3. Y-rule: Consonant + y -> -y + ies (baby -> babies).
    4. F-rule: Ending in f -> -f + ves (wolf -> wolves).
    5. FE-rule: Ending in fe -> -fe + ves (wife -> wives).
    6. O-rule: Consonant + o -> +es (potato -> potatoes).
    7. Default: Simply add +s (cat -> cats).

    Args:
        word: The singular noun form.

    Returns:
        The inferred plural form, or None if the input is empty/whitespace.
        For irregular nouns, returns the known irregular plural from IRREGULAR_PLURALS.
    """
    w = word.lower().strip()
    if not w:
        return None
    if w in IRREGULAR_PLURALS:
        return IRREGULAR_PLURALS[w]
    if w.endswith(("s", "x", "z", "ch", "sh")):
        return w + "es"
    if w.endswith("y") and len(w) > 1 and w[-2] not in "aeiou":
        return w[:-1] + "ies"
    if w.endswith("f") and len(w) > 1:
        return w[:-1] + "ves"
    if w.endswith("fe") and len(w) > 2:
        return w[:-2] + "ves"
    if w.endswith("o") and len(w) > 1 and w[-2] not in "aeiou":
        return w + "es"
    return w + "s"


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


def apply_relation_metadata(
    entry: dict[str, Any],
    *,
    entry_kind: str,
    display_word: str,
    relations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        **entry,
        "entry_kind": entry_kind,
        "display_word": display_word,
        "relations": relations or [],
    }


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

    pos = result.get("pos", "")
    if pos:
        filtered_parts = []
        for part in pos.split("/"):
            pos_key = part.split(":")[0]
            if pos_key in allowed_pos:
                filtered_parts.append(part)
        result["pos"] = "/".join(filtered_parts)

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

    translation_parts = result.get("translation_parts") or []
    if translation_parts:
        result["translation_parts"] = [
            {"pos": part["pos"], "meanings": [*part["meanings"]]}
            for part in translation_parts
            if part.get("pos", "").rstrip(".") in allowed_pos and part.get("meanings")
        ]

    translation_detail_parts = result.get("translation_detail_parts") or []
    if translation_detail_parts:
        result["translation_detail_parts"] = [
            {
                "pos": part["pos"],
                "details": [
                    {
                        "text": detail["text"],
                        **({"countability": detail["countability"]} if detail.get("countability") else {}),
                    }
                    for detail in part.get("details", [])
                    if detail.get("text")
                ],
            }
            for part in translation_detail_parts
            if part.get("pos", "").rstrip(".") in allowed_pos and part.get("details")
        ]

    # Filter exchange to only keep slots relevant to this inflection label.
    exchange = result.get("exchange", "")
    if exchange:
        allowed_keys: set[str] | None = set()
        for label in relation_label.split(","):
            key = LABEL_TO_EXCHANGE_KEY.get(label)
            if key is None:
                allowed_keys = None
                break
            allowed_keys.add(key)
        if allowed_keys is not None:
            values = parse_exchange_values(exchange)
            filtered_values = {k: v for k, v in values.items() if k in allowed_keys}
            result["exchange"] = serialize_exchange_values(filtered_values)

    return result


def create_inflection_entry(form: str, parent_entry: dict[str, Any], relation_label: str) -> dict[str, Any]:
    entry = filter_entry_pos_and_translation(parent_entry, relation_label)
    entry["word"] = form
    entry["linked_word"] = parent_entry["word"]

    return apply_relation_metadata(
        entry,
        entry_kind="inflection",
        display_word=parent_entry["word"],
        relations=[
            build_relation_edge(
                relation_type="origin",
                target=parent_entry["word"],
                label=relation_label,
                direction="outgoing",
                navigable=True,
                display="exchange",
                source="derived",
                primary=True,
            )
        ],
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


def build_translation_parts(pos_data: dict[str, list[str]]) -> list[dict[str, Any]]:
    return [
        {"pos": format_pos_label(pos_norm), "meanings": [*meanings]}
        for pos_norm, meanings in pos_data.items()
        if meanings
    ]


def build_translation_detail_parts(pos_data: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    return [
        {
            "pos": format_pos_label(pos_norm),
            "details": [
                {
                    "text": detail["text"],
                    **({"countability": detail["countability"]} if detail.get("countability") else {}),
                }
                for detail in details
            ],
        }
        for pos_norm, details in pos_data.items()
        if details
    ]


def build_translation(pos_data: dict[str, list[str]]) -> str:
    lines = []
    for part in build_translation_parts(pos_data):
        text = MEANING_JOINER.join(part["meanings"])
        lines.append(f"{part['pos']} {text}")
    return "\n".join(lines)


def build_pos_freq(pos_data: dict[str, list[str]]) -> str:
    total = sum(len(v) for v in pos_data.values())
    if total == 0:
        return ""
    parts = []
    for pos_norm, meanings in pos_data.items():
        if meanings:
            pct = round(len(meanings) / total * 100)
            parts.append(f"{pos_norm}:{pct}")
    return "/".join(parts)


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


def build_relation_metadata(
    standalone_cache: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[dict[str, str]]], dict[str, list[dict[str, str]]], dict[str, list[dict[str, Any]]], dict[str, set[str]]]:
    """Stage C-1: Build child/parent relation maps and blocked forms from parsed entries."""
    print("Stage C-1: Building relation metadata...")
    child_relations_map: dict[str, list[dict[str, str]]] = {}
    parent_relations_map: dict[str, list[dict[str, str]]] = {}
    relation_edges_map: dict[str, list[dict[str, Any]]] = {}
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
                if not label:
                    continue
                child_relations_map.setdefault(base_word, [])
                relation = build_relation(form, label)
                if relation not in child_relations_map[base_word]:
                    child_relations_map[base_word].append(relation)
                append_relation_edge(
                    relation_edges_map,
                    base_word,
                    build_relation_edge(
                        relation_type="inflection",
                        target=form,
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="exchange",
                    ),
                )
                if form_key == base_word:
                    continue
                if entry.get("pos") and form_key not in parent_relations_map:
                    parent_relations_map[form_key] = [build_relation(entry["word"], "原形")]
                    parent_relations_map[form_key][0]["_inflection_label"] = label
                elif entry.get("pos") and form_key in parent_relations_map:
                    # Create a separate relation for each label so that homographic
                    # forms like "leaves" (both 3rd person singular and plural of
                    # "leave") get distinct inflection_sources entries.
                    new_relation = build_relation(entry["word"], "原形")
                    new_relation["_inflection_label"] = label
                    parent_relations_map[form_key].append(new_relation)

        # Infer plural forms for nouns that have a self-plural (s:word) but also
        # a regular 3rd-person form (3:xxx) where xxx doubles as a plural.
        # Example: "score" has s:score (self-plural) and 3:scores, so "scores"
        # should also be queryable as a plural of "score".
        s_forms = exchange_values.get("s", [])
        thirdps_forms = exchange_values.get("3", [])
        if (
            s_forms
            and thirdps_forms
            and base_word not in IRREGULAR_PLURALS
            and "n" in parse_pos_keys(entry.get("pos", ""))
        ):
            if any(f.lower() == base_word for f in s_forms):
                for form in thirdps_forms:
                    form_key = form.lower()
                    if form_key == base_word:
                        continue
                    if form_key in blocked_forms:
                        continue
                    if not is_regular_inflection(base_word, form_key, "s"):
                        continue
                    label = "复数"
                    child_relations_map.setdefault(base_word, [])
                    relation = build_relation(form, label)
                    if relation not in child_relations_map[base_word]:
                        child_relations_map[base_word].append(relation)
                    append_relation_edge(
                        relation_edges_map,
                        base_word,
                        build_relation_edge(
                            relation_type="inflection",
                            target=form,
                            label=label,
                            direction="outgoing",
                            navigable=True,
                            display="exchange",
                            source="derived",
                        ),
                    )
                    if form_key not in parent_relations_map:
                        parent_relations_map[form_key] = [build_relation(entry["word"], "原形")]
                        parent_relations_map[form_key][0]["_inflection_label"] = label
                    else:
                        existing_parents = parent_relations_map[form_key]
                        has_plural_parent = any(
                            p.get("_inflection_label") == label for p in existing_parents
                        )
                        if not has_plural_parent:
                            new_parent = build_relation(entry["word"], "原形")
                            new_parent["_inflection_label"] = label
                            parent_relations_map[form_key].append(new_parent)

    # Infer plural forms for nouns that lack an explicit 's' slot in their exchange.
    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        pos_keys = parse_pos_keys(entry.get("pos", ""))
        if "n" not in pos_keys:
            continue
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        existing_s = set(f.lower() for f in exchange_values.get("s", []))
        if existing_s:
            continue
        # Skip if all noun senses are uncountable
        detail_parts = entry.get("translation_detail_parts", [])
        noun_details = [
            d for part in detail_parts
            if part.get("pos") == "n."
            for d in part.get("details", [])
        ]
        if noun_details and all(d.get("countability") == "uncountable" for d in noun_details):
            continue
        inferred = infer_plural_form(entry["word"])
        if not inferred or inferred.lower() == base_word:
            continue
        inf_key = inferred.lower()
        # Skip if already handled via exchange or blocked
        blocked = blocked_surface_forms_by_base.get(base_word, set())
        if inf_key in blocked:
            continue
        if inf_key in existing_s:
            continue
        label = EXCHANGE_DISPLAY_LABELS.get("s", "复数")
        # Always add child relation on the base side.
        child_relations_map.setdefault(base_word, [])
        relation = build_relation(inferred, label)
        if relation not in child_relations_map[base_word]:
            child_relations_map[base_word].append(relation)
        append_relation_edge(
            relation_edges_map,
            base_word,
            build_relation_edge(
                relation_type="inflection",
                target=inferred,
                label=label,
                direction="outgoing",
                navigable=True,
                display="exchange",
                source="derived",
            ),
        )
        # Add parent relation for the inferred plural if it does not already
        # have a plural relation.  This lets mixed-POS words like "part"
        # (where "parts" is already a third-person singular form) also
        # acquire a plural parent relation so noun senses are queryable.
        existing_parents = parent_relations_map.get(inf_key, [])
        has_plural_parent = any(
            p.get("_inflection_label") == label for p in existing_parents
        )
        if not has_plural_parent:
            new_parent = build_relation(entry["word"], "原形")
            new_parent["_inflection_label"] = label
            parent_relations_map.setdefault(inf_key, [])
            parent_relations_map[inf_key].append(new_parent)

    print(f"Stage C-1 complete: {len(child_relations_map)} bases with child relations")
    return child_relations_map, parent_relations_map, relation_edges_map, blocked_surface_forms_by_base


def finalize_standalone_entries(
    standalone_cache: dict[str, dict[str, Any]],
    child_relations_map: dict[str, list[dict[str, str]]],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Stage C-2: Apply relation metadata to standalone entries."""
    print("Stage C-2: Finalizing standalone entries...")
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

                        is_shared_past_surface = (
                            current_form_key in {"p", "d"}
                            and word_key in [f.lower() for f in base_exchange.get("p", [])]
                            and word_key in [f.lower() for f in base_exchange.get("d", [])]
                        )
                        if not is_shared_past_surface:
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
                                    append_relation_edge(
                                        relation_edges_map,
                                        word_key,
                                        build_relation_edge(
                                            relation_type="inflection",
                                            target=form,
                                            label=label,
                                            direction="outgoing",
                                            navigable=True,
                                            display="exchange",
                                            source="derived",
                                        ),
                                    )

        # Strip internal metadata fields from parent_relation before serializing.
        clean_parent_relation = None
        if parent_relation:
            clean_parent_relation = {k: v for k, v in parent_relation.items() if not k.startswith("_")}

        relations = [*relation_edges_map.get(word_key, [])]
        if clean_parent_relation:
            parent_label = primary_parent.get("_inflection_label", "原形") if potential_parents else "原形"
            relations = [
                build_relation_edge(
                    relation_type="origin",
                    target=clean_parent_relation["word"],
                    label=parent_label,
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                    primary=True,
                ),
                *relations,
            ]
        if len(potential_parents) > 1:
            for pp in potential_parents:
                labels = pp.get("_inflection_label", "")
                append_relation_edge(
                    relation_edges_map,
                    word_key,
                    build_relation_edge(
                        relation_type="origin",
                        target=pp["word"],
                        label=labels,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="derived",
                        primary=(pp is potential_parents[0]),
                    ),
                )
            relations = [*relation_edges_map.get(word_key, [])]

        if word_key in HOMOGRAPH_PROTECTED_FORMS:
            for base, label in HOMOGRAPH_PROTECTED_FORMS[word_key]:
                append_relation_edge(
                    relation_edges_map,
                    word_key,
                    build_relation_edge(
                        relation_type="xref",
                        target=base,
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="reference",
                        source="protected",
                    ),
                )
            relations = [*relation_edges_map.get(word_key, [])]

        finalized_entries[word_key] = apply_relation_metadata(
            entry,
            entry_kind="standalone",
            display_word=entry["word"],
            relations=relations,
        )

    print("Stage C-2 complete")
    return finalized_entries


def process_link_entries(
    finalized_entries: dict[str, dict[str, Any]],
    final_target: dict[str, str],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
    blocked_surface_forms_by_base: dict[str, set[str]],
    lookup: dict[str, str],
) -> int:
    """Stage C-3: Process link entries (@ @ @ LINK=) into inflections or aliases."""
    print("Stage C-3: Processing link entries...")
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
                    relation = build_relation(word, "复数")
                    append_relation_edge(
                        relation_edges_map,
                        plural_parent,
                        build_relation_edge(
                            relation_type="inflection",
                            target=word,
                            label="复数",
                            direction="outgoing",
                            navigable=True,
                            display="exchange",
                            source="derived",
                        ),
                    )
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
            if len(potential_parents) > 1:
                labels = [
                    pp.get("_inflection_label", "")
                    for pp in potential_parents
                    if pp.get("_inflection_label")
                ]
                inflection_label = ",".join(labels) if labels else None
            else:
                inflection_label = parent_relation.get("_inflection_label")
            # If no _inflection_label, it came from find_standalone_plural_parent
            if not inflection_label:
                inflection_label = "复数"

        if inflection_label:
            source_entry = filter_entry_pos_and_translation(source_entry, inflection_label)

        clean_parent_relation = {k: v for k, v in parent_relation.items() if not k.startswith("_")} if parent_relation else None
        relations: list[dict[str, Any]] = []
        if clean_parent_relation:
            relation_label = inflection_label or "原形"
            relations.append(
                build_relation_edge(
                    relation_type="origin",
                    target=clean_parent_relation["word"],
                    label=relation_label,
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                    primary=True,
                )
            )

        if len(potential_parents) > 1:
            relations = []
            for index, pp in enumerate(potential_parents):
                label = pp.get("_inflection_label", "原形")
                relations.append(
                    build_relation_edge(
                        relation_type="origin",
                        target=pp["word"],
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="derived",
                        primary=(index == 0),
                    )
                )

        data = apply_relation_metadata(
            {
                **source_entry,
                "word": word,
                "linked_word": target_entry["word"],
            },
            entry_kind=entry_kind,
            display_word=display_word,
            relations=relations,
        )
        finalized_entries[word_key] = data
        link_processed += 1
        if link_processed % REPORT_INTERVAL == 0:
            print(f"  Links processed: {link_processed}")

    print(f"Stage C-3 complete: {link_processed} links, {link_skipped} skipped")
    return link_processed


def materialize_missing_inflections(finalized_entries: dict[str, dict[str, Any]]) -> int:
    """Stage C-4: Create inflection entries for forms that lack standalone entries.

    After building relation metadata, some inflected forms (e.g., "walked", "cats")
    may not have their own standalone entry in the dictionary. This function scans
    all outgoing inflection relations on standalone entries and creates synthetic
    inflection entries for any target form that does not already exist in
    finalized_entries.

    Each materialized entry is a shallow copy of the parent entry with:
    - POS and translation filtered to only the relevant inflection type
    - word set to the inflected form
    - linked_word set to the parent/base word
    - entry_kind set to "inflection"
    - A primary "origin" relation edge pointing back to the parent

    This ensures that querying any inflected form returns a meaningful result
    with the parent's definitions, rather than a missing entry.

    Args:
        finalized_entries: The dictionary of all finalized entries, keyed by
            lowercase word. Will be mutated in-place to add new entries.

    Returns:
        The number of new inflection entries created.
    """
    print("Stage C-4: Materializing missing inflection entries...")
    materialized = 0
    for word_key, entry in list(finalized_entries.items()):
        if entry.get("entry_kind") != "standalone":
            continue

        for relation in entry.get("relations", []):
            if relation.get("type") != "inflection":
                continue
            if relation.get("direction") != "outgoing":
                continue
            form = relation["target"]
            form_key = form.lower()
            if form_key in finalized_entries:
                continue
            finalized_entries[form_key] = create_inflection_entry(form, entry, relation["label"])
            materialized += 1

    print(f"Stage C-4 complete: {materialized} entries materialized")
    return materialized


def write_shards(finalized_entries: dict[str, dict[str, Any]], total: int, processed: int, link_processed: int) -> None:
    """Stage D: Split entries into alphabetically-sharded JSON files.

    Groups all finalized entries by their first character (a-z) and writes
    each group to a separate JSON file (e.g., "a.json", "b.json"). This
    sharding strategy allows the Bob plugin to load only the relevant shard
    on demand, reducing memory usage and improving lookup speed.

    Shard writing strategy:
    - Entries are keyed by lowercase word; the first character determines the shard.
    - Each shard is a self-contained JSON object mapping word -> entry dict.
    - JSON is written with compact separators (",", ":") to minimize file size.
    - The output directory is created if it doesn't exist.

    After writing, prints a summary with entry counts and file sizes per shard.

    Args:
        finalized_entries: Complete dictionary of all entries (standalone,
            inflection, and alias), keyed by lowercase word.
        total: Total number of raw MDX entries (for reporting).
        processed: Number of non-link entries parsed (for reporting).
        link_processed: Number of link entries resolved (for reporting).
    """
    print("Stage D: Preparing shards...")
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
