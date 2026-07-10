const test = require("node:test");
const assert = require("node:assert/strict");
const { loadModule } = require("./unit-runtime");
const fixtures = require("./fixtures/entries");

// Helper: compare arrays across vm context boundaries
function arrayEqual(a, b) {
  assert.equal(JSON.stringify(a), JSON.stringify(b));
}

// ---------------------------------------------------------------------------
// morphology.ts
// ---------------------------------------------------------------------------

test("parseExchangeValues parses standard exchange format", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.parseExchangeValues("p:went/d:gone/i:going/s:goes/3:goes");

  arrayEqual([...result.get("p")], ["went"]);
  arrayEqual([...result.get("d")], ["gone"]);
  arrayEqual([...result.get("i")], ["going"]);
  arrayEqual([...result.get("s")], ["goes"]);
  arrayEqual([...result.get("3")], ["goes"]);
});

test("parseExchangeValues handles empty string", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.parseExchangeValues("");
  assert.equal(result.size, 0);
});

test("parseExchangeValues deduplicates values", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.parseExchangeValues("s:goes/3:goes");
  arrayEqual([...result.get("s")], ["goes"]);
  arrayEqual([...result.get("3")], ["goes"]);
});

test("parseExchangeValues ignores malformed items", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.parseExchangeValues("p:went/baditem/d:gone");
  arrayEqual([...result.get("p")], ["went"]);
  arrayEqual([...result.get("d")], ["gone"]);
  assert.equal(result.has("baditem"), false);
});

test("moveSurfaceComparativesIntoExchangeSlots migrates er/est forms from s-slot", async () => {
  const morphology = await loadModule("morphology.ts");
  const exchangeValues = morphology.parseExchangeValues("s:happy/c:happier/sup:happiest");
  const result = morphology.moveSurfaceComparativesIntoExchangeSlots(exchangeValues, fixtures.inflectionHappier);

  arrayEqual([...result.get("s")], ["happy"]);
  arrayEqual([...result.get("c")], ["happier"]);
  arrayEqual([...result.get("sup")], ["happiest"]);
});

test("moveSurfaceComparativesIntoExchangeSlots is idempotent", async () => {
  const morphology = await loadModule("morphology.ts");
  const exchangeValues = morphology.parseExchangeValues("s:big/c:bigger/sup:biggest");
  const first = morphology.moveSurfaceComparativesIntoExchangeSlots(exchangeValues, fixtures.edgeCaseComparativeInS);
  const second = morphology.moveSurfaceComparativesIntoExchangeSlots(first, fixtures.edgeCaseComparativeInS);

  arrayEqual([...first.get("c")], [...second.get("c")]);
  arrayEqual([...first.get("sup")], [...second.get("sup")]);
});

test("moveSurfaceComparativesIntoExchangeSlots skips when no adj/adv pos", async () => {
  const morphology = await loadModule("morphology.ts");
  const exchangeValues = morphology.parseExchangeValues("s:runs/c:runner");
  const entry = fixtures.makeEntry({ word: "runner", pos: "n:", entry_kind: "inflection" });
  const result = morphology.moveSurfaceComparativesIntoExchangeSlots(exchangeValues, entry);

  // No adj/adv pos → returns unchanged; runner stays in c-slot, runs stays in s-slot
  arrayEqual([...result.get("s")], ["runs"]);
  arrayEqual([...result.get("c")], ["runner"]);
});

test("pickPrimaryMorphologyWord filters British spellings in favor of American", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.pickPrimaryMorphologyWord(["travelled", "traveled"]);

  arrayEqual(result, ["traveled"]);
});

test("pickPrimaryMorphologyWord keeps all when no pair exists", async () => {
  const morphology = await loadModule("morphology.ts");
  const result = morphology.pickPrimaryMorphologyWord(["went", "gone"]);

  arrayEqual(result, ["went", "gone"]);
});

test("normalizeMorphologyWord lowercases input", async () => {
  const morphology = await loadModule("morphology.ts");
  assert.equal(morphology.normalizeMorphologyWord("WENT"), "went");
});

// ---------------------------------------------------------------------------
// formatter.ts
// ---------------------------------------------------------------------------

test("parseParts extracts pos and meanings from translation string", async () => {
  const formatter = await loadModule("formatter.ts");
  const result = formatter.parseParts("v. 去; 走\nn. 尝试");

  assert.equal(result.length, 2);
  assert.equal(result[0].part, "v.");
  assert.equal(result[0].means[0], "去; 走");
  assert.equal(result[1].part, "n.");
  assert.equal(result[1].means[0], "尝试");
});

test("parseParts supports extended and compound OALD pos labels", async () => {
  const formatter = await loadModule("formatter.ts");
  const result = formatter.parseParts("det. 每个\nadj. / adv. 赤脚地");

  assert.equal(result.length, 2);
  assert.equal(result[0].part, "det.");
  assert.equal(result[1].part, "adj. / adv.");
});

