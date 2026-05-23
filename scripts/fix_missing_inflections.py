#!/usr/bin/env python3
"""Fix missing inflection entries caused by the relation_type/type field mismatch.

This script reads existing shards, finds inflection relation targets that don't
exist as entries, and creates minimal inflection entries for them.
"""

import json
import os
from pathlib import Path

DICT_DIR = Path(__file__).parent.parent / "dict"

def create_inflection_entry(word: str, parent_entry: dict, label: str) -> dict:
    """Create a minimal inflection entry pointing back to its parent."""
    return {
        "word": word,
        "entry_kind": "inflection",
        "phonetic": parent_entry.get("phonetic", ""),
        "phonetic_us": parent_entry.get("phonetic_us", ""),
        "translation": f"{parent_entry.get('word', '')} 的{label}",
        "pos": parent_entry.get("pos", ""),
        "exchange": "",
        "translation_parts": [],
        "linked_word": parent_entry.get("word", ""),
        "relations": [
            {
                "type": "origin",
                "target": parent_entry.get("word", ""),
                "label": "原形",
                "direction": "outgoing",
                "navigable": True,
                "display": "exchange",
                "source": "derived",
                "primary": True,
            }
        ],
    }

def main():
    shards: dict[str, dict[str, dict]] = {}

    # Load all shards
    for file in sorted(DICT_DIR.iterdir()):
        if not file.name.endswith(".json"):
            continue
        with open(file, "r", encoding="utf-8") as f:
            shards[file.stem] = json.load(f)

    # Build global key set
    all_keys = set()
    for shard in shards.values():
        all_keys.update(k.lower() for k in shard.keys())

    fixed = 0

    # Find missing inflection targets and create entries
    for shard in shards.values():
        for entry in list(shard.values()):
            if entry.get("entry_kind") != "standalone":
                continue
            for rel in entry.get("relations", []):
                if rel.get("type") != "inflection":
                    continue
                if rel.get("direction") != "outgoing":
                    continue
                target = rel["target"]
                target_key = target.lower()
                if target_key in all_keys:
                    continue

                # Create missing inflection entry
                new_entry = create_inflection_entry(target, entry, rel.get("label", ""))
                first_char = target_key[0] if target_key else "_"
                if first_char not in shards:
                    shards[first_char] = {}
                shards[first_char][target_key] = new_entry
                all_keys.add(target_key)
                fixed += 1
                print(f"Created inflection entry: {target} -> {entry.get('word', '')}")

    # Write back modified shards
    for char, shard in shards.items():
        path = DICT_DIR / f"{char}.json"
        with open(path, "w", encoding="utf-8") as f:
            json.dump(shard, f, ensure_ascii=False, separators=(",", ":"))

    print(f"\nDone! Created {fixed} missing inflection entries.")

if __name__ == "__main__":
    main()
