#!/usr/bin/env python3
"""
Convert OALDPE (Oxford Advanced Learner's Dictionary 10th Ed) MDX to ECDict SQLite format.
Target: stardict.db compatible with Bob translation app.
Handles link entries by copying target data.
"""

import sqlite3
import re
from pathlib import Path
from bs4 import BeautifulSoup
from readmdict import MDX

# ========== Configuration ==========
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OALD_ROOT = PROJECT_ROOT / "vendor" / "oald" / "OALD 2024.09"
MDX_PATH = str(OALD_ROOT / "oaldpe.mdx")
OUTPUT_PATH = str(OALD_ROOT / "stardict.db")
BATCH_SIZE = 5000
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
    "s": "复数形式",
}

EXCHANGE_DISPLAY_ORDER = ["3", "p", "d", "i", "s"]


def normalize_display_text(text: str) -> str:
    normalized = text.translate(PUNCTUATION_MAP)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def normalize_pos(pos_raw: str) -> str | None:
    pos_lower = pos_raw.lower()
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
    for eroot in soup.select(".oald-entry-root"):
        pos_tag = eroot.select_one(".pos")
        if not pos_tag:
            continue
        pos_norm = normalize_pos(pos_tag.get_text(strip=True))
        if not pos_norm or pos_norm not in VALID_POS:
            continue
        if pos_norm not in pos_data:
            pos_data[pos_norm] = []
        for sense in extract_core_senses(eroot):
            chn_tag = sense.select_one("deft chn")
            if chn_tag:
                text = normalize_display_text(chn_tag.get_text(strip=True))
                first = re.split(r"[,;，；]", text)[0].strip()
                if first:
                    pos_data[pos_norm].append(first)
    return pos_data


def extract_english_defs(soup: BeautifulSoup) -> dict[str, list[str]]:
    pos_data: dict[str, list[str]] = {}
    for eroot in soup.select(".oald-entry-root"):
        pos_tag = eroot.select_one(".pos")
        if not pos_tag:
            continue
        pos_norm = normalize_pos(pos_tag.get_text(strip=True))
        if not pos_norm or pos_norm not in VALID_POS:
            continue
        if pos_norm not in pos_data:
            pos_data[pos_norm] = []
        for sense in extract_core_senses(eroot):
            def_tag = sense.select_one(".def")
            if def_tag:
                text = normalize_display_text(def_tag.get_text(strip=True))
                if text:
                    pos_data[pos_norm].append(text)
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


def extract_cefr_levels(soup: BeautifulSoup) -> str:
    levels = set()
    for sense in soup.select("li.sense[cefr]"):
        level = sense.get("cefr")
        if level:
            levels.add(level)
    return ",".join(sorted(levels)) if levels else ""


def extract_oxford(soup: BeautifulSoup) -> int:
    return 1 if soup.select_one(".ox3ksym_a1, .ox3ksym_a2, .ox3ksym_b1, .ox3ksym_b2, .ox3ksym_c1") else 0


def extract_audio(soup: BeautifulSoup) -> str:
    audio_tag = soup.select_one('.phons_br a.sound[href^="sound://"]')
    if audio_tag:
        return audio_tag.get("href", "").replace("sound://", "")
    return ""


def format_pos_text(text: str) -> str:
    normalized = text.replace(",", "，")
    normalized = normalized.replace(";", "；")
    normalized = normalized.replace("(", "（")
    normalized = normalized.replace(")", "）")
    normalized = normalized.replace("[", "［")
    normalized = normalized.replace("]", "］")
    normalized = normalized.replace("...", "…")
    return normalized


def build_exchange_lines(exchange: str) -> list[str]:
    if not exchange:
        return []
    parts = []
    values = {}
    for item in exchange.split("/"):
        if ":" not in item:
            continue
        key, value = item.split(":", 1)
        if key and value:
            values[key] = value
    for key in EXCHANGE_DISPLAY_ORDER:
        value = values.get(key)
        label = EXCHANGE_DISPLAY_LABELS.get(key)
        if value and label:
            parts.append(f"{label}：{value}")
    return parts


def build_translation(pos_data: dict[str, list[str]], exchange: str, phrasal_list: list[str]) -> str:
    lines = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron"]:
        if pos_norm in pos_data and pos_data[pos_norm]:
            text = "，".join(pos_data[pos_norm])
            lines.append(f"{pos_norm}. {format_pos_text(text)}")
    exchange_lines = build_exchange_lines(exchange)
    if exchange_lines:
        lines.append("词形变化：")
        lines.extend(exchange_lines)
    if phrasal_list:
        lines.append("Phrasal Verbs：")
        lines.extend(format_pos_text(pv) for pv in phrasal_list)
    return "\n".join(lines)


