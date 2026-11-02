"""Operator label write for the overlord intervention ledger.

Plan ``2026-10-01-overlord-session-supervisor-classifies-stops-and-absorbs-
avoidable-escalations``, Phase 2b (minimal operator label path). The body names
WHAT the operator says about an intervention; WHO said it is never in the body —
coord derives ``label_source`` from the service token + forwarded user.
"""

from enum import StrEnum
from typing import Any, Self
from uuid import UUID

from pydantic import BaseModel, ConfigDict, model_validator


class LabelKind(StrEnum):
    CLASS = "class"  # the operator's correction of the stop class
    FALSE_FINISH = "false_finish"  # the session was marked finished but was not


class OperatorLabel(StrEnum):
    A = "A"  # owed work inside the session's autonomy
    B = "B"  # reserved to the operator by a served clause
    E = "E"  # nothing owed; every owed item landed or watched


class OverlordLabelRequest(BaseModel):
    """``extra='forbid'``: a stray ``label_source`` is a 422, not ignored."""

    model_config = ConfigDict(extra="forbid")

    intervention_id: UUID
    label_kind: LabelKind
    operator_label: OperatorLabel | None = None

    @model_validator(mode="after")
    def _label_matches_kind(self) -> Self:
        if self.label_kind is LabelKind.CLASS and self.operator_label is None:
            raise ValueError("operator_label is required when label_kind is 'class'")
        # A false finish says the session was NOT done, so E (nothing owed)
        # contradicts it; A or B (or no class) is the only coherent answer.
        if (
            self.label_kind is LabelKind.FALSE_FINISH
            and self.operator_label is OperatorLabel.E
        ):
            raise ValueError("operator_label 'E' is not valid for a false_finish label")
        return self

    def coord_fields(self) -> dict[str, Any]:
        """The label fields coord's append takes; ``label_source`` is not one."""
        body: dict[str, Any] = {"label_kind": self.label_kind.value}
        if self.operator_label is not None:
            body["operator_label"] = self.operator_label.value
        return body