test("parseParts skips malformed lines", async () => {
  const formatter = await loadModule("formatter.ts");
  const result = formatter.parseParts("v. 跑\nnot a valid line\nn. 测试");

  assert.equal(result.length, 2);
});

test("parsePartsFromEntry prefers translation_parts over translation string", async () => {
  const formatter = await loadModule("formatter.ts");
  const result = formatter.parsePartsFromEntry(fixtures.entryWithTranslationParts);

  assert.equal(result.length, 2);
  assert.equal(result[0].part, "v.");
  arrayEqual(result[0].means, ["跑", "运行"]);
});

test("parsePartsFromEntry falls back to translation string when no parts", async () => {
  const formatter = await loadModule("formatter.ts");
  const result = formatter.parsePartsFromEntry(fixtures.standaloneGo);

  assert.ok(result.length > 0);
});

test("mergeParts deduplicates meanings within same pos", async () => {
  const formatter = await loadModule("formatter.ts");
  const parts = [
    { part: "v.", means: ["跑"] },
    { part: "v.", means: ["运行"] },
    { part: "n.", means: ["跑步"] },
  ];
  const result = formatter.mergeParts(parts);

  assert.equal(result.length, 2);
  const vPart = result.find((p) => p.part === "v.");
  arrayEqual(vPart.means, ["跑", "运行"]);
});

test("mergeParts preserves order of first occurrence", async () => {
  const formatter = await loadModule("formatter.ts");
  const parts = [
    { part: "n.", means: ["苹果"] },
    { part: "v.", means: ["跑"] },
    { part: "n.", means: ["香蕉"] },
  ];
  const result = formatter.mergeParts(parts);

  assert.equal(result[0].part, "n.");
  assert.equal(result[1].part, "v.");
});

test("shouldKeepSourceDetail returns true for non-plural labels", async () => {
  const formatter = await loadModule("formatter.ts");
  assert.equal(formatter.shouldKeepSourceDetail({ text: "测试" }, "过去式"), true);
});

test("shouldKeepSourceDetail returns false for uncountable plural", async () => {
  const formatter = await loadModule("formatter.ts");
  assert.equal(formatter.shouldKeepSourceDetail({ text: "水", countability: "uncountable" }, "复数"), false);
});

test("shouldKeepSourceDetail returns true for standalone entry plural", async () => {
  const formatter = await loadModule("formatter.ts");
  assert.equal(
    formatter.shouldKeepSourceDetail({ text: "树叶" }, "复数", "standalone"),
    true
  );
});

test("formatSourceLabel formats plural label correctly", async () => {
  const formatter = await loadModule("formatter.ts");
  assert.equal(formatter.formatSourceLabel("leaf", "复数"), "leaf 的复数");
});

test("formatSourceLabel formats other labels correctly", async () => {
  const formatter = await loadModule("formatter.ts");
  assert.equal(formatter.formatSourceLabel("go", "过去式"), "go 的 过去式");
});

// ---------------------------------------------------------------------------
// relations.ts
// ---------------------------------------------------------------------------

test("getBackRelation finds primary origin relation", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.getBackRelation(fixtures.inflectionWent);

  assert.ok(result);
  assert.equal(result.word, "go");
  assert.equal(result.label, "原形");
});

test("getBackRelation returns null when no origin relation", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.getBackRelation(fixtures.standaloneGo);

  assert.equal(result, null);
});

const allTargetsExist = () => true;

test("navigable inflection relations retain word and label", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.collectChildRelations(fixtures.standaloneGo, allTargetsExist);

  assert.ok(result.length > 0);
  assert.ok(result.some((r) => r.word === "went" && r.label === "过去式"));
});

test("navigable cross-references retain their target", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.collectCrossReferences(fixtures.standaloneFound, allTargetsExist);

  assert.ok(result.length > 0);
  assert.ok(result.some((r) => r.word === "find"));
});

test("origin and xref sources retain their POS scope", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.collectOriginSources(fixtures.standaloneFound, allTargetsExist);

  assert.ok(result.length > 0);
  const findSource = result.find((s) => s.word === "find");
  assert.ok(findSource);
  arrayEqual(findSource.posScope, ["v"]);
});

test("duplicate origin sources collapse by word and label", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.collectOriginSources(fixtures.multiOriginLeaves, allTargetsExist);

  assert.equal(result.length, 2);
  assert.ok(result.some((s) => s.word === "leaf"));
  assert.ok(result.some((s) => s.word === "leave"));
});

test("multiple distinct origins expand the source section", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.evaluateOriginExpansion(fixtures.multiOriginLeaves, allTargetsExist);

  assert.equal(result, true);
});

test("a single origin keeps the source section collapsed", async () => {
  const relations = await loadModule("relations.ts");
  const result = relations.evaluateOriginExpansion(fixtures.inflectionWent, allTargetsExist);

  assert.equal(result, false);
});
