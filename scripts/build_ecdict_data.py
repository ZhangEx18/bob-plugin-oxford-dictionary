#!/usr/bin/env python3
"""Build ECDICT offline dictionary shards for the OALD Bob plugin.

Reads ECDICT data (SQLite preferred, CSV fallback), filters to entries
with Chinese translations, strips unnecessary fields, and emits
character-keyed JSON shards to the build output directory.

IMPORTANT: ECDICT data is distributed SEPARATELY from the .bobplugin package.
The build output shards are NOT bundled into the plugin archive. Users who
want the offline ECDICT fallback must download/place the shard files into the
installed plugin's data directory manually. The plugin probes ecdict/a.json
at runtime and enables the fallback layer only if data is present.

Usage:
    python3 scripts/build_ecdict_data.py
    python3 scripts/build_ecdict_data.py --csv /path/to/ecdict.csv
    python3 scripts/build_ecdict_data.py --db /path/to/stardict.db
    python3 scripts/build_ecdict_data.py --output /custom/output/dir

Output directory structure:
    .cache/oald-build/output/ecdict/
        a.json  - all ECDICT entries starting with 'a'
        b.json  - all ECDICT entries starting with 'b'
        ...
        z.json
        _.json  - entries starting with non-letter characters

After building, the ecdict/ directory must be placed inside the installed
plugin's data directory so that $file.read("ecdict/a.json") resolves at
runtime. In Bob, this is typically:
    ~/Library/Application Support/Bob/plugins/com.oald.dictionary/ecdict/

Each shard is a flat JSON object: { "word": { word, phonetic, translation, pos, exchange }, ... }

Fields kept (per EcdictEntry contract):
    - word: headword (lowercase)
    - phonetic: IPA pronunciation
    - translation: Chinese translation (newline-separated, POS-prefixed lines)
    - pos: part-of-speech tags (space-separated)
    - exchange: morphology string (e.g. "p:went/d:gone/i:going")

Fields stripped (not needed at runtime):
    - collins, oxford, bnc, frq, tag, detail, audio, definition
"""

import argparse
import csv
import json
import os
import sqlite3
import sys
from collections import defaultdict

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEFAULT_BUILD_ROOT = os.environ.get(
    "OALD_BUILD_ROOT",
    os.path.join(PROJECT_ROOT, ".cache", "oald-build"),
)
DEFAULT_OUTPUT_ROOT = os.environ.get(
    "OALD_OUTPUT_ROOT",
    os.path.join(DEFAULT_BUILD_ROOT, "output"),
)
DEFAULT_ECDICT_DIR = os.environ.get(
    "OALD_ECDICT_DIR",
    os.path.join(DEFAULT_OUTPUT_ROOT, "ecdict"),
)

KEEP_FIELDS = {"word", "phonetic", "translation", "pos", "exchange"}

DEFAULT_CSV_PATH = os.path.expanduser(
    "~/Downloads/word/ECDICT-master/ecdict.csv"
)
DEFAULT_DB_PATH = os.path.expanduser("~/Downloads/word/stardict.db")


def normalize_char(word):
    if not word:
        return "_"
    first = word[0].lower()
    if first.isalpha():
        return first
    return "_"


def read_from_db(db_path):
    entries = []
    conn = sqlite3.connect(db_path)
    try:
        cursor = conn.cursor()
        cursor.execute(
            "SELECT word, phonetic, translation, pos, exchange "
            "FROM stardict WHERE translation IS NOT NULL AND translation != ''"
        )
        for row in cursor:
            entries.append({
                "word": row[0] or "",
                "phonetic": row[1] or "",
                "translation": row[2] or "",
                "pos": row[3] or "",
                "exchange": row[4] or "",
            })
    finally:
        conn.close()
    return entries


def read_from_csv(csv_path):
    entries = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            translation = row.get("translation", "") or ""
            if not translation.strip():
                continue
            entries.append({
                "word": (row.get("word", "") or "").lower(),
                "phonetic": row.get("phonetic", "") or "",
                "translation": translation,
                "pos": row.get("tag", "") or "",
                "exchange": row.get("exchange", "") or "",
            })
    return entries


def deduplicate(entries):
    seen = set()
    result = []
    for entry in entries:
        key = entry["word"].lower()
        if key not in seen:
            seen.add(key)
            result.append(entry)
    return result


def build_shards(entries):
    shards = defaultdict(dict)
    for entry in entries:
        word = entry["word"].lower()
        if not word:
            continue
        char = normalize_char(word)
        shard_entry = {k: v for k, v in entry.items() if k in KEEP_FIELDS}
        shards[char][word] = shard_entry
    return shards


def write_shards(shards, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    for char, data in sorted(shards.items()):
        path = os.path.join(output_dir, f"{char}.json")
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        print(f"  {char}.json: {len(data)} entries")


def main():
    parser = argparse.ArgumentParser(
        description="Build ECDICT shard data for the OALD Bob plugin"
    )
    parser.add_argument(
        "--csv",
        default=DEFAULT_CSV_PATH,
        help="Path to ecdict.csv (used as fallback if --db not given)",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="Path to stardict.db SQLite (preferred over CSV)",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_ECDICT_DIR,
        help="Output directory for ecdict shards",
    )
    args = parser.parse_args()

    db_path = args.db
    csv_path = args.csv

    # Prefer SQLite for completeness (3.39M entries with translations)
    actual_db = db_path if db_path else DEFAULT_DB_PATH
    actual_csv = csv_path

    if os.path.isfile(actual_db):
        print(f"Reading from SQLite: {actual_db}")
        entries = read_from_db(actual_db)
    elif os.path.isfile(actual_csv):
        print(f"Reading from CSV: {actual_csv}")
        entries = read_from_csv(actual_csv)
    else:
        print(
            "ERROR: No data source found. Place stardict.db or ecdict.csv "
            "at the default paths, or specify --db / --csv explicitly.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"Raw entries with translations: {len(entries)}")

    for entry in entries:
        entry["word"] = entry["word"].lower()

    entries = deduplicate(entries)
    print(f"After dedup: {len(entries)} entries")

    shards = build_shards(entries)
    print(f"Shard count: {len(shards)}")

    print(f"\nWriting shards to {args.output}")
    write_shards(shards, args.output)

    total = sum(len(s) for s in shards.values())
    print(f"\nTotal entries written: {total}")


if __name__ == "__main__":
    main()