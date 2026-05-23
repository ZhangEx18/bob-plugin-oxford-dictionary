#!/usr/bin/env python3
"""
Add word family relations to existing dictionary JSON files.
This script processes existing dict/*.json files and adds lexical_origin relations.
"""

import json
import os
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DICT_DIR = PROJECT_ROOT / "dict"

DERIVATIONAL_SUFFIXES = [
    "ness", "nesses",
    "ment", "ments",
    "tion", "tions", "sion", "sions",
    "ity", "ities",
    "er", "ers",
    "or", "ors",
    "ist", "ists",
    "ism", "isms",
    "ful",
    "less",
    "ous", "ious",
    "ive",
    "able", "ible",
    "al",
    "ic",
    "ly",
    "y",
    "ize", "ise",
    "en",
    "ify",
    "th",
    "dom",
    "ship",
    "hood",
    "age",
]

DERIVATIONAL_PREFIXES = ["un", "re", "dis", "over", "under", "mis", "out", "pre", "post"]


def extract_word_stem(word: str) -> set[str]:
    """Extract possible stems from a word."""
    word = word.lower()
    stems = {word}
    
    for suffix in DERIVATIONAL_SUFFIXES:
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            stem = word[:-len(suffix)]
            if stem:
                stems.add(stem)
    
    for prefix in DERIVATIONAL_PREFIXES:
        if word.startswith(prefix) and len(word) > len(prefix) + 2:
            stem = word[len(prefix):]
            if stem:
                stems.add(stem)
    
    return stems


def build_word_family_map(all_words: set[str]) -> dict[str, set[str]]:
    """Build a map of word families from a set of words."""
    stem_groups: dict[str, set[str]] = {}
    
    for word in all_words:
        stems = extract_word_stem(word)
        for stem in stems:
            if stem not in stem_groups:
                stem_groups[stem] = set()
            stem_groups[stem].add(word)
    
    # Filter to only stems with multiple words
    return {stem: words for stem, words in stem_groups.items() if len(words) >= 2}


def add_word_family_relations(entry: dict[str, Any], word_family: set[str]) -> dict[str, Any]:
    """Add word family relations to an entry."""
    if not word_family:
        return entry
    
    relations = entry.get("relations", [])
    if not isinstance(relations, list):
        relations = []
    
    word = entry.get("word", "").lower()
    
    for related_word in sorted(word_family):
        if related_word == word:
            continue
        
        # Check if relation already exists
        exists = any(
            r.get("type") == "lexical_origin" and r.get("target") == related_word
            for r in relations
        )
        if exists:
            continue
        
        relations.append({
            "type": "lexical_origin",
            "target": related_word,
            "label": "词族",
            "direction": "outgoing",
            "navigable": True,
            "display": "reference",
            "source": "word_family",
        })
    
    entry["relations"] = relations
    return entry


def process_dictionary():
    """Process all dictionary JSON files and add word family relations."""
    print("Loading dictionary entries...")
    
    all_entries: dict[str, dict[str, Any]] = {}
    all_words: set[str] = set()
    
    # Load all entries
    for json_file in sorted(DICT_DIR.glob("*.json")):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for word, entry in data.items():
                        if isinstance(entry, dict) and "word" in entry:
                            word_lower = word.lower()
                            all_entries[word_lower] = entry
                            all_words.add(word_lower)
        except Exception as e:
            print(f"Warning: Could not load {json_file}: {e}")
    
    print(f"Loaded {len(all_entries)} entries")
    
    # Build word family map
    print("Building word family map...")
    word_family_map = build_word_family_map(all_words)
    
    # Create word family lookup for each word
    word_to_families: dict[str, set[str]] = {}
    for stem, words in word_family_map.items():
        for word in words:
            if word not in word_to_families:
                word_to_families[word] = set()
            word_to_families[word].update(words)
    
    print(f"Found {len(word_family_map)} word family groups")
    
    # Add relations to entries
    print("Adding word family relations...")
    modified_count = 0
    for word, entry in all_entries.items():
        families = word_to_families.get(word, set())
        if families:
            all_entries[word] = add_word_family_relations(entry, families)
            modified_count += 1
    
    print(f"Modified {modified_count} entries with word family relations")
    
    # Save back to files
    print("Saving updated dictionary...")
    saved_count = 0
    for json_file in sorted(DICT_DIR.glob("*.json")):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            
            if isinstance(data, dict):
                modified = False
                for word, entry in data.items():
                    word_lower = word.lower()
                    if word_lower in all_entries:
                        data[word] = all_entries[word_lower]
                        modified = True
                
                if modified:
                    with open(json_file, "w", encoding="utf-8") as f:
                        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
                    saved_count += 1
        except Exception as e:
            print(f"Warning: Could not save {json_file}: {e}")
    
    print(f"Saved {saved_count} files")
    print("Done!")


if __name__ == "__main__":
    process_dictionary()
