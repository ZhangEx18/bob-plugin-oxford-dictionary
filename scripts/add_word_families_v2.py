#!/usr/bin/env python3
"""
Add word family relations to existing dictionary JSON files.
Uses morphological rules to group words by their root form.
"""

import json
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DICT_DIR = PROJECT_ROOT / "dict"

# Common derivational suffixes that change word category
DERIVATIONAL_SUFFIXES = {
    # noun-forming suffixes
    "tion": "noun", "tions": "noun",
    "sion": "noun", "sions": "noun", 
    "ment": "noun", "ments": "noun",
    "ness": "noun", "nesses": "noun",
    "ity": "noun", "ities": "noun",
    "er": "noun", "ers": "noun",
    "or": "noun", "ors": "noun",
    "ist": "noun", "ists": "noun",
    "ism": "noun", "isms": "noun",
    "age": "noun",
    "dom": "noun",
    "ship": "noun",
    "hood": "noun",
    "th": "noun",
    # adjective-forming suffixes
    "ive": "adjective",
    "ous": "adjective", "ious": "adjective",
    "ful": "adjective",
    "less": "adjective",
    "able": "adjective", "ible": "adjective",
    "al": "adjective",
    "ic": "adjective",
    "y": "adjective",
    "ly": "adjective",
    "en": "adjective",
    # verb-forming suffixes
    "ize": "verb", "ise": "verb",
    "ify": "verb",
}

DERIVATIONAL_PREFIXES = {
    "un": "negative",
    "re": "again",
    "dis": "negative",
    "over": "excessive",
    "under": "insufficient",
    "mis": "wrong",
    "out": "surpass",
    "pre": "before",
    "post": "after",
    "de": "reverse",
    "in": "negative",
    "im": "negative",
    "il": "negative",
    "ir": "negative",
    "non": "negative",
    "anti": "against",
    "counter": "against",
    "sub": "under",
    "super": "above",
    "inter": "between",
    "trans": "across",
    "pro": "forward",
    "con": "together",
}


def get_pos_from_entry(entry: dict) -> str:
    """Extract primary part of speech from entry."""
    pos = entry.get("pos", "")
    if ":" in pos:
        pos = pos.split(":")[0]
    return pos


def extract_root(word: str) -> tuple[str, list[str]]:
    """
    Extract the root form of a word and list of affixes.
    Returns (root, [affixes]).
    """
    word = word.lower()
    root = word
    affixes = []
    
    # Try removing prefixes
    for prefix in sorted(DERIVATIONAL_PREFIXES.keys(), key=len, reverse=True):
        if word.startswith(prefix) and len(word) > len(prefix) + 2:
            candidate = word[len(prefix):]
            if candidate:
                root = candidate
                affixes.append(f"prefix:{prefix}")
                break
    
    # Try removing suffixes from the root
    for suffix in sorted(DERIVATIONAL_SUFFIXES.keys(), key=len, reverse=True):
        if root.endswith(suffix) and len(root) > len(suffix) + 2:
            candidate = root[:-len(suffix)]
            if candidate:
                root = candidate
                affixes.append(f"suffix:{suffix}")
                break
    
    # Handle spelling changes
    # e.g., decide -> decision (de + cide -> de + cis + ion)
    # e.g., decide -> decisive (de + cide -> de + cis + ive)
    if root.endswith("id"):
        root = root[:-2] + "is"
    elif root.endswith("ed"):
        root = root[:-2] + "e"
    elif root.endswith("ing"):
        root = root[:-3] + "e"
    
    return root, affixes


def build_word_family_map(all_entries: dict[str, dict]) -> dict[str, list[str]]:
    """Build a map of root -> [related words]."""
    root_map: dict[str, list[str]] = {}
    
    for word, entry in all_entries.items():
        root, affixes = extract_root(word)
        
        if root not in root_map:
            root_map[root] = []
        
        if word not in root_map[root]:
            root_map[root].append(word)
    
    # Filter to only roots with multiple words
    return {root: words for root, words in root_map.items() if len(words) >= 2}


def add_word_family_relations(entry: dict[str, Any], word_family: list[str]) -> dict[str, Any]:
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
    
    # Load all entries
    for json_file in sorted(DICT_DIR.glob("*.json")):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for word, entry in data.items():
                        if isinstance(entry, dict) and "word" in entry:
                            all_entries[word.lower()] = entry
        except Exception as e:
            print(f"Warning: Could not load {json_file}: {e}")
    
    print(f"Loaded {len(all_entries)} entries")
    
    # Build word family map
    print("Building word family map...")
    word_family_map = build_word_family_map(all_entries)
    
    print(f"Found {len(word_family_map)} word family groups")
    
    # Create word family lookup for each word
    word_to_families: dict[str, list[str]] = {}
    for root, words in word_family_map.items():
        for word in words:
            if word not in word_to_families:
                word_to_families[word] = []
            for related in words:
                if related != word and related not in word_to_families[word]:
                    word_to_families[word].append(related)
    
    # Add relations to entries
    print("Adding word family relations...")
    modified_count = 0
    for word, entry in all_entries.items():
        families = word_to_families.get(word, [])
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
