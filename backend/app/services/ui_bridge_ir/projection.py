"""Python port of `projectIRToBundledPage`.

Mirrors `qontinui-schemas/ts/src/ui-bridge-ir/projection.ts` and the Rust
port at `qontinui-runner/src-tauri/src/spec_api/projection.rs`. Same
intent: pure function from an IR document (+ optional notes) to the
legacy `*.spec.uibridge.json` shape.

Byte-stable output rule: object keys sorted lexicographically at the
final step, arrays preserve input order, no timestamps or random IDs.

Mapping rules (full reference lives in the TS source); summary:

    IRDocument                                    LegacySpec
    ----------                                    ----------
    doc.id                                  ->    metadata.component (fallback)
    doc.metadata.purpose                    ->    metadata.component (preferred)
    doc.description ?? doc.name             ->    description
    doc.metadata.tags                       ->    metadata.tags

    For each IRState -> one entry in groups[]:
        state.id                            ->    group.id
        state.name                          ->    group.name
        state.description ??
          state.metadata.description ?? "" ->    group.description
        "element-presence"                  ->    group.category
        state.provenance.source ??
          "ai-generated"                    ->    group.source
        For each requiredElement (or one
          placeholder if empty):
            "${state.id}-elem-${index}"     ->    assertion.id
            ...                                   assertion.{category,severity,assertionType,...}

    Each IRState                            ->    one entry in stateMachine.states[]
        state.requiredElements              ->    sm-state.elements (converted)
        state.isInitial ??
          (state.id == doc.initialState)   ->    sm-state.isInitial
        outgoing transitions               ->    sm-state.transitions

    Element-criteria conversion:
        text          -> textContent
        ariaLabel     -> accessibleName  (when no explicit accessibleName)
        attributes    -> dataAttributes
        (others — role, textContains, id, tagName — pass through)
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _sort_keys(value: Any) -> Any:
    """Recursively sort object keys lexicographically.

    Arrays preserve input order. Mirrors the TS `sortKeys` pass.
    """
    if isinstance(value, dict):
        return {k: _sort_keys(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [_sort_keys(item) for item in value]
    return value


def _convert_criteria(criteria: dict[str, Any] | None) -> dict[str, Any]:
    """Convert IR element criteria to legacy criteria.

    Renames text -> textContent, attributes -> dataAttributes, and folds
    ariaLabel into accessibleName when no explicit accessibleName is
    present. Other fields pass through unchanged.
    """
    if criteria is None:
        return {}
    out: dict[str, Any] = {}
    if "role" in criteria:
        out["role"] = criteria["role"]
    if "tagName" in criteria:
        out["tagName"] = criteria["tagName"]
    if "text" in criteria:
        out["textContent"] = criteria["text"]
    if "textContains" in criteria:
        out["textContains"] = criteria["textContains"]
    # Prefer explicit accessibleName; fall back to ariaLabel.
    if "accessibleName" in criteria:
        out["accessibleName"] = criteria["accessibleName"]
    elif "ariaLabel" in criteria:
        out["accessibleName"] = criteria["ariaLabel"]
    if "id" in criteria:
        out["id"] = criteria["id"]
    if "attributes" in criteria:
        out["dataAttributes"] = criteria["attributes"]
    return out


def _build_assertion(
    state: dict[str, Any],
    index: int,
    criteria: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build a single legacy assertion. Mirrors TS `buildAssertion`."""
    metadata = state.get("metadata") or {}
    description = metadata.get("description") or (
        f"Required element {index} for state {state['name']}"
    )
    target_criteria = (
        _convert_criteria(criteria) if criteria is not None else {}
    )
    assertion: dict[str, Any] = {
        "id": f"{state['id']}-elem-{index}",
        "description": description,
        "category": "element-presence",
        "severity": "critical",
        "assertionType": "exists",
        "target": {
            "type": "search",
            "criteria": target_criteria,
            "label": f"Required element for {state['name']}",
        },
        "source": "ai-generated",
        "reviewed": False,
        "enabled": True,
    }
    precondition = state.get("precondition")
    if precondition is not None:
        assertion["precondition"] = precondition
    return assertion


