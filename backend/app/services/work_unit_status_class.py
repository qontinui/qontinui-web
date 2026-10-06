"""coord's derived ``status_class`` over ``coord.work_units.status`` — vendored.

A mirror of qontinui-coord ``crates/coord/src/work_unit_status_class.rs``
(``classify``) and the vocabulary it derives from,
``work_unit_registry.rs`` ``WorkUnitStatus::from_wire`` +
``WorkUnitStatus::transition_class``. Web cannot import coord's Rust, so the
eight words and their three tiers are restated here ONCE, and every web caller
that needs a unit's class reads it through :func:`classify` — never through a
second hand-written list.

The five classes, exactly as coord spells them on the wire:

* ``derived`` — ``ready``, ``shipped``: coord computes these from PR citations.
* ``attested`` — ``vetted``, ``superseded``, ``obsolete``: a non-owner judgment.
* ``free_known`` — ``draft``, ``in_progress``, ``blocked``: the Free tier's
  recognized words.
* ``off_vocabulary`` — any other non-empty string. Coord accepts it (its Free
  tier is deliberately open) and every lifecycle query is blind to it.
* ``unset`` — a status that trims to nothing: nobody ever set one.

**Matching is EXACT, deliberately, as it is in coord.** ``Shipped`` and
``" shipped "`` are ``off_vocabulary``, because coord's ``status = $1`` filter
and its lifecycle SQL are byte-exact too — a case or whitespace variant really
is invisible to them, and that invisibility is what the class reports. Only
emptiness is trimmed, so "never set" stays separable from "set to a word coord
does not know".

``tests/test_work_unit_status_class.py`` pins every word to its class.
"""

from __future__ import annotations

from typing import Literal

#: The wire spelling of coord's ``StatusClass`` — exhaustive, five members.
StatusClass = Literal["free_known", "attested", "derived", "off_vocabulary", "unset"]

#: Every class, in coord's ``StatusClass::ALL`` report order.
STATUS_CLASSES: tuple[StatusClass, ...] = (
    "derived",
    "attested",
    "free_known",
    "off_vocabulary",
    "unset",
)

#: coord's eight recognized words → their tier, mirroring
#: ``WorkUnitStatus::transition_class``. A new coord word lands here and in the
#: pinning test together, or the class silently reads ``off_vocabulary``.
_VOCABULARY: dict[str, StatusClass] = {
    "draft": "free_known",
    "in_progress": "free_known",
    "blocked": "free_known",
    "vetted": "attested",
    "superseded": "attested",
    "obsolete": "attested",
    "ready": "derived",
    "shipped": "derived",
}


def classify(status: str | None) -> StatusClass:
    """The class of one stored status string. Total — every input has one.

    ``None`` is ``unset`` (coord's column is ``NOT NULL``, but a list row that
    omitted the field never set it either), as is a whitespace-only string.
    Everything else is an exact-match lookup, falling to ``off_vocabulary``.
    """
    if status is None or not status.strip():
        return "unset"
    return _VOCABULARY.get(status, "off_vocabulary")