def build_definition(en_data: dict[str, list[str]]) -> str:
    lines = []
    for pos_norm in ["v", "n", "adj", "adv", "int", "prep", "conj", "pron"]:
        if pos_norm in en_data and en_data[pos_norm]:
            text = ", ".join(en_data[pos_norm])
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


def derive_parent(word: str, lookup: dict[str, str]) -> str | None:
    if word.endswith("ings"):
        base = word[:-1]
        if base in lookup:
            return base
    if word.endswith("ing"):
        base = word[:-3]
        if base in lookup:
            return base
    if word.endswith("s") and word[:-1] in lookup:
        return word[:-1]
    return None


def extract_phrasal_verbs(soup: BeautifulSoup, lookup: dict[str, str]) -> list[str]:
    result = []
    for section in soup.select(".phrasal_verb_links"):
        for li in section.select(".pvrefs li"):
            xh = li.select_one(".xh")
            if xh:
                pv_name = xh.get_text(strip=True)
                pv_html = lookup.get(pv_name, "")
                if pv_html.startswith("@@@LINK="):
                    target = pv_html.replace("@@@LINK=", "").strip()
                    pv_html = lookup.get(target, "")
                pv_meaning = ""
                if pv_html:
                    pv_soup = BeautifulSoup(pv_html, "lxml")
                    chn = pv_soup.select_one("deft chn")
                    if chn:
                        pv_meaning = chn.get_text(strip=True)
                pv_name = normalize_display_text(pv_name)
                if pv_meaning:
                    result.append(f"{pv_name} {normalize_display_text(pv_meaning)}")
                else:
                    result.append(pv_name)
    return result


def extract_idioms(soup: BeautifulSoup) -> list[str]:
    result = []
    for section in soup.select(".idioms"):
        for idm_g in section.select(".idm-g"):
            idm_tag = idm_g.select_one(".idm")
            if idm_tag:
                idm_text = idm_tag.get_text(strip=True)
                idm_text = re.sub(r"\s*\|\s*", " | ", idm_text)
                if idm_text and idm_text not in result:
                    result.append(idm_text)
    return result


def build_detail(phrasal_list: list[str], idiom_list: list[str]) -> str:
    lines = []
    if phrasal_list:
        for pv in phrasal_list:
            lines.append(pv)
    return "\n".join(lines)


def parse_entry(html: str, word: str, lookup: dict[str, str]) -> dict | None:
    """Parse a single entry's HTML and return field dict."""
    soup = BeautifulSoup(html, "lxml")

    phon_br, phon_us = extract_phonetic(soup)
    phonetic = phon_br or phon_us

    cn_data = extract_meanings(soup)
    if not cn_data:
        return None

    en_data = extract_english_defs(soup)
    phrasal = extract_phrasal_verbs(soup, lookup)
    exchange = extract_exchange(soup)
    translation = build_translation(cn_data, exchange, phrasal)
    definition = build_definition(en_data)
    pos = build_pos_freq(cn_data)
    tag = extract_cefr_levels(soup)
    oxford = extract_oxford(soup)
    audio = extract_audio(soup)

    idioms = extract_idioms(soup)
    detail = build_detail(phrasal, idioms)

    return {
        "word": word,
        "sw": word.lower(),
        "phonetic": phonetic,
        "definition": definition,
        "translation": translation,
        "pos": pos,
        "collins": 0,
        "oxford": oxford,
        "tag": tag,
        "bnc": None,
        "frq": None,
        "exchange": exchange,
        "detail": detail,
        "audio": audio,
    }