def _build_group(state: dict[str, Any]) -> dict[str, Any]:
    """Build the legacy `groups[]` entry for one IR state."""
    elements = state.get("requiredElements") or []
    if not elements:
        assertions = [_build_assertion(state, 0, None)]
    else:
        assertions = [
            _build_assertion(state, i, c) for i, c in enumerate(elements)
        ]
    metadata = state.get("metadata") or {}
    description = (
        state.get("description") or metadata.get("description") or ""
    )
    provenance = state.get("provenance") or {}
    source = provenance.get("source") or "ai-generated"
    return {
        "id": state["id"],
        "name": state["name"],
        "description": description,
        "category": "element-presence",
        "assertions": assertions,
        "source": source,
    }


def _build_process_step(action: dict[str, Any]) -> dict[str, Any]:
    """Convert an IR transition action into a legacy process step.

    Renames IR's `type` to legacy `action`.
    """
    out: dict[str, Any] = {
        "action": action["type"],
        "target": _convert_criteria(action.get("target")),
    }
    wait_after = action.get("waitAfter")
    if wait_after is not None:
        out["waitAfter"] = wait_after
    return out


def _build_transition(transition: dict[str, Any]) -> dict[str, Any]:
    """Convert one IR transition into the legacy state-machine shape."""
    exit_states = transition.get("exitStates") or []
    return {
        "id": transition["id"],
        "name": transition["name"],
        "activateStates": list(transition.get("activateStates") or []),
        "deactivateStates": list(exit_states),
        # Modal-style transitions (no exit states) stay visible behind
        # the activated state.
        "staysVisible": len(exit_states) == 0,
        "process": [
            _build_process_step(a) for a in (transition.get("actions") or [])
        ],
    }


def _build_state_machine_state(
    state: dict[str, Any],
    transitions: list[dict[str, Any]],
    doc: dict[str, Any],
) -> dict[str, Any]:
    """Build one entry in `stateMachine.states[]`."""
    outgoing = [
        _build_transition(t)
        for t in transitions
        if state["id"] in (t.get("fromStates") or [])
    ]
    if "isInitial" in state:
        is_initial = bool(state["isInitial"])
    else:
        is_initial = state["id"] == doc.get("initialState")
    return {
        "id": state["id"],
        "name": state["name"],
        "description": state.get("description") or "",
        "elements": [
            _convert_criteria(c) for c in (state.get("requiredElements") or [])
        ],
        "isInitial": is_initial,
        "transitions": outgoing,
    }


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def project_ir_to_bundled_page(
    doc: dict[str, Any],
    notes: str | None = None,
) -> dict[str, Any]:
    """Project an IR document into the legacy bundled-page spec shape.

    Pure / deterministic: same input always produces structurally
    identical output. Object keys are sorted lexicographically as the
    final step. Arrays preserve input order.

    Args:
        doc: The IR document (parsed JSON, e.g. from
            ``state-machine.derived.json``). Must include ``id``,
            ``name``, ``states``, ``transitions``.
        notes: Optional human-authored notes (carried in the page's
            ``notes.md`` companion file). When non-empty, appended to
            ``description`` separated by two newlines.

    Returns:
        The legacy spec as a ``dict`` ready for JSON serialization with
        ``sort_keys=True`` (or any byte-stable serializer — keys are
        already sorted in this dict).
    """
    base_description = doc.get("description") or doc.get("name", "")
    if notes is not None and notes != "":
        description = f"{base_description}\n\n{notes}"
    else:
        description = base_description

    metadata_in = doc.get("metadata") or {}
    component = metadata_in.get("purpose") or doc["id"]

    legacy_metadata: dict[str, Any] = {"component": component}
    tags = metadata_in.get("tags")
    if tags is not None:
        legacy_metadata["tags"] = list(tags)

    states = doc.get("states") or []
    transitions = doc.get("transitions") or []

    groups = [_build_group(s) for s in states]
    sm_states = [
        _build_state_machine_state(s, transitions, doc) for s in states
    ]

    spec = {
        "version": "1.0.0",
        "description": description,
        "groups": groups,
        "stateMachine": {"states": sm_states},
        "metadata": legacy_metadata,
    }

    # Lex-sort all object keys for byte-stable output.
    sorted_spec: dict[str, Any] = _sort_keys(spec)
    return sorted_spec


def project_to_pretty_json(
    doc: dict[str, Any],
    notes: str | None = None,
) -> str:
    """Project + serialize to pretty JSON with 2-space indent.

    Matches the Node CLI's output exactly so the Python, TypeScript, and
    Rust paths can be byte-diffed. Trailing newline included.
    """
    import json

    value = project_ir_to_bundled_page(doc, notes)
    # The dict is already key-sorted, but pass sort_keys=True for safety
    # in case a caller hand-builds a partially sorted dict.
    return json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
