from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .shared_core import (
    EXCHANGE_DISPLAY_LABELS,
    EXCHANGE_DISPLAY_ORDER,
    FORM_KEY_FAMILIES,
    HOMOGRAPH_PROTECTED_FORMS,
    IRREGULAR_COMPARATIVE_FORMS,
    IRREGULAR_PLURALS,
    IRREGULAR_SUPERLATIVE_FORMS,
    REPORT_INTERVAL,
    append_relation_edge,
    apply_relation_metadata,
    build_relation,
    build_relation_edge,
    classify_inflection_parent,
    classify_surface_s_relations,
    copy_without_phrasal_verbs,
    create_inflection_entry,
    filter_entry_pos_and_translation,
    find_standalone_plural_parent,
    has_standalone_entry,
    infer_plural_form,
    is_regular_inflection,
    parse_exchange_values,
    parse_pos_keys,
    should_preserve_alias_surface,
)

@dataclass
class RelationBuildState:
    child_relations: dict[str, list[dict[str, str]]]
    parent_relations: dict[str, list[dict[str, str]]]
    relation_edges: dict[str, list[dict[str, Any]]]
    blocked_forms: dict[str, set[str]]

    @classmethod
    def empty(cls) -> "RelationBuildState":
        return cls({}, {}, {}, {})

    def add_inflection(
        self,
        base_word: str,
        form: str,
        label: str,
        source: str,
    ) -> None:
        relation = build_relation(form, label)
        children = self.child_relations.setdefault(base_word, [])
        if relation not in children:
            children.append(relation)
        append_relation_edge(
            self.relation_edges,
            base_word,
            build_relation_edge(
                relation_type="inflection",
                target=form,
                label=label,
                direction="outgoing",
                navigable=True,
                display="exchange",
                source=source,
            ),
        )

    def append_parent(self, form_key: str, base_word: str, label: str) -> None:
        parent = build_relation(base_word, "原形")
        parent["_inflection_label"] = label
        self.parent_relations.setdefault(form_key, []).append(parent)

    def ensure_parent(self, form_key: str, base_word: str, label: str) -> None:
        parents = self.parent_relations.get(form_key, [])
        if any(parent.get("_inflection_label") == label for parent in parents):
            return
        self.append_parent(form_key, base_word, label)


def add_exchange_relations(
    entry: dict[str, Any],
    exchange_values: dict[str, list[str]],
    allow_plural_relations: bool,
    state: RelationBuildState,
) -> None:
    base_word = entry["word"].lower()
    blocked_forms = state.blocked_forms.get(base_word, set())
    for exchange_key in EXCHANGE_DISPLAY_ORDER:
        label = classify_inflection_parent(entry, exchange_key)
        if not label or (exchange_key == "s" and not allow_plural_relations):
            continue
        for form in exchange_values.get(exchange_key, []):
            form_key = form.lower()
            if form_key in blocked_forms:
                continue
            state.add_inflection(base_word, form, label, "exchange")
            if form_key != base_word and entry.get("pos"):
                state.append_parent(form_key, entry["word"], label)


def add_third_person_plural_relations(
    entry: dict[str, Any],
    exchange_values: dict[str, list[str]],
    state: RelationBuildState,
) -> None:
    base_word = entry["word"].lower()
    blocked_forms = state.blocked_forms.get(base_word, set())
    plural_forms = exchange_values.get("s", [])
    third_person_forms = exchange_values.get("3", [])
    if (
        not plural_forms
        or not third_person_forms
        or base_word in IRREGULAR_PLURALS
        or "n" not in parse_pos_keys(entry.get("pos", ""))
        or not any(form.lower() == base_word for form in plural_forms)
    ):
        return

    for form in third_person_forms:
        form_key = form.lower()
        if (
            form_key == base_word
            or form_key in blocked_forms
            or not is_regular_inflection(base_word, form_key, "s")
        ):
            continue
        state.add_inflection(base_word, form, "复数", "derived")
        state.ensure_parent(form_key, entry["word"], "复数")


def infer_plural_relation_target(entry: dict[str, Any]) -> str | None:
    if "n" not in parse_pos_keys(entry.get("pos", "")):
        return None

    exchange_values = parse_exchange_values(entry.get("exchange", ""))
    if exchange_values.get("s"):
        return None

    noun_details = [
        detail
        for part in entry.get("translation_detail_parts", [])
        if part.get("pos") == "n."
        for detail in part.get("details", [])
    ]
    if noun_details and all(
        detail.get("countability") == "uncountable" for detail in noun_details
    ):
        return None

    inferred_plural = infer_plural_form(entry["word"])
    if not inferred_plural or inferred_plural.lower() == entry["word"].lower():
        return None
    return inferred_plural


