from __future__ import annotations

import json
from pathlib import Path
from typing import Any


# Alias entries are pure redirects. Everything else they carried was a verbatim
# copy of the target entry's payload (146,506 of them held an exchange string
# byte-identical to their target's, and the runtime never reads alias payload
# because display resolution goes through linked_word / display_word). Those
# copies accounted for ~80% of the pack, so only the pointer is written.
ALIAS_POINTER_FIELDS = ("word", "entry_kind", "linked_word", "display_word", "relations")


def strip_alias_payload(entry: dict[str, Any]) -> dict[str, Any]:
    """Reduce an alias entry to its redirect pointer."""
    if entry.get("entry_kind") != "alias":
        return entry
    return {field: value for field, value in entry.items() if field in ALIAS_POINTER_FIELDS}


def shard_key_for_word(word_key: str) -> str:
    shard_key = word_key[0].lower() if word_key else "_"
    # APFS case folding treats final sigma and sigma filenames as equivalent.
    return "σ" if shard_key == "ς" else shard_key


def group_entries_by_shard(
    entries: dict[str, dict[str, Any]],
) -> dict[str, dict[str, dict[str, Any]]]:
    shards: dict[str, dict[str, dict[str, Any]]] = {}
    for word_key, entry in entries.items():
        shard_key = shard_key_for_word(word_key)
        shards.setdefault(shard_key, {})[word_key] = entry
    return shards


def write_shards(
    entries: dict[str, dict[str, Any]],
    output_dir: Path,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    shard_paths: list[Path] = []
    for shard_key, shard_entries in sorted(group_entries_by_shard(entries).items()):
        shard_path = output_dir / f"{shard_key}.json"
        shard_path.write_text(
            json.dumps(shard_entries, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        shard_paths.append(shard_path)
        size_mb = shard_path.stat().st_size / 1024 / 1024
        print(f"  {shard_path.name}: {len(shard_entries)} entries, {size_mb:.1f} MB")
    return shard_paths
