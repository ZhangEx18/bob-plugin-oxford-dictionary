from __future__ import annotations

from typing import Any

from .shared_core import *

def build_relation_metadata(
    standalone_cache: dict[str, dict[str, Any]],
) -> tuple[dict[str, list[dict[str, str]]], dict[str, list[dict[str, str]]], dict[str, list[dict[str, Any]]], dict[str, set[str]]]:
    """Stage C-1: Build child/parent relation maps and blocked forms from parsed entries."""
    print("Stage C-1: Building relation metadata...")
    child_relations_map: dict[str, list[dict[str, str]]] = {}
    parent_relations_map: dict[str, list[dict[str, str]]] = {}
    relation_edges_map: dict[str, list[dict[str, Any]]] = {}
    blocked_surface_forms_by_base: dict[str, set[str]] = {}

    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        allow_plural_relations, blocked_forms = classify_surface_s_relations(entry)
        if blocked_forms:
            blocked_surface_forms_by_base[base_word] = blocked_forms
        for key in EXCHANGE_DISPLAY_ORDER:
            label = classify_inflection_parent(entry, key)
            if key == "s" and not allow_plural_relations:
                continue
            for form in exchange_values.get(key, []):
                form_key = form.lower()
                if form_key in blocked_forms:
                    continue
                if not label:
                    continue
                child_relations_map.setdefault(base_word, [])
                relation = build_relation(form, label)
                if relation not in child_relations_map[base_word]:
                    child_relations_map[base_word].append(relation)
                append_relation_edge(
                    relation_edges_map,
                    base_word,
                    build_relation_edge(
                        relation_type="inflection",
                        target=form,
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="exchange",
                    ),
                )
                if form_key == base_word:
                    continue
                if entry.get("pos") and form_key not in parent_relations_map:
                    parent_relations_map[form_key] = [build_relation(entry["word"], "原形")]
                    parent_relations_map[form_key][0]["_inflection_label"] = label
                elif entry.get("pos") and form_key in parent_relations_map:
                    # Create a separate relation for each label so that homographic
                    # forms like "leaves" (both 3rd person singular and plural of
                    # "leave") get distinct inflection_sources entries.
                    new_relation = build_relation(entry["word"], "原形")
                    new_relation["_inflection_label"] = label
                    parent_relations_map[form_key].append(new_relation)

        # Infer plural forms for nouns that have a self-plural (s:word) but also
        # a regular 3rd-person form (3:xxx) where xxx doubles as a plural.
        # Example: "score" has s:score (self-plural) and 3:scores, so "scores"
        # should also be queryable as a plural of "score".
        s_forms = exchange_values.get("s", [])
        thirdps_forms = exchange_values.get("3", [])
        if (
            s_forms
            and thirdps_forms
            and base_word not in IRREGULAR_PLURALS
            and "n" in parse_pos_keys(entry.get("pos", ""))
        ):
            if any(f.lower() == base_word for f in s_forms):
                for form in thirdps_forms:
                    form_key = form.lower()
                    if form_key == base_word:
                        continue
                    if form_key in blocked_forms:
                        continue
                    if not is_regular_inflection(base_word, form_key, "s"):
                        continue
                    label = "复数"
                    child_relations_map.setdefault(base_word, [])
                    relation = build_relation(form, label)
                    if relation not in child_relations_map[base_word]:
                        child_relations_map[base_word].append(relation)
                    append_relation_edge(
                        relation_edges_map,
                        base_word,
                        build_relation_edge(
                            relation_type="inflection",
                            target=form,
                            label=label,
                            direction="outgoing",
                            navigable=True,
                            display="exchange",
                            source="derived",
                        ),
                    )
                    if form_key not in parent_relations_map:
                        parent_relations_map[form_key] = [build_relation(entry["word"], "原形")]
                        parent_relations_map[form_key][0]["_inflection_label"] = label
                    else:
                        existing_parents = parent_relations_map[form_key]
                        has_plural_parent = any(
                            p.get("_inflection_label") == label for p in existing_parents
                        )
                        if not has_plural_parent:
                            new_parent = build_relation(entry["word"], "原形")
                            new_parent["_inflection_label"] = label
                            parent_relations_map[form_key].append(new_parent)

    # Infer plural forms for nouns that lack an explicit 's' slot in their exchange.
    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        pos_keys = parse_pos_keys(entry.get("pos", ""))
        if "n" not in pos_keys:
            continue
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        existing_s = set(f.lower() for f in exchange_values.get("s", []))
        if existing_s:
            continue
        # Skip if all noun senses are uncountable
        detail_parts = entry.get("translation_detail_parts", [])
        noun_details = [
            d for part in detail_parts
            if part.get("pos") == "n."
            for d in part.get("details", [])
        ]
        if noun_details and all(d.get("countability") == "uncountable" for d in noun_details):
            continue
        inferred = infer_plural_form(entry["word"])
        if not inferred or inferred.lower() == base_word:
            continue
        inf_key = inferred.lower()
        # Skip if already handled via exchange or blocked
        blocked = blocked_surface_forms_by_base.get(base_word, set())
        if inf_key in blocked:
            continue
        if inf_key in existing_s:
            continue
        label = EXCHANGE_DISPLAY_LABELS.get("s", "复数")
        # Always add child relation on the base side.
        child_relations_map.setdefault(base_word, [])
        relation = build_relation(inferred, label)
        if relation not in child_relations_map[base_word]:
            child_relations_map[base_word].append(relation)
        append_relation_edge(
            relation_edges_map,
            base_word,
            build_relation_edge(
                relation_type="inflection",
                target=inferred,
                label=label,
                direction="outgoing",
                navigable=True,
                display="exchange",
                source="derived",
            ),
        )
        # Add parent relation for the inferred plural if it does not already
        # have a plural relation.  This lets mixed-POS words like "part"
        # (where "parts" is already a third-person singular form) also
        # acquire a plural parent relation so noun senses are queryable.
        existing_parents = parent_relations_map.get(inf_key, [])
        has_plural_parent = any(
            p.get("_inflection_label") == label for p in existing_parents
        )
        if not has_plural_parent:
            new_parent = build_relation(entry["word"], "原形")
            new_parent["_inflection_label"] = label
            parent_relations_map.setdefault(inf_key, [])
            parent_relations_map[inf_key].append(new_parent)

    print(f"Stage C-1 complete: {len(child_relations_map)} bases with child relations")
    return child_relations_map, parent_relations_map, relation_edges_map, blocked_surface_forms_by_base