def add_inferred_plural_relation(
    entry: dict[str, Any],
    state: RelationBuildState,
) -> None:
    base_word = entry["word"].lower()
    inferred_plural = infer_plural_relation_target(entry)
    if not inferred_plural:
        return

    plural_key = inferred_plural.lower()
    if plural_key in state.blocked_forms.get(base_word, set()):
        return

    label = EXCHANGE_DISPLAY_LABELS.get("s", "复数")
    state.add_inflection(base_word, inferred_plural, label, "derived")
    state.ensure_parent(plural_key, entry["word"], label)


def build_relation_metadata(
    standalone_cache: dict[str, dict[str, Any]],
) -> tuple[
    dict[str, list[dict[str, str]]],
    dict[str, list[dict[str, str]]],
    dict[str, list[dict[str, Any]]],
    dict[str, set[str]],
]:
    """Stage C-1: Build child/parent relation maps and blocked forms."""
    print("Stage C-1: Building relation metadata...")
    state = RelationBuildState.empty()

    for entry in standalone_cache.values():
        base_word = entry["word"].lower()
        exchange_values = parse_exchange_values(entry.get("exchange", ""))
        allow_plural_relations, blocked_forms = classify_surface_s_relations(entry)
        if blocked_forms:
            state.blocked_forms[base_word] = blocked_forms
        add_exchange_relations(
            entry,
            exchange_values,
            allow_plural_relations,
            state,
        )
        add_third_person_plural_relations(
            entry,
            exchange_values,
            state,
        )

    for entry in standalone_cache.values():
        add_inferred_plural_relation(entry, state)

    print(
        f"Stage C-1 complete: {len(state.child_relations)} "
        "bases with child relations"
    )
    return (
        state.child_relations,
        state.parent_relations,
        state.relation_edges,
        state.blocked_forms,
    )


