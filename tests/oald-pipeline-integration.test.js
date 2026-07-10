const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

test("normalized fixture runs through relate and emit stages", () => {
  const output = execFileSync("./.venv/bin/python", ["-c", `
import contextlib
import io
import json
import tempfile
from pathlib import Path

from oald_pipeline.emit import run_emit
from oald_pipeline.models import BuildContext, PipelinePaths
from oald_pipeline.normalize import run_normalize
from oald_pipeline.relate import run_relate
from oald_pipeline.state import StateStore
from oald_pipeline.validate import validate_summary

html = '''
<div class="oald-entry-root">
  <span class="pos">verb</span>
  <li class="sense"><deft><chn>行走</chn></deft></li>
</div>
'''

with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
    build_root = Path(directory)
    pack_root = build_root / "output" / "packs" / "oald" / "2024.09"
    mdx_path = build_root / "fixture.mdx"
    mdx_path.write_bytes(b"fixture")
    paths = PipelinePaths(
        build_root=build_root,
        output_root=pack_root,
        db_path=build_root / "state.sqlite",
        dict_dir=pack_root / "dict",
        manifest_path=pack_root / "manifest.json",
    )
    store = StateStore(paths.db_path)
    try:
        store.replace_many("extract_lookup", [("walk", html), ("walked", "@@@LINK=walk")])
        store.replace_many("extract_links", [("walked", {"target": "walk"})])
        store.upsert_one("meta", "extract_summary", {"totalEntries": 2})
        run_normalize(store)
        summary = run_relate(store)
        validate_summary(summary)
        manifest = run_emit(BuildContext(mdx_path=mdx_path, paths=paths), store)
        shard = json.loads((paths.dict_dir / "w.json").read_text())
    finally:
        store.close()

print(json.dumps({
    "entryCount": manifest["entryCount"],
    "shardCount": manifest["shardCount"],
    "files": [entry["name"] for entry in manifest["files"]],
    "walkKind": shard["walk"]["entry_kind"],
    "walkedKind": shard["walked"]["entry_kind"],
}))
`], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: "scripts" },
  });

  assert.deepEqual(JSON.parse(output), {
    entryCount: 2,
    shardCount: 1,
    files: ["w.json"],
    walkKind: "standalone",
    walkedKind: "alias",
  });
});

test("streamed relation metadata deduplicates inferred homograph parents", () => {
  const output = execFileSync("./.venv/bin/python", ["-c", `
import contextlib
import io
import json
import tempfile
from pathlib import Path

from oald_pipeline.relate import _build_relation_metadata_stream
from oald_pipeline.state import StateStore

entries = [
    ("leaf", {"word": "leaf", "pos": "n:100", "exchange": "s:leaves"}),
    ("leave", {"word": "leave", "pos": "v:86/n:14", "exchange": "3:leaves"}),
    ("script", {"word": "script", "pos": "n:83/v:17", "exchange": "3:scripts"}),
]

with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
    store = StateStore(Path(directory) / "state.sqlite")
    try:
        store.replace_many("normalized_entries", entries)
        _build_relation_metadata_stream(store)
        parent_keys = sorted(store.load_all("relation_parents"))
        edge_keys = sorted(store.load_all("relation_edges"))
    finally:
        store.close()

print(json.dumps({"parentKeys": parent_keys, "edgeKeys": edge_keys}, ensure_ascii=False))
`], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: "scripts" },
  });

  const { parentKeys, edgeKeys } = JSON.parse(output);
  assert.ok(parentKeys.includes("leaves|leaf|复数"));
  assert.ok(parentKeys.includes("leaves|leave|第三人称单数"));
  assert.ok(!parentKeys.includes("leaves|leave|复数"));
  assert.ok(parentKeys.includes("scripts|script|第三人称单数"));
  assert.ok(parentKeys.includes("scripts|script|复数"));
  assert.ok(edgeKeys.includes("leave|inflection|复数|leaves"));
  assert.ok(edgeKeys.includes("script|inflection|复数|scripts"));
});
