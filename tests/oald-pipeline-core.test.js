const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const snapshot = JSON.parse(execFileSync(
  "./.venv/bin/python",
  ["-c", `
import contextlib
import io
import json
import tempfile
from pathlib import Path

from oald_pipeline import relate_core
from oald_pipeline.shard_writer import write_shards

walk = {
    "word": "walk",
    "phonetic": "",
    "phonetic_us": "",
    "translation": "v. 行走",
    "translation_parts": [{"pos": "v.", "meanings": ["行走"]}],
    "translation_detail_parts": [{"pos": "v.", "details": [{"text": "行走"}]}],
    "pos": "v:100",
    "exchange": "3:walks/p:walked/d:walked/i:walking",
    "entry_kind": "standalone",
    "display_word": "walk",
    "relations": [],
    "phrasal_verbs": [{"name": "walk out", "translation": "离开"}],
}

leave = {
    "word": "leave",
    "translation": "v. 离开\\nn. 假期",
    "translation_detail_parts": [{"pos": "n.", "details": [{"text": "假期"}]}],
    "pos": "v:86/n:14",
    "exchange": "3:leaves/p:left/d:left/i:leaving",
}

with contextlib.redirect_stdout(io.StringIO()):
    children, parents, edges, blocked = relate_core.build_relation_metadata({"walk": walk})
    leave_children, _, _, _ = relate_core.build_relation_metadata({"leave": leave})
    finalized = relate_core.finalize_standalone_entries(
        {"walk": walk}, children, parents, edges
    )
    link_count = relate_core.process_link_entries(
        relate_core.LinkProcessingContext(
            finalized_entries=finalized,
            final_target={"walking": "walk"},
            parent_relations_map=parents,
            relation_edges_map=edges,
            blocked_surface_forms_by_base=blocked,
            lookup={"walk": "<html>", "walking": "@@@LINK=walk"},
        )
    )

    with tempfile.TemporaryDirectory() as directory:
        shard_paths = write_shards(
            {
                "walk": finalized["walk"],
                "#term": {"word": "#term"},
                "ς": {"word": "ς"},
                "σ": {"word": "σ"},
            },
            Path(directory),
        )
        shard_names = sorted(path.name for path in shard_paths)
        walk_shard = json.loads((Path(directory) / "w.json").read_text())
        sigma_shard = json.loads((Path(directory) / "σ.json").read_text())

print(json.dumps({
    "children": children["walk"],
    "leaveChildren": leave_children.get("leave", []),
    "walkRelations": finalized["walk"]["relations"],
    "walking": finalized["walking"],
    "linkCount": link_count,
    "shardNames": shard_names,
    "walkShardWord": walk_shard["walk"]["word"],
    "sigmaShardWords": sorted(sigma_shard.keys()),
}, ensure_ascii=False))
`],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: "scripts" },
  },
));

test("exchange forms produce labeled child relations", () => {
  assert.deepEqual(
    snapshot.children.map(({ word, label }) => [word, label]),
    [
      ["walks", "第三人称单数"],
      ["walked", "过去式"],
      ["walked", "过去分词"],
      ["walking", "现在分词"],
    ],
  );
});

test("mixed-POS third-person form also remains queryable as a noun plural", () => {
  assert.ok(snapshot.leaveChildren.some(({ word, label }) => word === "leaves" && label === "复数"));
});

test("standalone finalization attaches outgoing relation edges", () => {
  assert.equal(snapshot.walkRelations.length, 4);
  assert.ok(snapshot.walkRelations.every((edge) => edge.direction === "outgoing"));
});

test("link processing classifies a known form as an inflection", () => {
  assert.equal(snapshot.linkCount, 1);
  assert.equal(snapshot.walking.entry_kind, "inflection");
  assert.equal(snapshot.walking.display_word, "walk");
  assert.equal(snapshot.walking.phrasal_verbs, undefined);
  assert.deepEqual(
    snapshot.walking.relations.map(({ target, label }) => [target, label]),
    [["walk", "现在分词"]],
  );
});

test("shard writer uses first-character filenames and round-trips entries", () => {
  assert.deepEqual(snapshot.shardNames, ["#.json", "w.json", "σ.json"]);
  assert.equal(snapshot.walkShardWord, "walk");
  assert.deepEqual(snapshot.sigmaShardWords, ["ς", "σ"]);
});
