"""Per-component wiring markers: "never ran" is UNKNOWN, never a zero.

Plan ``2026-08-11-coord-ambient-recall-and-efficacy-statistical-rigor``
§3.3 item 5, **narrowed to its residual during vetting**. The whole-run
marker already shipped and is untouched by this module: the CI job's
*"Assert the harness actually ran"* step keys on the presence of the
``MEMORY_RECALL_EVAL_REPORT`` file and, when it is absent, says so in the
comment (*"a skip and a pass are the same colour"*), and
:attr:`~tests.memory_recall.scorer.SuiteScore.case_count` distinguishes an
honest zero from an empty run.

What did not exist is GRANULARITY. One absent report file voided the whole
run, and there was no way to say *"the paired arm was wired but the sealed
arm was not"*. That is what a :class:`WiringLedger` says.

**The invariant that makes this worth having: a marker can never be
mistaken for a measurement.** Two mechanisms, not one convention:

1. Every declared component starts at :data:`NOT_WIRED`. Only the code
   path that actually ran it can promote it, so instrumentation that never
   executed reports "unknown" by construction — nobody has to remember to
   write the negative case.
2. :meth:`WiringLedger.as_report` emits **strings only**. There is no
   number anywhere in the block, so a ``not_wired`` component cannot be
   read, rendered or arithmetic'd as ``0.0``. The pure test suite asserts
   that leaf-type invariant directly.

This is the fleet's ``silent-empty-is-unknown`` discipline
[policy: verification-and-evidence], applied at component granularity: an
absent component is UNKNOWN, not empty.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

#: The instrumentation ran. Any number reported for this component is a
#: measurement.
WIRED = "wired"

#: The instrumentation never ran. **Not a zero, not a null result, not a
#: pass** — nothing was measured, so nothing is known.
NOT_WIRED = "not_wired"

#: The components the memory-recall eval reports on, each independently
#: markable. Three arms, the paired comparison, and the sealed holdout —
#: exactly the granularity §3.3 item 5's residual asks for.
MEMORY_RECALL_COMPONENTS: tuple[str, ...] = (
    "fts_only",
    "hybrid",
    "hybrid_link",
    "paired",
    "sealed_holdout",
)

#: Verbatim in the report so a reader who never opens this file still gets
#: the distinction that makes the marker worth anything.
MARKER_SEMANTICS = (
    "not_wired means the instrumentation never ran for this component: "
    "UNKNOWN, never a measured zero. A wired component's numbers are a "
    "measurement; a not_wired component has no numbers at all."
)


@dataclass(frozen=True)
class ComponentWiring:
    """One component's marker, plus why it reads that way."""

    component: str
    status: str
    detail: str = ""

    @property
    def is_wired(self) -> bool:
        return self.status == WIRED


class WiringLedger:
    """Declare components up front; promote the ones that actually ran.

    The asymmetry is the design. Declaration costs nothing and happens in
    one place; promotion happens only inside the code that did the work.
    A component someone forgets to promote reads ``not_wired`` — the
    honest answer — whereas a ledger that defaulted to ``wired`` would
    report health for instrumentation that never executed, which is the
    exact failure §3.3 item 5 exists to prevent.
    """

    def __init__(self, components: Sequence[str] = MEMORY_RECALL_COMPONENTS) -> None:
        if not components:
            raise ValueError("a wiring ledger with no components marks nothing")
        duplicates = {c for c in components if list(components).count(c) > 1}
        if duplicates:
            raise ValueError(f"duplicate component(s) declared: {sorted(duplicates)}")
        self._entries: dict[str, ComponentWiring] = {
            component: ComponentWiring(component=component, status=NOT_WIRED)
            for component in components
        }

    def mark_wired(self, component: str, detail: str = "") -> None:
        """Promote ``component`` to :data:`WIRED`.

        Raises:
            KeyError: the component was never declared. A typo must not
                quietly create a new component that nothing reads — that
                would leave the real one sitting at ``not_wired`` while
                the report grew a lookalike claiming to be wired.
        """
        if component not in self._entries:
            raise KeyError(
                f"undeclared component {component!r}; declared: {sorted(self._entries)}"
            )
        self._entries[component] = ComponentWiring(
            component=component, status=WIRED, detail=detail
        )

    def status(self, component: str) -> str:
        """The marker for one component. ``KeyError`` if undeclared."""
        return self._entries[component].status

    def is_wired(self, component: str) -> bool:
        return self._entries[component].is_wired

    @property
    def components(self) -> tuple[str, ...]:
        return tuple(self._entries)

    @property
    def wired(self) -> tuple[str, ...]:
        return tuple(c for c, e in self._entries.items() if e.status == WIRED)

    @property
    def not_wired(self) -> tuple[str, ...]:
        return tuple(c for c, e in self._entries.items() if e.status != WIRED)

    def as_report(self) -> dict[str, object]:
        """The report block. **Strings only — no numbers, by construction.**

        Not even a count: the moment this block carries a number, a
        ``not_wired`` component acquires something that renders like a
        measurement, and the distinction the marker exists to draw starts
        eroding. Counts live in the arms' own rows, where they mean
        something.
        """
        return {
            "components": {
                component: {"status": entry.status, "detail": entry.detail}
                for component, entry in self._entries.items()
            },
            "wired": list(self.wired),
            "not_wired": list(self.not_wired),
            "marker_semantics": MARKER_SEMANTICS,
        }
