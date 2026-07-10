#!/usr/bin/env python3
"""Build word->roots mapping from the approved roots sources.

Priority:
  1. eudic
  2. openetymology morphemes JSON

Output:
  Sharded JSON files (a.json ~ z.json + _.json) in the output directory,
  each mapping lowercase word -> RootEntry.

Usage:
  python3 scripts/build_roots_data.py
  python3 scripts/build_roots_data.py --morphemes /path/to/chunks
  python3 scripts/build_roots_data.py --output /custom/output/dir
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from bs4 import BeautifulSoup

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / ".cache" / "oald-build" / "output" / "packs" / "roots" / "latest" / "words"
DEFAULT_EUDIC_DIR = PROJECT_ROOT / "data" / "sources" / "roots" / "raw" / "cigen"
DEFAULT_MORPHEMES_DIR = PROJECT_ROOT / "data" / "sources" / "roots" / "raw" / "morphemes" / "chunks"

# ──────────────────────────────────────────────────────────────────────
# Latin/Greek root knowledge base
# ──────────────────────────────────────────────────────────────────────

# Known compound roots: compound -> [(sub_root, meaning), ...]
COMPOUND_ROOTS: dict[str, list[tuple[str, str]]] = {
    "adolesc": [("ad", "加强"), ("ol", "生长，al- 变体"), ("esc", "起始态")],
    "adul": [("ad", "加强"), ("ol", "生长，al- 变体")],
    "alesc": [("al", "生长"), ("esc", "起始态")],
    "escence": [("esc", "起始态"), ("ence", "名词后缀")],
    "escent": [("esc", "起始态"), ("ent", "形容词后缀")],
    "esce": [("esc", "起始态")],
    "olesc": [("ol", "生长，al- 变体"), ("esc", "起始态")],
    "olescent": [("ol", "生长，al- 变体"), ("esc", "起始态"), ("ent", "形容词后缀")],
    "esce": [("esc", "起始态"), ("e", "")],
    "esco": [("esc", "起始态"), ("o", "")],
    "visib": [("vis", "看"), ("ib", "形容词后缀")],
    "audib": [("aud", "听"), ("ib", "形容词后缀")],
    "credib": [("cred", "相信"), ("ib", "形容词后缀")],
    "fract": [("frac", "破，打碎"), ("t", "过去分词后缀")],
    "script": [("scrip", "写，script- 变体"), ("t", "过去分词后缀")],
    "struct": [("stru", "建造"), ("ct", "过去分词后缀")],
    "spect": [("spec", "看"), ("t", "过去分词后缀")],
    "flect": [("flec", "弯曲"), ("t", "过去分词后缀")],
    "strict": [("stric", "拉紧"), ("t", "过去分词后缀")],
}

# Latin prefix meanings (English -> Chinese)
LATIN_PREFIXES: dict[str, list[tuple[str, str]]] = {
    "ad": [("to, toward", "加强；朝向")],
    "ab": [("away from", "离开；从")],
    "abs": [("away from", "离开；从")],
    "ambi": [("both, around", "两者；周围")],
    "ante": [("before", "在…之前")],
    "anti": [("against", "反对；对抗")],
    "bi": [("two", "二")],
    "bene": [("well", "好")],
    "circum": [("around", "周围")],
    "con": [("together", "共同")],
    "com": [("together", "共同")],
    "col": [("together", "共同")],
    "cor": [("together", "共同")],
    "contra": [("against", "反对")],
    "de": [("down, away", "向下；离开")],
    "dis": [("apart", "分开")],
    "di": [("apart", "分开")],
    "dif": [("apart", "分开")],
    "e": [("out of", "出")],
    "ex": [("out of", "出")],
    "extra": [("beyond", "超出")],
    "in": [("not", "不"), ("in, into", "进入")],
    "im": [("not", "不"), ("in, into", "进入")],
    "il": [("not", "不"), ("in, into", "进入")],
    "ir": [("not", "不"), ("in, into", "进入")],
    "inter": [("between", "之间")],
    "intro": [("into", "进入")],
    "juxta": [("near", "靠近")],
    "mal": [("bad", "坏")],
    "mis": [("wrong", "错误")],
    "multi": [("many", "多")],
    "non": [("not", "不")],
    "ob": [("against", "逆；反对")],
    "op": [("against", "逆；反对")],
    "per": [("through", "通过")],
    "post": [("after", "之后")],
    "pre": [("before", "之前")],
    "pro": [("forward", "向前")],
    "re": [("back, again", "回；再")],
    "retro": [("backward", "向后")],
    "semi": [("half", "半")],
    "sub": [("under", "在下")],
    "suc": [("under", "在下")],
    "sup": [("under", "在下")],
    "super": [("above", "在上")],
    "sur": [("above", "在上")],
    "trans": [("across", "横穿")],
    "tra": [("across", "横穿")],
    "tri": [("three", "三")],
    "ultra": [("beyond", "超出")],
    "un": [("not", "不")],
    "uni": [("one", "一")],
    "vice": [("in place of", "代替")],
}

# Words where the assimilated prefix means "in/into" rather than "not".
ASSIMILATED_INTO_WORDS: dict[str, set[str]] = {
    "in": {
        "inward", "input", "inside", "income", "indeed", "indoor", "innate",
        "inset", "influx", "infuse", "ingest", "inhabit", "inject", "inmate",
        "inmost", "inner", "inquire", "insert", "inscribe", "insist", "inspect",
        "instill", "intake", "integral", "integrate", "inter", "inward", "invade",
        "inveigle", "invite", "involute", "invoice",
    },
    "im": {
        "immigrate", "impel", "implant", "imply", "import", "impose", "imprison",
        "immerge", "immerse", "impinge", "impregnate", "impress", "imprint",
    },
    "il": {
        "illuminate", "illustrate", "illusion", "illude",
    },
    "ir": {
        "irradiate", "irradiance", "irrigate", "irrupt", "irruption",
    },
}

# Latin suffix meanings
LATIN_SUFFIXES: dict[str, tuple[str, str]] = {
    "esc": ("inchoative", "起始态"),
    "esce": ("inchoative", "起始态"),
    "ent": ("adjective suffix", "形容词后缀"),
    "ence": ("noun suffix", "名词后缀"),
    "ance": ("noun suffix", "名词后缀"),
    "ant": ("adjective suffix", "形容词后缀"),
    "tion": ("noun suffix", "名词后缀"),
    "sion": ("noun suffix", "名词后缀"),
    "ment": ("noun suffix", "名词后缀"),
    "ness": ("noun suffix", "名词后缀"),
    "ity": ("noun suffix", "名词后缀"),
    "ive": ("adjective suffix", "形容词后缀"),
    "ous": ("adjective suffix", "形容词后缀"),
    "al": ("adjective/noun suffix", "形容词/名词后缀"),
    "ate": ("verb suffix", "动词后缀"),
    "ify": ("verb suffix", "动词后缀"),
    "ize": ("verb suffix", "动词后缀"),
    "ly": ("adverb suffix", "副词后缀"),
    "ful": ("adjective suffix", "形容词后缀"),
    "less": ("adjective suffix", "形容词后缀"),
    "able": ("adjective suffix", "形容词后缀"),
    "ible": ("adjective suffix", "形容词后缀"),
    "ist": ("noun suffix", "名词后缀"),
    "ism": ("noun suffix", "名词后缀"),
    "er": ("noun/agent suffix", "名词/施动者后缀"),
    "or": ("noun/agent suffix", "名词/施动者后缀"),
    "ary": ("adjective/noun suffix", "形容词/名词后缀"),
    "ory": ("adjective/noun suffix", "形容词/名词后缀"),
    "ic": ("adjective suffix", "形容词后缀"),
    "ical": ("adjective suffix", "形容词后缀"),
    "ure": ("noun suffix", "名词后缀"),
    "age": ("noun suffix", "名词后缀"),
    "dom": ("noun suffix", "名词后缀"),
    "ship": ("noun suffix", "名词后缀"),
    "hood": ("noun suffix", "名词后缀"),
    "ling": ("noun suffix", "名词后缀"),
    "ess": ("noun suffix", "名词后缀"),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build word->roots mapping")
    parser.add_argument("--eudic", dest="eudic_dir", default=None,
                        help="Path to eudic parsed sharded JSON directory")
    parser.add_argument("--morphemes", dest="morphemes_dir", default=None,
                        help="Path to openetymology morphemes chunks directory")
    parser.add_argument("--output", dest="output_dir", default=None,
                        help="Output directory for sharded JSON")
    return parser.parse_args()


def html_to_text(html_bytes: bytes) -> str:
    """Decode MDX HTML value and extract plain text."""
    html = html_bytes.decode("utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n", strip=True)


def normalize_whitespace(text: str) -> str:
    """Collapse newlines and extra spaces into single spaces."""
    return re.sub(r"\s+", " ", text).strip()


# ──────────────────────────────────────────────────────────────────────
# Parse openetymology morphemes JSON
# ──────────────────────────────────────────────────────────────────────

def parse_morphemes_json(chunks_dir: Path) -> dict[str, dict]:
    """Parse openetymology chunk JSON files into word -> { morphemes, etymologyOrigin }."""
    result: dict[str, dict] = {}

    if not chunks_dir.exists():
        print(f"Warning: morphemes directory not found: {chunks_dir}", file=sys.stderr)
        return result

    for chunk_file in sorted(chunks_dir.glob("*.json")):
        try:
            with open(chunk_file, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: failed to read {chunk_file}: {e}", file=sys.stderr)
            continue

        entries = data.get("entries", {})
        if not isinstance(entries, dict):
            continue

        for slug, entry in entries.items():
            word = slug.strip().lower()
            if not word:
                continue

            morphemes = entry.get("morphemes", [])
            etymology_origin = entry.get("etymologyOrigin", "")

            if morphemes or etymology_origin:
                result[word] = {
                    "morphemes": morphemes,
                    "etymologyOrigin": etymology_origin,
                }

    return result


# ──────────────────────────────────────────────────────────────────────
# Load eudic parsed sharded JSON
# ──────────────────────────────────────────────────────────────────────

def load_eudic_data(eudic_dir: Path) -> dict[str, dict]:
    """Load eudic parsed sharded JSON (already in RootEntry format)."""
    result: dict[str, dict] = {}

    if not eudic_dir.exists():
        print(f"Warning: eudic directory not found: {eudic_dir}", file=sys.stderr)
        return result

    for shard_file in eudic_dir.glob("*.json"):
        if shard_file.name == "roots_manifest.json":
            continue
        try:
            with open(shard_file, "r", encoding="utf-8") as f:
                entries = json.load(f)
            for word, entry in entries.items():
                if word not in result:
                    result[word] = entry
        except (json.JSONDecodeError, OSError) as e:
            print(f"Warning: failed to read {shard_file}: {e}", file=sys.stderr)

    return result


# ──────────────────────────────────────────────────────────────────────
# Parse 词根词缀字典2.mdx (jsmind tree format)
# ──────────────────────────────────────────────────────────────────────

def _is_root_component(word: str, topic: str) -> bool:
    """Check if a jsmind child node is a root/affix (not a derived word)."""
    if topic == word:
        return False
    if "-" in topic:
        # True root: starts or ends with hyphen (e.g. ab-, -ate)
        # Or short segments like e-,ef-,ex-
        if topic.startswith("-") or topic.endswith("-"):
            return True
        parts = topic.split("-")
        if all(len(p) <= 4 for p in parts if p):
            return True
        return False
    # Non-hyphenated: shorter than word = root component
    return len(topic) < len(word)


def parse_roots_dict_mdx(mdx_path: Path) -> dict[str, dict]:
    """Parse 词根词缀字典2.mdx into word -> { roots: [{topic, describe}, ...] }.

    Each entry is a jsmind tree where children of the root node are root/affix components.
    """
    from readmdict import MDX

    result = {}
    mdx = MDX(str(mdx_path))

    for key, value in mdx.items():
        word = key.decode("utf-8", errors="replace").strip().lower()
        if not word or len(word) > 60:
            continue

        html = value.decode("utf-8", errors="replace")

        # Extract jsmind JSON from jsMind.show({}, {...})
        m = re.search(r"jsMind\.show\(\{.*?\},(\{.*?\})\)", html, re.DOTALL)
        if not m:
            continue

        try:
            mind = json.loads(m.group(1))
        except json.JSONDecodeError:
            continue

        nodes = mind.get("data", [])
        if len(nodes) < 2:
            continue

        # Find children of the root node
        children = [
            n for n in nodes
            if n.get("parentid") == word and _is_root_component(word, n.get("topic", ""))
        ]

        if not children:
            continue

        result[word] = {"nodes": children}

    return result


def _shorten_meaning(meaning: str, max_len: int = 15) -> str:
    """Shorten a root meaning to a concise form."""
    if not meaning:
        return ""

    # Strip biao shi prefix and quotes
    text = re.sub(r'^表示["“”]', "", meaning)
    text = text.strip('"').strip('"').strip('"')

    # Remove parenthetical English: (from), (not, opposite)
    text = re.sub(r"[(\（][^)\）]+[)\）]", "", text)
    # Remove leading English words before Chinese
    text = re.sub(r"^[a-zA-Z\s,;.]+", "", text)
    # Remove trailing English after comma/semicolon
    text = re.sub(r"[,;]\s*[a-zA-Z].*$", "", text)
    text = text.strip().rstrip("，,；;。.")

    if not text:
        # Fallback: take first clause before comma
        text = meaning.split("，")[0].split(",")[0].strip()
        text = re.sub(r"[(\（][^)\）]+[)\）]", "", text).strip()

    # Truncate if still too long
    if len(text) > max_len:
        # Try to cut at comma or semicolon
        for sep in ["，", ",", "；", ";"]:
            idx = text.find(sep)
            if 2 <= idx <= max_len:
                text = text[:idx]
                break
        else:
            text = text[:max_len]

    return text.strip()


def _extract_meaning_from_desc(describe: str) -> str:
    # Extract Chinese meaning from a jsmind node describe field.
    # Handles formats like:
    #   = short, biao shi "duan, suo duan"
    #   biao dong ci, "zuo, zao cheng"
    #   biao shi "ren huo wu"
    #   mei [...] li, cong
    #   [['= back, biao shi "hou mian".']]
    if not describe:
        return ""

    # Strip [['...']] wrapper
    desc = re.sub(r"^\[\['(.*?)'\]\]$", r"\1", describe).strip()
    if not desc:
        desc = describe

    # Pattern 1: biao shi "meaning" (Unicode curly quotes U+201C/U+201D)
    m = re.search(r"表示[“”\"]([^“”\"]+)", desc)
    if m:
        return m.group(1).strip()

    # Pattern 2: biao xxx, meaning (up to period or end)
    m = re.search(r"表(?:[a-z]+|[^\s,，]+)[，,]\s*(.+?)(?:[。.]|$)", desc)
    if m:
        text = m.group(1).strip().rstrip("等")
        # If quoted, extract just the quoted part
        qm = re.match(r'^["“”]([^"“”]+)["“”]', text)
        if qm:
            return qm.group(1).strip()
        # Strip wrapping quotes
        text = text.strip('"').strip('“”')
        if text:
            return text

    # Pattern 3: Chinese text after comma
    m = re.search(r"[，,]\s*(.{2,})$", desc)
    if m:
        text = m.group(1).strip().rstrip("。.")
        if any("一" <= c <= "鿿" for c in text):
            return text

    return ""


def build_from_roots_dict(word: str, data: dict) -> dict | None:
    """Build RootEntry from 词根词缀字典2.mdx jsmind tree data."""
    nodes = data.get("nodes", [])
    if not nodes:
        return None

    components = []
    roots_list = []

    for node in nodes:
        topic = node.get("topic", "").strip()
        describe = node.get("describe", "").strip()
        if not topic:
            continue

        # Clean topic: remove trailing hyphen for display
        display_topic = topic.rstrip("-") if topic.endswith("-") and not topic.startswith("-") else topic

        # Try knowledge base first (shorter, more concise)
        decomposed = decompose_root(display_topic, word)
        if decomposed and decomposed[0][1]:
            meaning = decomposed[0][1]
        else:
            meaning = _shorten_meaning(_extract_meaning_from_desc(describe))

        if meaning:
            components.append(f"{display_topic}（{meaning}）")
        else:
            components.append(display_topic)
        roots_list.append({"root": display_topic, "meaning": meaning, "relatedWords": []})

    if not components:
        return None

    return {
        "rootBreakdown": " + ".join(components),
        "roots": roots_list,
    }


# ──────────────────────────────────────────────────────────────────────
# Parse 英语词根词源记忆词典.mdx
# ──────────────────────────────────────────────────────────────────────

def parse_etymology_dict(mdx_path: Path) -> dict[str, dict]:
    """Parse 英语词根词源记忆词典.mdx into word -> { etymology, rootMemory, rootMemoryBreakdown }."""
    from readmdict import MDX

    result = {}
    mdx = MDX(str(mdx_path))

    for key, value in mdx.items():
        word = key.decode("utf-8", errors="replace").strip().lower()
        if not word or len(word) > 60:
            continue

        text = html_to_text(value)
        if not text:
            continue

        entry: dict = {}

        etym_match = re.search(r"词源[：:]\s*\n?(.*?)(?=\n词根记忆|\n词根词缀|\Z)", text, re.DOTALL)
        if etym_match:
            etym = normalize_whitespace(etym_match.group(1))
            if etym:
                entry["etymology"] = etym

        memory_match = re.search(r"词根记忆[：:]\s*\n?(.*?)(?=\n词根词缀|\Z)", text, re.DOTALL)
        if memory_match:
            memory = normalize_whitespace(memory_match.group(1))
            if memory:
                entry["rootMemory"] = memory
                # Extract breakdown from parentheses like "(a不+ban+don给予->不禁止给出去->放弃)"
                breakdown_match = re.search(r"[(\（]([^)\）]*(?:[＋+]|->|→)[^)\）]*)[)\）]", memory)
                if breakdown_match:
                    entry["rootMemoryBreakdown"] = breakdown_match.group(1)

        if entry:
            result[word] = entry

    return result


# ──────────────────────────────────────────────────────────────────────
# Root decomposition engine
# ──────────────────────────────────────────────────────────────────────

def decompose_root(root: str, word: str = "") -> list[tuple[str, str]]:
    """Decompose a root into sub-roots with meanings."""
    lower = root.lower().strip("-")

    if lower in COMPOUND_ROOTS:
        return COMPOUND_ROOTS[lower]

    if lower in LATIN_PREFIXES:
        return [(lower, choose_prefix_meaning(lower, word))]

    if lower in LATIN_SUFFIXES:
        en, zh = LATIN_SUFFIXES[lower]
        return [(lower, zh)]

    return [(root, "")]


def choose_prefix_meaning(prefix: str, word: str) -> str:
    candidates = LATIN_PREFIXES.get(prefix.lower(), [])
    if not candidates:
        return ""

    into_words = ASSIMILATED_INTO_WORDS.get(prefix.lower())
    if into_words and word.lower() in into_words:
        return candidates[1][1] if len(candidates) > 1 else candidates[0][1]

    return candidates[0][1]


def normalize_component_display(component: str, original_piece: str = "") -> str:
    """Normalize root/affix display for UI.

    - Prefixes show as `ad-`
    - Suffixes show as `-ence`
    - Roots stay bare, e.g. `ject`
    """
    clean = component.strip().strip("-")
    lower = clean.lower()
    original = original_piece.strip()

    if original.startswith("-") or lower in LATIN_SUFFIXES:
        return f"-{clean}"
    if original.endswith("-") or lower in LATIN_PREFIXES:
        return f"{clean}-"
    return clean


def refine_entry(entry: dict, word: str = "") -> dict:
    """Refine a root entry by decomposing coarse-grained roots using the knowledge base.

    eudic source data often has coarse-grained roots like "adul-" and "-escence"
    that should be further decomposed into finer sub-roots using COMPOUND_ROOTS,
    LATIN_PREFIXES, and LATIN_SUFFIXES.

    This function iterates over each root in the entry, calls decompose_root(),
    and if the decomposition produces multiple sub-roots, replaces the coarse
    root with the fine-grained sub-roots. It then rebuilds rootBreakdown from
    the refined roots.
    """
    roots = entry.get("roots", [])
    if not roots:
        return entry

    new_roots: list[dict] = []
    changed = False

    for r in roots:
        root_name = r.get("root", "")
        if not root_name:
            continue

        # If the root (stripped of hyphens) is already a known prefix or suffix
        # in the knowledge base, keep it as-is — no further decomposition needed.
        clean = root_name.strip("-").lower()
        if (root_name.startswith("-") or root_name.endswith("-")) and \
           (clean in LATIN_PREFIXES or clean in LATIN_SUFFIXES):
            new_roots.append(r)
            continue

        decomposed = decompose_root(root_name, word)
        if len(decomposed) > 1:
            changed = True
            for sub_root, sub_meaning in decomposed:
                display = normalize_component_display(sub_root, sub_root)
                meaning = sub_meaning or ""
                new_roots.append({"root": display, "meaning": meaning, "relatedWords": []})
        else:
            new_roots.append(r)

    if not changed:
        return entry

    # Rebuild rootBreakdown from refined roots
    components = []
    for r in new_roots:
        meaning = (r.get("meaning") or "").strip()
        if meaning:
            components.append(f"{r['root']}（{meaning}）")
        else:
            components.append(r["root"])

    return {
        **entry,
        "rootBreakdown": " + ".join(components),
        "roots": new_roots,
    }


# ──────────────────────────────────────────────────────────────────────
# Build root breakdown from morphemes JSON
# ──────────────────────────────────────────────────────────────────────

def build_from_morphemes(word: str, data: dict) -> dict | None:
    """Build RootEntry from openetymology morphemes data."""
    entry: dict = {}

    etymology_origin = data.get("etymologyOrigin", "")
    if etymology_origin:
        entry["etymology"] = etymology_origin

    morphemes = data.get("morphemes", [])
    if not morphemes:
        return entry if entry else None

    components = []
    roots_list = []

    for m in morphemes:
        piece = (m.get("piece") or "").strip()
        gloss = (m.get("gloss") or "").strip()

        if not piece:
            continue

        decomposed = decompose_root(piece, word)
        if len(decomposed) > 1:
            for sub_root, sub_meaning in decomposed:
                display_root = normalize_component_display(sub_root, sub_root)
                if sub_meaning:
                    components.append(f"{display_root}（{sub_meaning}）")
                else:
                    components.append(display_root)
                roots_list.append({
                    "root": display_root,
                    "meaning": sub_meaning or "",
                    "relatedWords": [],
                })
            continue

        if decomposed and decomposed[0][1] and not gloss:
            gloss = decomposed[0][1]

        display_piece = normalize_component_display(piece, piece)

        if gloss:
            components.append(f"{display_piece}（{gloss}）")
        else:
            components.append(display_piece)

        roots_list.append({
            "root": display_piece,
            "meaning": gloss,
            "relatedWords": [],
        })

    if components:
        entry["rootBreakdown"] = " + ".join(components)
        entry["roots"] = roots_list

    return entry if entry else None


# ──────────────────────────────────────────────────────────────────────
# Build root breakdown from MDX data (fallback)
# ──────────────────────────────────────────────────────────────────────

def extract_roots_from_etymology(etymology: str) -> list[tuple[str, str]]:
    """Try to extract root components from etymology text."""
    roots = []

    # Pattern: word/affix "meaning" connected by + or ,
    pattern = r'(?:from\s+)?(?:L\.\s*|O\.Fr\.\s*|M\.Fr\.\s*)?(\w[\w-]*)\s*"([^"]+)"'
    matches = re.findall(pattern, etymology)
    for root_name, meaning in matches:
        if root_name.lower() in {"see", "also", "related", "nom", "gen", "pp", "prp", "v", "n", "adj", "adv"}:
            continue
        roots.append((root_name, meaning))

    return roots


def build_from_mdx(word: str, etym: dict) -> dict | None:
    """Build RootEntry from MDX etymology data (fallback)."""
    entry: dict = {}

    if etym.get("etymology"):
        entry["etymology"] = etym["etymology"]

    breakdown_str = etym.get("rootMemoryBreakdown", "")

    # If no rootMemoryBreakdown, try to extract from etymology text
    if not breakdown_str and etym.get("etymology"):
        etym_roots = extract_roots_from_etymology(etym["etymology"])
        if etym_roots:
            components = []
            roots_list = []
            for root_name, meaning in etym_roots:
                decomposed = decompose_root(root_name, word)
                if decomposed and decomposed[0][1] and not meaning:
                    meaning = decomposed[0][1]
                if meaning:
                    components.append(f"{root_name}（{meaning}）")
                else:
                    components.append(root_name)
                roots_list.append({"root": root_name, "meaning": meaning, "relatedWords": []})
            if components:
                entry["rootBreakdown"] = " + ".join(components)
                entry["roots"] = roots_list
                return entry

    if not breakdown_str:
        return entry if entry else None

    # Parse breakdown: "ap加强+par出现+ent形容词后缀→出现时的"
    arrow_match = re.search(r"((?:->|→)[^＋+]*)$", breakdown_str)
    arrow = arrow_match.group(1).strip() if arrow_match else ""

    breakdown_text = breakdown_str
    if arrow:
        breakdown_text = breakdown_str[: -len(arrow)]

    parts = re.split(r"[＋+]", breakdown_text)
    components = []
    roots_list = []

    for part in parts:
        part = part.strip()
        if not part:
            continue

        meaning_match = re.search(r"[(\（]([^)\）]+)[)\）]", part)
        root_name = re.sub(r"[(\（][^)\）]*[)\）]", "", part).strip()
        meaning = meaning_match.group(1) if meaning_match else ""

        if not root_name:
            continue

        sub_roots = decompose_root(root_name, word)
        if len(sub_roots) > 1:
            for sub_root, sub_meaning in sub_roots:
                if sub_meaning:
                    components.append(f"{sub_root}（{sub_meaning}）")
                else:
                    components.append(sub_root)
                roots_list.append({"root": sub_root, "meaning": sub_meaning or "", "relatedWords": []})
        else:
            display_root = root_name
            if root_name == "ent" and word.endswith("ence"):
                display_root = "-ence"
            elif root_name == "ant" and word.endswith("ance"):
                display_root = "-ance"

            if not meaning:
                decomposed = decompose_root(root_name, word)
                if decomposed and decomposed[0][1]:
                    meaning = decomposed[0][1]

            if meaning:
                components.append(f"{display_root}（{meaning}）")
            else:
                components.append(display_root)
            roots_list.append({"root": display_root, "meaning": meaning, "relatedWords": []})

    if components:
        result = " + ".join(components)
        if arrow:
            result += " " + arrow
        entry["rootBreakdown"] = result
        entry["roots"] = roots_list

    return entry if entry else None


# ──────────────────────────────────────────────────────────────────────
# Build word -> roots mapping
# ──────────────────────────────────────────────────────────────────────

def build_word_to_roots(
    eudic_data: dict[str, dict],
    morphemes_data: dict[str, dict],
) -> dict[str, dict]:
    """Combine approved sources into a word -> roots mapping.

    Priority:
      1. eudic has the word -> use it
      2. morphemes JSON has the word -> use morphemes
    """
    result: dict[str, dict] = {}

    all_words = (
        set(eudic_data.keys())
        | set(morphemes_data.keys())
    )

    for word in all_words:
        entry = None

        # Priority 1: morphemes JSON
        if word in morphemes_data:
            entry = build_from_morphemes(word, morphemes_data[word])

        # Priority 2: eudic (fallback only) — refine coarse-grained roots
        if entry is None and word in eudic_data:
            entry = refine_entry(eudic_data[word], word)

        if entry:
            result[word] = entry

    return result


def emit_shards(word_roots: dict[str, dict], output_dir: Path) -> None:
    """Write word->roots mapping as sharded JSON files."""
    if not word_roots:
        print("No root data generated — skipping emit to preserve existing data")
        return

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
        "schemaVersion": "1.0.0",
        "dataVersion": "latest",
        "packType": "roots",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "entryCount": len(word_roots),
        "shardCount": len(shards),
        "shards": sorted(shards.keys()),
        "layout": {
            "shardSubdir": "words",
            "shardExtension": ".json",
        },
        "files": [
            {"name": f"{char}.json"}
            for char in sorted(shards.keys())
        ],
    }
    manifest_path = output_dir.parent / "manifest.json"
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"Emitted {len(word_roots)} entries across {len(shards)} shards")
    print(f"Output: {output_dir}")


def main() -> None:
    args = parse_args()

    eudic_path = Path(args.eudic_dir) if args.eudic_dir else DEFAULT_EUDIC_DIR
    morphemes_path = Path(args.morphemes_dir) if args.morphemes_dir else DEFAULT_MORPHEMES_DIR
    output_dir = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_DIR

    print(f"Loading eudic data: {eudic_path}")
    eudic_data = load_eudic_data(eudic_path)
    print(f"  -> {len(eudic_data)} entries")

    print(f"Parsing morphemes JSON: {morphemes_path}")
    morphemes_data = parse_morphemes_json(morphemes_path)
    print(f"  -> {len(morphemes_data)} entries")

    print("Building word->roots mapping...")
    word_roots = build_word_to_roots(eudic_data, morphemes_data)
    print(f"  -> {len(word_roots)} words with root data")

    emit_shards(word_roots, output_dir)


if __name__ == "__main__":
    main()
