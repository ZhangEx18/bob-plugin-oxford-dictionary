from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import legacy_impl as legacy
from .config import DATA_VERSION, PIPELINE_VERSION, SCHEMA_VERSION
from .models import BuildContext
from .state import StateStore


def compute_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def emit_manifest(context: BuildContext, summary: dict[str, Any]) -> dict[str, Any]:
    dict_files = sorted(context.paths.dict_dir.glob("*.json"))
    metrics = summary["metrics"]
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "dataVersion": DATA_VERSION,
        "pipelineVersion": PIPELINE_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entryCount": metrics["entryCount"],
        "shardCount": len(dict_files),
        "counts": metrics["counts"],
        "danglingNavigableTargets": metrics["danglingNavigableTargets"],
        "syntheticRelationCount": metrics["syntheticRelationCount"],
        "wordFamilyMissingCount": metrics["wordFamilyMissingCount"],
        "verbFormMissingCount": metrics["verbFormMissingCount"],
        "mdxPath": str(context.mdx_path),
        "mdxSha256": compute_sha256(context.mdx_path),
        "buildRoot": str(context.paths.build_root),
        "dictDir": str(context.paths.dict_dir),
        "files": [
            {"name": file.name, "sha256": compute_sha256(file), "size": file.stat().st_size}
            for file in dict_files
        ],
    }
    with open(context.paths.manifest_path, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)
    return manifest


def run_emit(context: BuildContext, store: StateStore) -> dict[str, Any]:
    final_entries = store.load_all("final_entries")
    summary = store.load_one("build_metrics", "summary")
    if not final_entries or not summary:
        raise RuntimeError("relate stage state is missing")

    if context.paths.dict_dir.exists():
        shutil.rmtree(context.paths.dict_dir)
    context.paths.dict_dir.mkdir(parents=True, exist_ok=True)

    previous_output_dir = legacy.OUTPUT_DIR
    try:
        legacy.OUTPUT_DIR = str(context.paths.dict_dir)
        legacy.write_shards(
            final_entries,
            summary["totalEntries"],
            len(store.load_all("normalized_entries")),
            summary["linkProcessed"],
        )
    finally:
        legacy.OUTPUT_DIR = previous_output_dir

    manifest = emit_manifest(context, summary)
    store.upsert_one("meta", "manifest", manifest)
    return manifest
