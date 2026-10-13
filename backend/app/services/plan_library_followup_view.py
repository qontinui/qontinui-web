"""Response projections for plan-library follow-ups and edges.

Plan ``2026-10-10-small-followups-are-recorded-but-nothing-burns-them-down``
Phase 3. One spelling of each wire shape, shared by the two route modules that
serve follow-ups (``app.api.v1.endpoints.plan_library`` — ``GET /followups``,
``/candidates``, the edge doors — and its sibling
``app.api.v1.endpoints.plan_library_followups``), so the same edge can never
render two ways. A leaf: it imports schemas, models and the follow-up CRUD's
pure state function, and no route module.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal

from app.crud.work_artifact_followups import followup_state
from app.models.work_artifact import (
    WorkArtifact,
    WorkArtifactEdge,
    WorkArtifactEdgeAnchor,
)
from app.schemas.plan_library import WorkArtifactEdgeRead
from app.schemas.plan_library_followups import (
    FollowupAnchor,
    FollowupFacts,
    FollowupHistoryEntry,
    FollowupMatch,
    OpenFollowup,
)


def age_days(anchor: datetime, now: datetime) -> float:
    """Whole-ish days between ``anchor`` and ``now``, three decimals.

    Defends against a naive timestamp even though the columns are
    ``timestamptz``: the arithmetic raises rather than degrading if one side
    ever arrives without a tzinfo.
    """
    if anchor.tzinfo is None:  # pragma: no cover — the column is timestamptz
        anchor = anchor.replace(tzinfo=UTC)
    return round((now - anchor).total_seconds() / 86400.0, 3)


def anchor_read(anchor: WorkArtifactEdgeAnchor) -> FollowupAnchor:
    return FollowupAnchor(
        repo=anchor.repo,
        path=anchor.path,
        line_start=anchor.line_start,
        line_end=anchor.line_end,
        symbol=anchor.symbol,
    )


def _facts_fields(
    edge: WorkArtifactEdge, anchors: Sequence[WorkArtifactEdgeAnchor]
) -> dict[str, object]:
    """The :class:`FollowupFacts` fields of a ``spawned_followup`` edge."""
    return {
        "state": followup_state(edge) or "open",
        "anchors": [anchor_read(a) for a in anchors],
        "size_class": edge.size_class,
        "size_class_source": edge.size_class_source,
        "unanchored_reason": edge.unanchored_reason,
        "resolution": edge.resolution,
        "resolution_pr": edge.resolution_pr,
        "resolution_commit": edge.resolution_commit,
        "resolution_note": edge.resolution_note,
        "resolved_by": edge.resolved_by,
        "resolved_at": edge.resolved_at,
        "resolution_history": [
            FollowupHistoryEntry.model_validate(entry)
            for entry in (edge.resolution_history or [])
        ],
    }


def followup_facts(
    edge: WorkArtifactEdge, anchors: Sequence[WorkArtifactEdgeAnchor]
) -> FollowupFacts | None:
    """The follow-up block of an edge read — ``None`` on any other relation."""
    if followup_state(edge) is None:
        return None
    return FollowupFacts.model_validate(_facts_fields(edge, anchors))


def _queue_fields(
    edge: WorkArtifactEdge,
    origin: WorkArtifact,
    anchors: Sequence[WorkArtifactEdgeAnchor],
    now: datetime,
) -> dict[str, object]:
    return {
        **_facts_fields(edge, anchors),
        "edge_id": edge.id,
        "from_id": origin.id,
        "from_kind": origin.kind,
        "from_slug": origin.slug,
        "from_title": origin.title,
        # Non-blank by construction (``ck_work_artifact_edges_followup_note``);
        # the ``or ""`` only satisfies the type, it is not a real branch.
        "note": edge.note or "",
        "created_by": edge.created_by,
        "created_at": edge.created_at,
        "age_days": age_days(edge.created_at, now),
    }


def open_followup(
    edge: WorkArtifactEdge,
    origin: WorkArtifact,
    anchors: Sequence[WorkArtifactEdgeAnchor],
    now: datetime,
) -> OpenFollowup:
    """Project one ``spawned_followup`` edge onto its queue row."""
    return OpenFollowup.model_validate(_queue_fields(edge, origin, anchors, now))


def followup_match(
    edge: WorkArtifactEdge,
    origin: WorkArtifact,
    anchors: Sequence[WorkArtifactEdgeAnchor],
    *,
    repo: str,
    paths: frozenset[str],
    now: datetime,
) -> FollowupMatch:
    """A queue row plus the anchors the match's ``(repo, paths)`` hit."""
    return FollowupMatch.model_validate(
        {
            **_queue_fields(edge, origin, anchors, now),
            "matched_anchors": [
                anchor_read(a) for a in anchors if a.repo == repo and a.path in paths
            ],
        }
    )


def edge_read(
    edge: WorkArtifactEdge,
    *,
    direction: Literal["outgoing", "incoming"],
    peer: WorkArtifact | None,
    anchors: Sequence[WorkArtifactEdgeAnchor] = (),
) -> WorkArtifactEdgeRead:
    """One edge as an artifact read renders it, follow-up facts included."""
    return WorkArtifactEdgeRead(
        id=edge.id,
        from_id=edge.from_id,
        to_id=edge.to_id,
        relation=edge.relation,
        note=edge.note,
        created_by=edge.created_by,
        created_at=edge.created_at,
        direction=direction,
        peer_kind=peer.kind if peer is not None else None,
        peer_slug=peer.slug if peer is not None else None,
        peer_title=peer.title if peer is not None else None,
        followup=followup_facts(edge, anchors),
    )
