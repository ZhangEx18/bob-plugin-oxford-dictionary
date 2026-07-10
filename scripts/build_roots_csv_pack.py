#!/usr/bin/env python3
"""Build a standalone roots supplement pack from 1.enriched.csv.

This pack is intentionally small and additive:
- It does not replace the existing roots pack.
- It only supplies concise English glosses for roots/affixes that already
  exist in the enriched CSV.
- Output format matches the Bob roots pack layout:
  packs/roots-csv/latest/words/{a-z,_.json} + manifest.json
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CSV = PROJECT_ROOT / "1.enriched.csv"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / ".cache" / "oald-build" / "output" / "packs" / "roots-csv" / "latest" / "words"

WHITELIST: dict[str, tuple[str, str]] = {
    "ad": ("ad", "表加强"),
    "ap": ("ap", "表加强"),
    "arbit": ("arbit", "=judge，判断"),
    "arbitr": ("arbitr", "=judge，判断"),
    "judg": ("judg", "=judge，判断"),
    "judic": ("judic", "=judge，判断"),
    "par": ("par", "=come in sight，看见"),
    "pear": ("pear", "=come in sight，看见"),
    "coalesce": ("coalesce", "一起"),
    "provoke": ("provoke", "向前，在前"),
    "editor": ("editor", "编辑"),
    "ef": ("ef-", "出来，向外"),
    "ferv": ("ferv-", "=boil，沸腾"),
    "esc": ("-esce", "=grow up，成长"),
    "esce": ("-esce", "=grow up，成长"),
    "ent": ("-ent", "形容词后缀"),
    "ence": ("-ence", "名词后缀"),
    "ance": ("-ance", "名词后缀"),
    "al": ("-al", "形容词/名词后缀"),
    "ial": ("-ial", "形容词后缀"),
    "ive": ("-ive", "形容词后缀"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build roots supplement pack from 1.enriched.csv")
    parser.add_argument("--csv", default=str(DEFAULT_CSV), help="Path to 1.enriched.csv")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_DIR), help="Output shard directory")
    return parser.parse_args()


def _normalize_root_key(key: str) -> str:
    clean = (key or "").strip().lower()
    clean = clean.strip("-")
    if clean in {"ferv", "boil"}:
        return "ferv"
    if clean in {"esce", "esc", "isc"}:
        return clean
    if clean in {"par", "pear"}:
        return clean
    return clean


def _component_display(key: str) -> str:
    clean = (key or "").strip().lower().strip("-")
    if clean in {"esc", "esce", "isc"}:
        return f"-{clean}"
    if clean in {"ent", "ence", "ance", "al", "er", "ive", "ity", "ous"}:
        return f"-{clean}"
    if clean in {"ad", "ap", "af", "ag", "al", "ar", "as", "at", "ex", "ef", "in", "im", "il", "ir", "re", "sub", "sup", "sur", "con", "com", "col", "cor", "de", "pro", "trans", "un"}:
        return f"{clean}-"
    return clean


def _component_kind(key: str) -> str:
    clean = (key or "").strip().lower().strip("-")
    if clean in {"esc", "esce", "isc", "ent", "ence", "ance", "al", "er", "ive", "ity", "ous"}:
        return "suffix"
    if clean in {"ad", "ap", "af", "ag", "al", "ar", "as", "at", "ex", "ef", "in", "im", "il", "ir", "re", "sub", "sup", "sur", "con", "com", "col", "cor", "de", "pro", "trans", "un"}:
        return "prefix"
    return "root"


def _short_component_meaning(key: str, english: str, chinese: str) -> str:
    clean = (key or "").strip().lower().strip("-")
    if clean in {"ad", "ap", "af", "ag", "al", "ar", "as", "at", "ex", "ef", "in", "im", "il", "ir", "re", "sub", "sup", "sur", "con", "com", "col", "cor", "de", "pro", "trans", "un"}:
        return chinese or english
    if clean in {"esc", "esce", "isc"}:
        return f"={english or 'grow'}，{chinese or '成长'}"
    if clean in {"ent", "ence", "ance", "al", "er", "ive", "ity", "ous"}:
        return chinese or english
    return f"={english}" if english else chinese


def build_pack(csv_path: Path) -> dict[str, dict]:
    if not csv_path.exists():
        raise FileNotFoundError(csv_path)

    shards: dict[str, dict] = defaultdict(dict)
    with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            return {}

        for row in reader:
            key = str(row.get("词根词缀", "")).strip()
            if not key or key.lower() == "nan":
                continue

            lookup_key = _normalize_root_key(key)
            if lookup_key not in WHITELIST:
                continue

            display_root, meaning_text = WHITELIST[lookup_key]

            entry = {
                "rootBreakdown": f"{display_root}（{meaning_text}）",
                "roots": [
                    {
                        "root": display_root,
                        "meaning": meaning_text,
                        "relatedWords": [],
                    }
                ],
            }
            first_char = lookup_key[0] if lookup_key else "_"
            if not first_char.isalpha():
                first_char = "_"
            shards[first_char][lookup_key] = entry

    return shards


def emit_pack(shards: dict[str, dict], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    shard_names = sorted(shards.keys())

    for name in shard_names:
        shard_path = output_dir / f"{name}.json"
        with open(shard_path, "w", encoding="utf-8") as f:
            json.dump(shards[name], f, ensure_ascii=False, separators=(",", ":"))

    manifest = {
        "schemaVersion": "1.0.0",
        "dataVersion": "latest",
        "packType": "roots",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entryCount": sum(len(v) for v in shards.values()),
        "shardCount": len(shard_names),
        "shards": shard_names,
        "layout": {
            "shardSubdir": "words",
            "shardExtension": ".json",
        },
        "files": [{"name": f"{name}.json"} for name in shard_names],
    }

    manifest_path = output_dir.parent / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def main() -> None:
    args = parse_args()
    csv_path = Path(args.csv)
    output_dir = Path(args.output)
    shards = build_pack(csv_path)
    emit_pack(shards, output_dir)
    print(f"Emitted {sum(len(v) for v in shards.values())} supplement entries")
    print(f"Output: {output_dir}")


if __name__ == "__main__":
    main()
