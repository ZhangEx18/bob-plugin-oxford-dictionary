#!/usr/bin/env python3
"""Re-shard an existing OALD pack to a different shard key length.

The pack shipped with one-character shards, which put 16 MB into a single file
(m.json); a session that touched 26 letters ended up holding ~380 MB of parsed
JSON. Two-character shards spread the same entries over ~1,000 files and cut
that to ~60 MB.

This rewrites the shard files only. Entry payloads are carried across untouched,
and re-running `emit` is deliberately avoided because the build state has drifted
since the pack was written.

Usage:
  python3 scripts/reshard_pack.py                 # default pack, length 2
  python3 scripts/reshard_pack.py --length 2
  python3 scripts/reshard_pack.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACK_DIR = PROJECT_ROOT / ".cache" / "oald-build" / "output" / "packs" / "oald" / "2024.09"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from oald_pipeline.shard_writer import (  # noqa: E402
    SHARD_KEY_LENGTH,
    shard_key_for_word,
    write_shards,
)


def load_entries(shard_dir: Path) -> dict[str, dict]:
    entries: dict[str, dict] = {}
    for shard_path in sorted(shard_dir.glob("*.json")):
        entries.update(json.loads(shard_path.read_text(encoding="utf-8")))
    return entries


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", default=str(DEFAULT_PACK_DIR), help="OALD pack directory")
    parser.add_argument("--length", type=int, default=SHARD_KEY_LENGTH, help="shard key length")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    if args.length < 1:
        print("error: --length must be at least 1", file=sys.stderr)
        return 1

    pack_dir = Path(args.pack).resolve()
    shard_dir = pack_dir / "dict"
    if not shard_dir.is_dir():
        print(f"error: shard directory not found: {shard_dir}", file=sys.stderr)
        return 1

    before_files = sorted(shard_dir.glob("*.json"))
    entries = load_entries(shard_dir)
    before_bytes = sum(path.stat().st_size for path in before_files)
    keys = sorted({shard_key_for_word(key, args.length) for key in entries})

    print(f"pack        {pack_dir}")
    print(f"entries     {len(entries)}")
    print(f"shards      {len(before_files)} -> {len(keys)} (key length {args.length})")

    if args.dry_run:
        print("dry-run: nothing written")
        return 0

    shutil.rmtree(shard_dir)
    shard_dir.mkdir(parents=True, exist_ok=True)
    write_shards(entries, shard_dir, args.length)

    after_files = sorted(shard_dir.glob("*.json"))
    after_entries = load_entries(shard_dir)
    if set(after_entries) != set(entries):
        print("error: entry keys changed during re-sharding", file=sys.stderr)
        return 1

    manifest_path = pack_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.setdefault("layout", {})["shardKeyLength"] = args.length
    manifest["shardCount"] = len(after_files)
    manifest["files"] = [
        {
            "name": path.name,
            "sha256": __import__("hashlib").sha256(path.read_bytes()).hexdigest(),
            "size": path.stat().st_size,
        }
        for path in after_files
    ]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    after_bytes = sum(path.stat().st_size for path in after_files)
    mb = lambda value: value / 1024 / 1024  # noqa: E731
    print(f"bytes       {mb(before_bytes):.1f} MB -> {mb(after_bytes):.1f} MB")
    print(f"manifest    refreshed ({len(after_files)} files, shardKeyLength={args.length})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
