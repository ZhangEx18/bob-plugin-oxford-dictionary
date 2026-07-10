from __future__ import annotations

import json
from pathlib import Path
from typing import Any


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