def finalize_standalone_entries(
    standalone_cache: dict[str, dict[str, Any]],
    child_relations_map: dict[str, list[dict[str, str]]],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Stage C-2: Apply relation metadata to standalone entries."""
    print("Stage C-2: Finalizing standalone entries...")
    finalized_entries: dict[str, dict[str, Any]] = {}
    for word_key, entry in standalone_cache.items():
        parent_relation = None
        potential_parents = parent_relations_map.get(word_key, [])

        if potential_parents:
            primary_parent = potential_parents[0]
            base_word = primary_parent["word"].lower()
            base_entry = standalone_cache.get(base_word)
            if base_entry:
                base_exchange = parse_exchange_values(base_entry.get("exchange", ""))
                current_form_key = None
                for key in EXCHANGE_DISPLAY_ORDER:
                    forms = base_exchange.get(key, [])
                    if word_key in [f.lower() for f in forms]:
                        current_form_key = key
                        break

                if current_form_key and not is_regular_inflection(base_word, word_key, current_form_key):
                    if word_key not in HOMOGRAPH_PROTECTED_FORMS:
                        parent_relation = primary_parent

                        is_shared_past_surface = (
                            current_form_key in {"p", "d"}
                            and word_key in [f.lower() for f in base_exchange.get("p", [])]
                            and word_key in [f.lower() for f in base_exchange.get("d", [])]
                        )
                        if not is_shared_past_surface:
                            current_idx = EXCHANGE_DISPLAY_ORDER.index(current_form_key)
                            allowed_later_keys = FORM_KEY_FAMILIES.get(current_form_key, set())
                            for later_key in EXCHANGE_DISPLAY_ORDER[current_idx + 1 :]:
                                if later_key not in allowed_later_keys:
                                    continue
                                label = classify_inflection_parent(base_entry, later_key)
                                if not label:
                                    continue
                                for form in base_exchange.get(later_key, []):
                                    if form.lower() == word_key:
                                        continue
                                    # For irregular comparative/superlative forms, only link to
                                    # other irregular forms in the same suppletion path.
                                    if current_form_key in {"c", "sup"}:
                                        lower_form = form.lower()
                                        is_current_irregular = (
                                            word_key in IRREGULAR_COMPARATIVE_FORMS
                                            or word_key in IRREGULAR_SUPERLATIVE_FORMS
                                        )
                                        is_target_irregular = (
                                            lower_form in IRREGULAR_COMPARATIVE_FORMS
                                            or lower_form in IRREGULAR_SUPERLATIVE_FORMS
                                        )
                                        if is_current_irregular and not is_target_irregular:
                                            continue
                                    relation = build_relation(form, label)
                                    existing = child_relations_map.get(word_key, [])
                                    if relation not in existing:
                                        child_relations_map.setdefault(word_key, []).append(relation)
                                    append_relation_edge(
                                        relation_edges_map,
                                        word_key,
                                        build_relation_edge(
                                            relation_type="inflection",
                                            target=form,
                                            label=label,
                                            direction="outgoing",
                                            navigable=True,
                                            display="exchange",
                                            source="derived",
                                        ),
                                    )

        # Strip internal metadata fields from parent_relation before serializing.
        clean_parent_relation = None
        if parent_relation:
            clean_parent_relation = {k: v for k, v in parent_relation.items() if not k.startswith("_")}

        relations = [*relation_edges_map.get(word_key, [])]
        if clean_parent_relation:
            parent_label = primary_parent.get("_inflection_label", "原形") if potential_parents else "原形"
            relations = [
                build_relation_edge(
                    relation_type="origin",
                    target=clean_parent_relation["word"],
                    label=parent_label,
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                    primary=True,
                ),
                *relations,
            ]
        if len(potential_parents) > 1:
            for pp in potential_parents:
                labels = pp.get("_inflection_label", "")
                append_relation_edge(
                    relation_edges_map,
                    word_key,
                    build_relation_edge(
                        relation_type="origin",
                        target=pp["word"],
                        label=labels,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="derived",
                        primary=(pp is potential_parents[0]),
                    ),
                )
            relations = [*relation_edges_map.get(word_key, [])]

        if word_key in HOMOGRAPH_PROTECTED_FORMS:
            for base, label in HOMOGRAPH_PROTECTED_FORMS[word_key]:
                append_relation_edge(
                    relation_edges_map,
                    word_key,
                    build_relation_edge(
                        relation_type="xref",
                        target=base,
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="reference",
                        source="protected",
                    ),
                )
            relations = [*relation_edges_map.get(word_key, [])]

        finalized_entries[word_key] = apply_relation_metadata(
            entry,
            entry_kind="standalone",
            display_word=entry["word"],
            relations=relations,
        )

    print("Stage C-2 complete")
    return finalized_entries


def process_link_entries(
    finalized_entries: dict[str, dict[str, Any]],
    final_target: dict[str, str],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
    blocked_surface_forms_by_base: dict[str, set[str]],
    lookup: dict[str, str],
) -> int:
    """Stage C-3: Process link entries (@ @ @ LINK=) into inflections or aliases."""
    print("Stage C-3: Processing link entries...")
    link_processed = 0
    link_skipped = 0

    for word, target in final_target.items():
        word_key = word.lower()
        if word_key in finalized_entries:
            continue

        target_key = target.lower()
        target_entry = finalized_entries.get(target_key)
        if not target_entry:
            link_skipped += 1
            continue

        potential_parents = parent_relations_map.get(word_key, [])
        parent_relation = potential_parents[0] if potential_parents else None
        display_word = target_entry["word"]
        source_entry = target_entry
        target_blocked_forms = blocked_surface_forms_by_base.get(target_key, set())
        if not parent_relation:
            plural_parent = find_standalone_plural_parent(word_key, finalized_entries)
            if plural_parent:
                parent_entry = finalized_entries.get(plural_parent)
                if parent_entry:
                    parent_relation = build_relation(parent_entry["word"], "原形")
                    display_word = parent_entry["word"]
                    source_entry = parent_entry
                    relation = build_relation(word, "复数")
                    append_relation_edge(
                        relation_edges_map,
                        plural_parent,
                        build_relation_edge(
                            relation_type="inflection",
                            target=word,
                            label="复数",
                            direction="outgoing",
                            navigable=True,
                            display="exchange",
                            source="derived",
                        ),
                    )
        elif has_standalone_entry(parent_relation["word"], lookup):
            display_word = parent_relation["word"]

        if word_key in target_blocked_forms:
            display_word = word
            parent_relation = None
        elif should_preserve_alias_surface(word_key, target_entry, parent_relation):
            display_word = word

        entry_kind = "inflection" if parent_relation else "alias"
        inflection_label = None
        if parent_relation:
            if len(potential_parents) > 1:
                labels = [
                    pp.get("_inflection_label", "")
                    for pp in potential_parents
                    if pp.get("_inflection_label")
                ]
                inflection_label = ",".join(labels) if labels else None
            else:
                inflection_label = parent_relation.get("_inflection_label")
            # If no _inflection_label, it came from find_standalone_plural_parent
            if not inflection_label:
                inflection_label = "复数"

        if inflection_label:
            source_entry = filter_entry_pos_and_translation(source_entry, inflection_label)

        clean_parent_relation = {k: v for k, v in parent_relation.items() if not k.startswith("_")} if parent_relation else None
        relations: list[dict[str, Any]] = []
        if clean_parent_relation:
            relation_label = inflection_label or "原形"
            relations.append(
                build_relation_edge(
                    relation_type="origin",
                    target=clean_parent_relation["word"],
                    label=relation_label,
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                    primary=True,
                )
            )

        if len(potential_parents) > 1:
            relations = []
            for index, pp in enumerate(potential_parents):
                label = pp.get("_inflection_label", "原形")
                relations.append(
                    build_relation_edge(
                        relation_type="origin",
                        target=pp["word"],
                        label=label,
                        direction="outgoing",
                        navigable=True,
                        display="exchange",
                        source="derived",
                        primary=(index == 0),
                    )
                )

        data = apply_relation_metadata(
            {
                **source_entry,
                "word": word,
                "linked_word": target_entry["word"],
            },
            entry_kind=entry_kind,
            display_word=display_word,
            relations=relations,
        )
        finalized_entries[word_key] = data
        link_processed += 1
        if link_processed % REPORT_INTERVAL == 0:
            print(f"  Links processed: {link_processed}")

    print(f"Stage C-3 complete: {link_processed} links, {link_skipped} skipped")
    return link_processed


def materialize_missing_inflections(finalized_entries: dict[str, dict[str, Any]]) -> int:
    """Stage C-4: Create inflection entries for forms that lack standalone entries.

    After building relation metadata, some inflected forms (e.g., "walked", "cats")
    may not have their own standalone entry in the dictionary. This function scans
    all outgoing inflection relations on standalone entries and creates synthetic
    inflection entries for any target form that does not already exist in
    finalized_entries.

    Each materialized entry is a shallow copy of the parent entry with:
    - POS and translation filtered to only the relevant inflection type
    - word set to the inflected form
    - linked_word set to the parent/base word
    - entry_kind set to "inflection"
    - A primary "origin" relation edge pointing back to the parent

    This ensures that querying any inflected form returns a meaningful result
    with the parent's definitions, rather than a missing entry.

    Args:
        finalized_entries: The dictionary of all finalized entries, keyed by
            lowercase word. Will be mutated in-place to add new entries.

    Returns:
        The number of new inflection entries created.
    """
    print("Stage C-4: Materializing missing inflection entries...")
    materialized = 0
    for word_key, entry in list(finalized_entries.items()):
        if entry.get("entry_kind") != "standalone":
            continue

        for relation in entry.get("relations", []):
            if relation.get("type") != "inflection":
                continue
            if relation.get("direction") != "outgoing":
                continue
            form = relation["target"]
            form_key = form.lower()
            if form_key in finalized_entries:
                continue
            finalized_entries[form_key] = create_inflection_entry(form, entry, relation["label"])
            materialized += 1

    print(f"Stage C-4 complete: {materialized} entries materialized")
    return materialized


def write_shards(finalized_entries: dict[str, dict[str, Any]], total: int, processed: int, link_processed: int) -> None:
    """Stage D: Split entries into alphabetically-sharded JSON files.

    Groups all finalized entries by their first character (a-z) and writes
    each group to a separate JSON file (e.g., "a.json", "b.json"). This
    sharding strategy allows the Bob plugin to load only the relevant shard
    on demand, reducing memory usage and improving lookup speed.

    Shard writing strategy:
    - Entries are keyed by lowercase word; the first character determines the shard.
    - Each shard is a self-contained JSON object mapping word -> entry dict.
    - JSON is written with compact separators (",", ":") to minimize file size.
    - The output directory is created if it doesn't exist.

    After writing, prints a summary with entry counts and file sizes per shard.

    Args:
        finalized_entries: Complete dictionary of all entries (standalone,
            inflection, and alias), keyed by lowercase word.
        total: Total number of raw MDX entries (for reporting).
        processed: Number of non-link entries parsed (for reporting).
        link_processed: Number of link entries resolved (for reporting).
    """
    print("Stage D: Preparing shards...")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    shards: dict[str, dict[str, dict[str, Any]]] = {}
    for word_key, entry in finalized_entries.items():
        first_char = word_key[0].lower() if word_key else "_"
        shards.setdefault(first_char, {})
        shards[first_char][word_key] = entry

    print(f"\nWriting JSON shards to {OUTPUT_DIR}...")
    total_size = 0
    for char, entries in sorted(shards.items()):
        path = os.path.join(OUTPUT_DIR, f"{char}.json")
        content = json.dumps(entries, ensure_ascii=False, separators=(",", ":"))
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        size = os.path.getsize(path)
        total_size += size
        print(f"  {char}.json: {len(entries)} entries, {size / 1024 / 1024:.1f} MB")

    print(f"\nDone!")
    print(f"  Total MDX entries: {total}")
    print(f"  Non-link entries: {processed}")
    print(f"  Link entries: {link_processed}")
    print(f"  Total JSON entries: {len(finalized_entries)}")
    print(f"  Total size: {total_size / 1024 / 1024:.1f} MB")
    print(f"  Output: {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
