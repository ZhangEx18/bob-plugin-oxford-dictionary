#!/usr/bin/env python3
"""Parse eudic etymology dictionary into sharded JSON."""

from __future__ import annotations

import argparse
import json
import re
import zlib
from collections import defaultdict
from pathlib import Path

from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_EUDIC_PATH = PROJECT_ROOT / "data" / "sources" / "roots" / "raw" / "cigen_en_new.eudic"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "data" / "sources" / "roots" / "raw" / "cigen"

# Common English words that appear as tree components but aren't roots
COMMON_WORDS = {
    "regular", "happy", "back", "good", "well", "long", "high", "old", "new",
    "big", "small", "fast", "slow", "hard", "soft", "hot", "cold", "dry", "wet",
    "dark", "light", "white", "black", "red", "blue", "green", "stone", "water",
    "fire", "earth", "wind", "sun", "moon", "star", "tree", "leaf", "root",
    "bird", "fish", "horse", "dog", "cat", "man", "woman", "child", "hand",
    "foot", "head", "eye", "ear", "nose", "mouth", "heart", "blood", "bone",
    "house", "door", "wall", "road", "path", "bridge", "ship", "boat",
    "king", "queen", "lord", "land", "field", "mountain", "river", "sea",
    "time", "day", "night", "year", "word", "name", "work", "life", "death",
    "war", "peace", "love", "fear", "hope", "faith", "truth", "law", "rule",
    "power", "force", "strength", "will", "mind", "thought", "soul", "spirit",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Parse eudic etymology data into sharded JSON")
    parser.add_argument("--input", default=DEFAULT_EUDIC_PATH, type=Path, help="Path to the source .eudic file")
    parser.add_argument("--output", default=DEFAULT_OUTPUT_DIR, type=Path, help="Output directory for JSON shards")
    return parser.parse_args()


def find_zlib_streams(data: bytes) -> list[bytes]:
    streams = []
    i = 0
    n = len(data)
    while i < n - 2:
        if data[i] == 0x78 and data[i + 1] in (0x01, 0x5E, 0x9C, 0xDA):
            for size in [20000, 80000, 200000]:
                try:
                    decompressed = zlib.decompress(data[i : i + size])
                    streams.append(decompressed)
                    break
                except zlib.error:
                    continue
        i += 1
    return streams


def parse_root_meaning(text: str) -> dict[str, str]:
    """Parse root/affix text into root->meaning map.

    Extracts both English and Chinese meanings where available.
    """
    result: dict[str, str] = {}
    segments = re.split(r"(?:词根|前缀|后缀)\s+", text)
    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue

        # Extract Chinese meaning from 表示"..."
        m = re.search(r'表示["“”]([^"“”]+)', seg)
        chinese = m.group(1).strip() if m else ""

        # For 表示形容词，"…的" — extract description before quotes
        # (e.g. "形容词" not "…的"). Must run BEFORE comma+quote fallback.
        if not chinese:
            m2 = re.search(r'表示([一-鿿][^"“”，,]*)[，,]\s*["“”]', seg)
            if m2:
                chinese = m2.group(1).strip()

        # Fallback: Chinese after comma+quote (e.g. ，"...")
        if not chinese:
            m3 = re.search(r'[，,]\s*["“”]([^"“”]+)', seg)
            if m3:
                chinese = m3.group(1).strip()
        # Extract English meaning from "= english" part
        # Patterns: "= to grow, 表示..." / "= grow up 成长" / "= boil, 表示..."
        english = ""
        eq_match = re.search(r'[=＝]\s*(.+?)(?:\s*表示|\s*$)', seg)
        if eq_match:
            eng_raw = eq_match.group(1).strip().rstrip("，,。.")
            # Strip trailing Chinese to get pure English
            eng_clean = re.sub(r'[一-鿿].*$', '', eng_raw).strip().rstrip("，,")
            if eng_clean:
                english = eng_clean

        # If no Chinese from 表示"..." but English found, try to extract
        # Chinese after English: "= grow up 成长，长大"
        if english and not chinese:
            after_eng = seg[seg.find(english) + len(english):]
            zh_match = re.search(r'([一-鿿][^\s]*)', after_eng)
            if zh_match:
                chinese = zh_match.group(1).strip().rstrip("，,。.")

        # For 表示形容词，"…的" — use the description before quotes
        # as the primary meaning (e.g. "形容词后缀" not "…的")
        if not chinese:
            m2 = re.search(r'表示([一-鿿][^"“”，,]*)[，,]\s*["“”]', seg)
            if m2:
                chinese = m2.group(1).strip()

        # Shorten Chinese meaning: pick the shortest element (>=2 chars)
        # from comma-separated alternatives.
        # "从，从...离开，从...向外，向外，向上" -> "向外"
        if chinese and len(chinese) > 4:
            parts = re.split(r'[，,]', chinese)
            parts = [p.strip() for p in parts if p.strip()]
            if len(parts) > 1:
                # Prefer shortest element with >= 2 chars
                candidates = [p for p in parts if len(p) >= 2]
                if candidates:
                    chinese = min(candidates, key=len)

        # Format: prefer "= english，chinese", fallback to just chinese or english
        if english and chinese:
            meaning = f"= {english}，{chinese}"
        elif chinese:
            meaning = chinese
        elif english:
            meaning = f"= {english}"
        else:
            continue

        before = re.split(r"[=＝]|表示", seg)[0].strip()
        raw_roots = re.split(r"[,，]", before)
        for root in raw_roots:
            clean = re.sub(r"[^a-zA-Z\-]", "", root).strip("-")
            if clean and 1 <= len(clean) <= 20:
                result[clean.lower()] = meaning
    return result


def build_root_meaning_map(streams: list[bytes]) -> dict[str, str]:
    """Build global root->meaning map. Keep longest meaning."""
    root_map: dict[str, str] = {}
    for stream_html in streams:
        text = stream_html.decode("utf-8", errors="replace")
        soup = BeautifulSoup(text, "html.parser")
        for section in soup.find_all("div", class_="wordSection"):
            title = section.find("span", class_="title")
            if not title or "词根词缀" not in title.get_text():
                continue
            cont = section.find("div", class_="sectionCont")
            if not cont:
                continue
            content = cont.get_text().strip()
            if not content:
                continue
            parsed = parse_root_meaning(content)
            for root, meaning in parsed.items():
                # Keep longest meaning (more descriptive)
                if root not in root_map or len(meaning) > len(root_map[root]):
                    root_map[root] = meaning
    return root_map


def match_component(comp: str, root_map: dict[str, str]) -> str:
    """Find meaning for a tree component from the root map."""
    clean = comp.strip("-").lower()
    if not clean or len(clean) < 2:
        return ""

    # Skip common English words
    if clean in COMMON_WORDS:
        return ""

    # Direct match
    if clean in root_map:
        return root_map[clean]

    # Try with trailing hyphen
    if f"{clean}-" in root_map:
        return root_map[f"{clean}-"]

    # For short roots (<=4 chars), require exact match only
    if len(clean) <= 4:
        return ""

    # For longer roots, try prefix match
    for key in root_map:
        k = key.rstrip("-")
        if k == clean or clean.startswith(k):
            return root_map[key]

    return ""


def extract_word_roots(streams: list[bytes], root_map: dict[str, str]) -> dict[str, dict]:
    word_roots: dict[str, dict] = {}
    for stream_html in streams:
        text = stream_html.decode("utf-8", errors="replace")
        soup = BeautifulSoup(text, "html.parser")
        for etym_div in soup.find_all("div", class_="etymology"):
            tree_section = etym_div.find("div", class_="wordSection etymologyTree")
            if not tree_section:
                continue
            tree_parts = tree_section.find_all(
                "div", class_=lambda c: c and "treePart" in str(c)
            )
            level0 = [
                tp for tp in tree_parts
                if any("etymology_0" in c for c in (tp.get("class") or []))
            ]
            if not level0:
                continue
            root_word_span = level0[0].find("span", class_="rootWord")
            if not root_word_span:
                continue
            word = root_word_span.get_text().strip().lower()
            if not word or len(word) > 60 or word in word_roots:
                continue
            level1 = [
                tp for tp in tree_parts
                if any("etymology_1" in c for c in (tp.get("class") or []))
            ]
            if not level1:
                continue
            components = []
            for tp in level1:
                for r in tp.find_all("span", class_="rootWord"):
                    t = r.get_text().strip()
                    if t and t.lower() != word:
                        components.append(t)
                for a in tp.find_all("span", class_="affixWord"):
                    t = a.get_text().strip()
                    if t:
                        components.append(t)
            if not components:
                continue

            # Fallback: when etymology_1 has a single compound root with no
            # direct meaning (e.g. "effervesce"), try etymology_2 for finer
            # decomposition (e.g. "ef-" + "ferv-" + "-esce").
            # Use strict matching — only direct + hyphen match, no prefix match.
            level1_roots = [c for c in components if not c.startswith("-")]
            single_unresolved = False
            if len(level1_roots) == 1:
                clean = level1_roots[0].strip("-").lower()
                direct = clean in root_map or f"{clean}-" in root_map
                single_unresolved = not direct
            if single_unresolved:
                level2 = [
                    tp for tp in tree_parts
                    if any("etymology_2" in c for c in (tp.get("class") or []))
                ]
                if level2:
                    finer = []
                    for tp in level2:
                        for r in tp.find_all("span", class_="rootWord"):
                            t = r.get_text().strip()
                            if t and t.lower() != word:
                                finer.append(t)
                        for a in tp.find_all("span", class_="affixWord"):
                            t = a.get_text().strip()
                            if t:
                                finer.append(t)
                    if finer:
                        # Preserve suffix components from etymology_1 that are
                        # not in etymology_2 (e.g. -ent from "effervesce + -ent").
                        level2_set = {c.strip("-").lower() for c in finer}
                        suffixes_from_l1 = [
                            c for c in components
                            if c.startswith("-") and c.strip("-").lower() not in level2_set
                        ]
                        components = finer + suffixes_from_l1
            seen = set()
            unique = []
            for c in components:
                if c not in seen:
                    seen.add(c)
                    unique.append(c)

            # Build per-word root map from the 词根词缀 section in the SAME
            # etymology div.  Per-word meanings override the global root_map
            # so that ef- in "effervescent" gets "出来，向外" (from this word's
            # section) instead of the longest global description.
            local_map: dict[str, str] = {}
            for ws in etym_div.find_all("div", class_="wordSection"):
                title = ws.find("span", class_="title")
                if not title or "词根词缀" not in title.get_text():
                    continue
                cont = ws.find("div", class_="sectionCont")
                if not cont:
                    continue
                ws_text = cont.get_text().strip()
                if ws_text:
                    local_map = parse_root_meaning(ws_text)
                break

            display_parts = []
            roots_list = []
            for c in unique:
                # Prefer local (per-word) meaning, fall back to global root_map.
                meaning = match_component(c, local_map) or match_component(c, root_map)
                if meaning:
                    display_parts.append(f"{c}（{meaning}）")
                else:
                    display_parts.append(c)
                roots_list.append({"root": c, "meaning": meaning, "relatedWords": []})
            word_roots[word] = {
                "rootBreakdown": " + ".join(display_parts),
                "roots": roots_list,
            }
    return word_roots


def emit_shards(word_roots: dict[str, dict], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    shards: dict[str, dict] = defaultdict(dict)
    for word, entry in word_roots.items():
        first_char = word[0] if word else "_"
        if not first_char.isalpha():
            first_char = "_"
        shards[first_char][word] = entry
    for char, entries in shards.items():
        shard_path = output_dir / f"{char}.json"
        with open(shard_path, "w", encoding="utf-8") as f:
            json.dump(entries, f, ensure_ascii=False, separators=(",", ":"))
    manifest = {
        "entryCount": len(word_roots),
        "shardCount": len(shards),
        "shards": sorted(shards.keys()),
    }
    with open(output_dir / "roots_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"Emitted {len(word_roots)} entries across {len(shards)} shards")
    print(f"Output: {output_dir}")


def main() -> None:
    args = parse_args()
    print(f"Reading: {args.input}")
    with open(args.input, "rb") as f:
        data = f.read()
    print(f"  Size: {len(data) / 1024 / 1024:.1f}MB")
    print("Finding zlib streams...")
    streams = find_zlib_streams(data)
    print(f"  Found {len(streams)} streams")
    print("Building root->meaning map...")
    root_map = build_root_meaning_map(streams)
    print(f"  Found {len(root_map)} root definitions")
    for root in ["brev", "ab", "radi", "ban", "ate", "escence", "on", "ir", "an"]:
        if root in root_map:
            print(f"    {root}: {root_map[root][:40]}")
    print("Extracting word->roots...")
    word_roots = extract_word_roots(streams, root_map)
    print(f"  Found {len(word_roots)} words")
    for w in ["abandon", "adolescence", "irregular", "radiate", "abbreviate", "happy"]:
        if w in word_roots:
            print(f"  {w}: {word_roots[w]['rootBreakdown']}")
        else:
            print(f"  {w}: NOT FOUND")
    emit_shards(word_roots, args.output)


if __name__ == "__main__":
    main()
