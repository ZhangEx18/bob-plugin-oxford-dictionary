#!/usr/bin/env python3
"""Thin CLI for the staged OALD build pipeline."""

from __future__ import annotations

import argparse
from pathlib import Path

from oald_pipeline.config import resolve_build_root, resolve_db_path, resolve_mdx_path, resolve_output_root
from oald_pipeline.emit import run_emit
from oald_pipeline.extract import run_extract
from oald_pipeline.models import BuildContext, PipelinePaths
from oald_pipeline.normalize import run_normalize
from oald_pipeline.relate import run_relate
from oald_pipeline.state import StateStore
from oald_pipeline.validate import validate_summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build staged OALD data artifacts")
    parser.add_argument("--mdx", dest="mdx_path", default=None)
    parser.add_argument("--build-root", dest="build_root", default=None)
    parser.add_argument(
        "--stage",
        choices=["all", "extract", "normalize", "relate", "emit"],
        default="all",
    )
    parser.add_argument("--inspect", dest="inspect_word", default=None)
    return parser.parse_args()


def make_context(args: argparse.Namespace) -> BuildContext:
    build_root = resolve_build_root(args.build_root)
    output_root = resolve_output_root(build_root)
    paths = PipelinePaths(
        build_root=build_root,
        output_root=output_root,
        db_path=resolve_db_path(build_root),
        dict_dir=output_root / "dict",
        manifest_path=output_root / "manifest.json",
    )
    for path in (paths.build_root, paths.output_root, paths.dict_dir):
        path.mkdir(parents=True, exist_ok=True)
    return BuildContext(
        mdx_path=resolve_mdx_path(args.mdx_path),
        paths=paths,
    )


def inspect_word(store: StateStore, word: str) -> None:
    key = word.lower()
    normalized = store.load_one("normalized_entries", key)
    final_entry = store.load_one("final_entries", key)
    print({"word": word, "normalized": normalized, "final": final_entry})


def print_build_summary(store: StateStore) -> None:
    summary = store.load_one("build_metrics", "summary")
    manifest = store.load_one("meta", "manifest")
    if summary:
      print("Build metrics:")
      print(summary)
    if manifest:
      print("Manifest summary:")
      print({
          "schemaVersion": manifest.get("schemaVersion"),
          "dataVersion": manifest.get("dataVersion"),
          "pipelineVersion": manifest.get("pipelineVersion"),
          "entryCount": manifest.get("entryCount"),
          "shardCount": manifest.get("shardCount"),
          "danglingNavigableTargets": manifest.get("danglingNavigableTargets"),
      })


def main() -> None:
    args = parse_args()
    context = make_context(args)
    store = StateStore(context.paths.db_path)
    try:
        if args.inspect_word:
            inspect_word(store, args.inspect_word)
            return

        if args.stage in {"all", "extract"}:
            run_extract(str(context.mdx_path), store)
            if args.stage == "extract":
                return
        if args.stage in {"all", "normalize"}:
            run_normalize(str(context.mdx_path), store)
            if args.stage == "normalize":
                return
        if args.stage in {"all", "relate"}:
            summary = run_relate(store)
            validate_summary(summary)
            if args.stage == "relate":
                return
        if args.stage in {"all", "emit"}:
            if args.stage == "emit":
                summary = store.load_one("build_metrics", "summary")
                if not summary:
                    raise RuntimeError("relate stage state is missing")
                validate_summary(summary)
            run_emit(context, store)
            print_build_summary(store)
    finally:
        store.close()


if __name__ == "__main__":
    main()