def init_database(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("DROP TABLE IF EXISTS stardict")
    conn.execute("""
        CREATE TABLE stardict (
            id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL UNIQUE,
            word VARCHAR(64) COLLATE NOCASE NOT NULL UNIQUE,
            sw VARCHAR(64) COLLATE NOCASE NOT NULL,
            phonetic VARCHAR(64),
            definition TEXT,
            translation TEXT,
            pos VARCHAR(16),
            collins INTEGER DEFAULT(0),
            oxford INTEGER DEFAULT(0),
            tag VARCHAR(64),
            bnc INTEGER DEFAULT(NULL),
            frq INTEGER DEFAULT(NULL),
            exchange TEXT,
            detail TEXT,
            audio TEXT
        )
    """)
    conn.execute("CREATE UNIQUE INDEX stardict_1 ON stardict (id)")
    conn.execute("CREATE UNIQUE INDEX stardict_2 ON stardict (word)")
    conn.execute("CREATE INDEX stardict_3 ON stardict (sw, word collate nocase)")
    conn.execute("CREATE INDEX sd_1 ON stardict (word collate nocase)")
    conn.commit()
    return conn


def main():
    print("Loading MDX dictionary...")
    mdx = MDX(MDX_PATH, encoding="utf-8")
    total = len(mdx)
    print(f"Total entries: {total}")

    # Build lookup dict
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

    # Resolve all links to final targets
    print("Resolving link chains...")
    final_target: dict[str, str] = {}
    for word, html in lookup.items():
        if html.startswith("@@@LINK="):
            target = html.replace("@@@LINK=", "").strip()
            # Follow chain
            visited = {word}
            while target in lookup and lookup[target].startswith("@@@LINK=") and target not in visited:
                visited.add(target)
                target = lookup[target].replace("@@@LINK=", "").strip()
            if target in lookup and not lookup[target].startswith("@@@LINK="):
                final_target[word] = target
    for word, target in alias_targets.items():
        if target in lookup:
            final_target[word] = target

    for word in list(final_target.keys()):
        parent = derive_parent(word, lookup)
        if parent and parent in lookup and not lookup[parent].startswith("@@@LINK="):
            final_target[word] = parent

    print(f"Resolved links: {len(final_target)}")

    # Init database
    print(f"Initializing database: {OUTPUT_PATH}")
    conn = init_database(OUTPUT_PATH)
    cursor = conn.cursor()

    insert_sql = """
        INSERT OR IGNORE INTO stardict
        (word, sw, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    # Phase 1: Process non-link entries
    print("Phase 1: Processing non-link entries...")
    batch: list[tuple] = []
    processed = 0
    skipped = 0
    cache: dict[str, dict] = {}  # word -> parsed data

    for word, html in lookup.items():
        if html.startswith("@@@LINK="):
            continue

        data = parse_entry(html, word, lookup)
        if data is None:
            skipped += 1
            continue

        cache[word] = data
        batch.append((
            data["word"], data["sw"], data["phonetic"], data["definition"],
            data["translation"], data["pos"], data["collins"], data["oxford"],
            data["tag"], data["bnc"], data["frq"], data["exchange"],
            data["detail"], data["audio"],
        ))

        if len(batch) >= BATCH_SIZE:
            cursor.executemany(insert_sql, batch)
            conn.commit()
            batch = []

        processed += 1
        if processed % REPORT_INTERVAL == 0:
            print(f"  Processed: {processed}")

    if batch:
        cursor.executemany(insert_sql, batch)
        conn.commit()

    print(f"Phase 1 complete: {processed} entries, {skipped} skipped")

    # Phase 2: Process link entries
    print("Phase 2: Processing link entries...")
    batch = []
    link_processed = 0
    link_skipped = 0

    for word, target in final_target.items():
        if target in cache and word.lower() not in cache:
            data = cache[target].copy()
            data["word"] = word
            data["sw"] = word.lower()
            data["linked_word"] = target
            batch.append((
                data["word"], data["sw"], data["phonetic"], data["definition"],
                data["translation"], data["pos"], data["collins"], data["oxford"],
                data["tag"], data["bnc"], data["frq"], data["exchange"],
                data["detail"], data["audio"],
            ))
            link_processed += 1
        else:
            link_skipped += 1

        if len(batch) >= BATCH_SIZE:
            cursor.executemany(insert_sql, batch)
            conn.commit()
            batch = []

        if link_processed % REPORT_INTERVAL == 0:
            print(f"  Links processed: {link_processed}")

    if batch:
        cursor.executemany(insert_sql, batch)
        conn.commit()

    print(f"Phase 2 complete: {link_processed} links inserted, {link_skipped} skipped")

    # Stats
    cursor.execute("SELECT COUNT(*) FROM stardict")
    inserted = cursor.fetchone()[0]
    conn.close()

    print(f"\nDone!")
    print(f"  Total MDX entries: {total}")
    print(f"  Non-link entries processed: {processed}")
    print(f"  Link entries inserted: {link_processed}")
    print(f"  Total in DB: {inserted}")
    print(f"  Skipped (no Chinese): {skipped}")
    print(f"  Output: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