@dataclass
class StandaloneFinalizeContext:
    standalone_entries: dict[str, dict[str, Any]]
    child_relations: dict[str, list[dict[str, str]]]
    relation_edges: dict[str, list[dict[str, Any]]]

    def add_forward_relations(
        self,
        word_key: str,
        current_form_key: str,
        base_entry: dict[str, Any],
        base_exchange: dict[str, list[str]],
    ) -> None:
        if current_form_key in {"p", "d"}:
            past_forms = [form.lower() for form in base_exchange.get("p", [])]
            participles = [form.lower() for form in base_exchange.get("d", [])]
            if word_key in past_forms and word_key in participles:
                return

        current_index = EXCHANGE_DISPLAY_ORDER.index(current_form_key)
        allowed_keys = FORM_KEY_FAMILIES.get(current_form_key, set())
        for later_key in EXCHANGE_DISPLAY_ORDER[current_index + 1 :]:
            if later_key not in allowed_keys:
                continue
            self._add_exchange_targets(
                word_key,
                current_form_key,
                base_entry,
                later_key,
                base_exchange.get(later_key, []),
            )

    def _add_exchange_targets(
        self,
        word_key: str,
        current_form_key: str,
        base_entry: dict[str, Any],
        later_key: str,
        forms: list[str],
    ) -> None:
        label = classify_inflection_parent(base_entry, later_key)
        if not label:
            return
        for form in forms:
            if form.lower() == word_key:
                continue
            if not should_link_suppletive_form(word_key, current_form_key, form):
                continue
            relation = build_relation(form, label)
            children = self.child_relations.setdefault(word_key, [])
            if relation not in children:
                children.append(relation)
            append_relation_edge(
                self.relation_edges,
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


def find_exchange_key(
    word_key: str,
    exchange_values: dict[str, list[str]],
) -> str | None:
    for exchange_key in EXCHANGE_DISPLAY_ORDER:
        if word_key in [form.lower() for form in exchange_values.get(exchange_key, [])]:
            return exchange_key
    return None


def should_link_suppletive_form(
    word_key: str,
    current_form_key: str,
    target_form: str,
) -> bool:
    if current_form_key not in {"c", "sup"}:
        return True
    current_is_irregular = (
        word_key in IRREGULAR_COMPARATIVE_FORMS
        or word_key in IRREGULAR_SUPERLATIVE_FORMS
    )
    target_key = target_form.lower()
    target_is_irregular = (
        target_key in IRREGULAR_COMPARATIVE_FORMS
        or target_key in IRREGULAR_SUPERLATIVE_FORMS
    )
    return not current_is_irregular or target_is_irregular


def resolve_parent_relation(
    word_key: str,
    potential_parents: list[dict[str, str]],
    context: StandaloneFinalizeContext,
) -> dict[str, str] | None:
    if not potential_parents or word_key in HOMOGRAPH_PROTECTED_FORMS:
        return None

    primary_parent = potential_parents[0]
    base_word = primary_parent["word"].lower()
    base_entry = context.standalone_entries.get(base_word)
    if not base_entry:
        return None

    base_exchange = parse_exchange_values(base_entry.get("exchange", ""))
    current_form_key = find_exchange_key(word_key, base_exchange)
    if (
        not current_form_key
        or is_regular_inflection(base_word, word_key, current_form_key)
    ):
        return None

    context.add_forward_relations(
        word_key,
        current_form_key,
        base_entry,
        base_exchange,
    )
    return primary_parent


def build_final_relations(
    word_key: str,
    potential_parents: list[dict[str, str]],
    parent_relation: dict[str, str] | None,
    context: StandaloneFinalizeContext,
) -> list[dict[str, Any]]:
    relations = [*context.relation_edges.get(word_key, [])]
    if parent_relation:
        clean_parent = {
            key: value
            for key, value in parent_relation.items()
            if not key.startswith("_")
        }
        parent_label = parent_relation.get("_inflection_label", "原形")
        relations.insert(
            0,
            build_relation_edge(
                relation_type="origin",
                target=clean_parent["word"],
                label=parent_label,
                direction="outgoing",
                navigable=True,
                display="exchange",
                source="derived",
                primary=True,
            ),
        )

    if len(potential_parents) > 1:
        for index, parent in enumerate(potential_parents):
            append_relation_edge(
                context.relation_edges,
                word_key,
                build_relation_edge(
                    relation_type="origin",
                    target=parent["word"],
                    label=parent.get("_inflection_label", ""),
                    direction="outgoing",
                    navigable=True,
                    display="exchange",
                    source="derived",
                    primary=index == 0,
                ),
            )
        relations = [*context.relation_edges.get(word_key, [])]

    for base_word, label in HOMOGRAPH_PROTECTED_FORMS.get(word_key, []):
        append_relation_edge(
            context.relation_edges,
            word_key,
            build_relation_edge(
                relation_type="xref",
                target=base_word,
                label=label,
                direction="outgoing",
                navigable=True,
                display="reference",
                source="protected",
            ),
        )
    if word_key in HOMOGRAPH_PROTECTED_FORMS:
        relations = [*context.relation_edges.get(word_key, [])]

    return relations


def finalize_standalone_entries(
    standalone_cache: dict[str, dict[str, Any]],
    child_relations_map: dict[str, list[dict[str, str]]],
    parent_relations_map: dict[str, list[dict[str, str]]],
    relation_edges_map: dict[str, list[dict[str, Any]]],
) -> dict[str, dict[str, Any]]:
    """Stage C-2: Apply relation metadata to standalone entries."""
    print("Stage C-2: Finalizing standalone entries...")
    context = StandaloneFinalizeContext(
        standalone_cache,
        child_relations_map,
        relation_edges_map,
    )
    finalized_entries: dict[str, dict[str, Any]] = {}
    for word_key, entry in standalone_cache.items():
        potential_parents = parent_relations_map.get(word_key, [])
        parent_relation = resolve_parent_relation(
            word_key,
            potential_parents,
            context,
        )
        relations = build_final_relations(
            word_key,
            potential_parents,
            parent_relation,
            context,
        )
        finalized_entries[word_key] = apply_relation_metadata(
            entry,
            entry_kind="standalone",
            display_word=entry["word"],
            relations=relations,
        )

    print("Stage C-2 complete")
    return finalized_entries


@dataclass
class LinkProcessingContext:
    finalized_entries: dict[str, dict[str, Any]]
    final_target: dict[str, str]
    parent_relations_map: dict[str, list[dict[str, str]]]
    relation_edges_map: dict[str, list[dict[str, Any]]]
    blocked_surface_forms_by_base: dict[str, set[str]]
    lookup: dict[str, str]


@dataclass
class ResolvedLinkSource:
    target_entry: dict[str, Any]
    potential_parents: list[dict[str, str]]
    parent_relation: dict[str, str] | None
    display_word: str
    source_entry: dict[str, Any]


def resolve_plural_link_parent(
    context: LinkProcessingContext,
    word: str,
) -> tuple[dict[str, str] | None, dict[str, Any] | None]:
    plural_parent = find_standalone_plural_parent(word.lower(), context.finalized_entries)
    parent_entry = context.finalized_entries.get(plural_parent) if plural_parent else None
    if not plural_parent or not parent_entry:
        return None, None
    append_relation_edge(
        context.relation_edges_map,
        plural_parent,
        build_relation_edge(
            relation_type="inflection", target=word, label="复数",
            direction="outgoing", navigable=True, display="exchange", source="derived",
        ),
    )
    return build_relation(parent_entry["word"], "原形"), parent_entry


def resolve_link_source(
    context: LinkProcessingContext,
    word: str,
    target_key: str,
    target_entry: dict[str, Any],
) -> ResolvedLinkSource:
    word_key = word.lower()
    potential_parents = context.parent_relations_map.get(word_key, [])
    parent_relation = potential_parents[0] if potential_parents else None
    display_word = target_entry["word"]
    source_entry = target_entry
    if not parent_relation:
        parent_relation, plural_source = resolve_plural_link_parent(context, word)
        if plural_source:
            display_word = plural_source["word"]
            source_entry = plural_source
    elif has_standalone_entry(parent_relation["word"], context.lookup):
        display_word = parent_relation["word"]

    blocked_forms = context.blocked_surface_forms_by_base.get(target_key, set())
    if word_key in blocked_forms:
        parent_relation = None
        display_word = word
    elif should_preserve_alias_surface(word_key, target_entry, parent_relation):
        display_word = word
    return ResolvedLinkSource(target_entry, potential_parents, parent_relation, display_word, source_entry)


def resolve_inflection_label(source: ResolvedLinkSource) -> str | None:
    if not source.parent_relation:
        return None
    labels = [
        parent.get("_inflection_label", "")
        for parent in source.potential_parents
        if parent.get("_inflection_label")
    ]
    if len(source.potential_parents) > 1 and labels:
        return ",".join(labels)
    return source.parent_relation.get("_inflection_label") or "复数"


def build_origin_edge(target: str, label: str, primary: bool) -> dict[str, Any]:
    return build_relation_edge(
        relation_type="origin", target=target, label=label,
        direction="outgoing", navigable=True, display="exchange",
        source="derived", primary=primary,
    )


def build_link_origin_relations(
    source: ResolvedLinkSource,
    inflection_label: str | None,
) -> list[dict[str, Any]]:
    if len(source.potential_parents) > 1:
        return [
            build_origin_edge(parent["word"], parent.get("_inflection_label", "原形"), index == 0)
            for index, parent in enumerate(source.potential_parents)
        ]
    if not source.parent_relation:
        return []
    return [build_origin_edge(source.parent_relation["word"], inflection_label or "原形", True)]


def create_link_entry(word: str, source: ResolvedLinkSource) -> dict[str, Any]:
    entry_kind = "inflection" if source.parent_relation else "alias"
    inflection_label = resolve_inflection_label(source)
    source_entry = source.source_entry
    if inflection_label:
        source_entry = filter_entry_pos_and_translation(source_entry, inflection_label)
    linked_entry = {**source_entry, "word": word, "linked_word": source.target_entry["word"]}
    if entry_kind == "inflection":
        linked_entry = copy_without_phrasal_verbs(linked_entry)
    return apply_relation_metadata(
        linked_entry,
        entry_kind=entry_kind,
        display_word=source.display_word,
        relations=build_link_origin_relations(source, inflection_label),
    )


def process_link_entries(context: LinkProcessingContext) -> int:
    """Stage C-3: Process link entries (@ @ @ LINK=) into inflections or aliases."""
    print("Stage C-3: Processing link entries...")
    link_processed = 0
    link_skipped = 0

    for word, target in context.final_target.items():
        word_key = word.lower()
        if word_key in context.finalized_entries:
            continue

        target_key = target.lower()
        target_entry = context.finalized_entries.get(target_key)
        if not target_entry:
            link_skipped += 1
            continue

        source = resolve_link_source(context, word, target_key, target_entry)
        context.finalized_entries[word_key] = create_link_entry(word, source)
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
