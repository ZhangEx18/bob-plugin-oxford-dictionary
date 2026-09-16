from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

# How many leading characters of a word name its shard file.
#
# One character put 16 MB into a single file (m.json), so a session that touched
# 26 letters held ~380 MB of parsed JSON. Two characters spreads the same data
# across ~1,000 files whose median is well under a megabyte, and the same session
# then holds ~60 MB.
SHARD_KEY_LENGTH = 2

SAFE_SHARD_CHAR = re.compile(r"^[a-z0-9]$")


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


def encode_shard_char(char: str) -> str:
    """Encode one character for use in a shard filename.

    Only ``[a-z0-9]`` survives verbatim; every other character becomes ``~``
    plus its code point as six uppercase hex digits. Six is a fixed width
    (Unicode tops out at U+10FFFF), which keeps the encoding unambiguous, and
    ``~`` itself is encoded so it can never appear literally. ``~`` is
    unreserved in URLs and legal in every filesystem, unlike ``%`` which path
    layers may percent-decode.

    This matters for two-character keys, which can reach characters like the
    ``/`` in ``s/`` that a path cannot hold.

    ``data-loader.ts`` implements the same rule; the two must stay in lockstep.
    """
    if SAFE_SHARD_CHAR.match(char):
        return char
    return f"~{ord(char):06X}"


def shard_key_for_word(word_key: str, length: int = SHARD_KEY_LENGTH) -> str:
    # NFC first, so a word stored in a decomposed form still lands on the same
    # shard as its precomposed spelling (APFS folds those filenames together).
    normalized = unicodedata.normalize("NFC", word_key).lower()
    # APFS case folding treats final sigma and sigma filenames as equivalent.
    chars = ["σ" if char == "ς" else char for char in normalized[:length]]
    while len(chars) < length:
        chars.append("_")
    return "".join(encode_shard_char(char) for char in chars)


def group_entries_by_shard(
    entries: dict[str, dict[str, Any]],
    length: int = SHARD_KEY_LENGTH,
) -> dict[str, dict[str, dict[str, Any]]]:
    shards: dict[str, dict[str, dict[str, Any]]] = {}
    for word_key, entry in entries.items():
        shard_key = shard_key_for_word(word_key, length)
        shards.setdefault(shard_key, {})[word_key] = entry
    return shards


def write_shards(
    entries: dict[str, dict[str, Any]],
    output_dir: Path,
    length: int = SHARD_KEY_LENGTH,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    shard_paths: list[Path] = []
    for shard_key, shard_entries in sorted(group_entries_by_shard(entries, length).items()):
        shard_path = output_dir / f"{shard_key}.json"
        shard_path.write_text(
            json.dumps(shard_entries, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        shard_paths.append(shard_path)
        size_mb = shard_path.stat().st_size / 1024 / 1024
        print(f"  {shard_path.name}: {len(shard_entries)} entries, {size_mb:.1f} MB")
    return shard_paths
