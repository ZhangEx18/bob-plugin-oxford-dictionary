#!/usr/bin/env python3
"""Reduce alias entries in an existing OALD pack to their redirect pointer.

`emit.py` writes pointers for new builds, but a pack that was emitted before
that change still carries the full copied payload on every alias. Re-running
`emit` is not a safe substitute: the build state may have drifted since the pack
was written, so a re-emit rewrites unrelated entries too.

This migration touches alias entries only. Every non-alias entry is rewritten
byte for byte, so the diff is exactly "aliases lost their payload".

Usage:
  python3 scripts/compact_alias_payload.py                 # default pack
  python3 scripts/compact_alias_payload.py --pack <dir>
  python3 scripts/compact_alias_payload.py --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PACK_DIR = PROJECT_ROOT / ".cache" / "oald-build" / "output" / "packs" / "oald" / "2024.09"

sys.path.insert(0, str(PROJECT_ROOT / "scripts"))
from oald_pipeline.shard_writer import strip_alias_payload  # noqa: E402

JSON_SEPARATORS = (",", ":")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def compact_shard(path: Path, dry_run: bool) -> tuple[int, int, int]:
    """Returns (aliases_stripped, bytes_before, bytes_after)."""
    before = path.read_bytes()
    entries = json.loads(before.decode("utf-8"))

    stripped = 0
    compacted = {}
    for key, entry in entries.items():
        reduced = strip_alias_payload(entry)
        if len(reduced) != len(entry):
            stripped += 1
        compacted[key] = reduced

    after = json.dumps(compacted, ensure_ascii=False, separators=JSON_SEPARATORS).encode("utf-8")

    if not dry_run:
        path.write_bytes(after)

    return stripped, len(before), len(after)


def update_manifest(pack_dir: Path, dry_run: bool) -> None:
    manifest_path = pack_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    shard_dir = pack_dir / manifest.get("layout", {}).get("shardSubdir", "dict")

    files = []
    for declaration in manifest.get("files", []):
        shard_path = shard_dir / declaration["name"]
        if not shard_path.exists():
            files.append(declaration)
            continue
        updated = dict(declaration)
        updated["sha256"] = sha256_file(shard_path)
        updated["size"] = shard_path.stat().st_size
        files.append(updated)
    manifest["files"] = files

    if not dry_run:
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pack", default=str(DEFAULT_PACK_DIR), help="OALD pack directory")
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    args = parser.parse_args()

    pack_dir = Path(args.pack).resolve()
    shard_dir = pack_dir / "dict"
    if not shard_dir.is_dir():
        print(f"error: shard directory not found: {shard_dir}", file=sys.stderr)
        return 1

    total_stripped = 0
    total_before = 0
    total_after = 0
    for shard_path in sorted(shard_dir.glob("*.json")):
        stripped, before, after = compact_shard(shard_path, args.dry_run)
        total_stripped += stripped
        total_before += before
        total_after += after

    update_manifest(pack_dir, args.dry_run)

    mb = lambda value: value / 1024 / 1024  # noqa: E731
    print(f"pack          {pack_dir}")
    print(f"aliases       {total_stripped} stripped")
    print(f"shards        {mb(total_before):.1f} MB -> {mb(total_after):.1f} MB")
    print(f"saved         {mb(total_before - total_after):.1f} MB")
    print("dry-run: nothing written" if args.dry_run else "manifest refreshed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
