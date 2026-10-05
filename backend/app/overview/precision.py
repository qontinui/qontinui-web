"""Numeric bounds belong to the contract, not to the form.

Every decimal an overview resource stores lands in a ``NUMERIC(p, s)`` column.
A value with more integer digits than ``p - s`` does not fit, and without a
bound in the schema a direct API caller finds that out as a database
``numeric_field_overflow`` — a 500 — rather than as a validation error naming
the field. Plan ``2026-09-20-overview-authoring-layer`` ("Verification") asks
for the bound to live in the shared schema; :func:`numeric` is that bound.

Two rules, both matching what Postgres itself does with the value:

* **Extra decimal places are rounded, half away from zero** — ``NUMERIC``
  rounds rather than refusing, and a CSV paste of ``1.333`` person-days has
  always stored ``1.33``. Refusing it now would break imports that worked.
* **Integer overflow is refused**, measured AFTER rounding, because rounding
  can carry a value over the limit (``99999999.995`` at ``NUMERIC(10, 2)``).

The bound is also published in the field's JSON Schema — ``exclusiveMaximum``
/ ``exclusiveMinimum`` plus ``x-numeric: {precision, scale}`` — which is what
the frontend editing kit validates against, so the form and the API cannot
disagree. ``tests/test_overview_authoring.py`` asserts that every decimal
field in an overview write schema carries one, and that it matches its
column.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any, get_args

from annotated_types import GroupedMetadata
from pydantic import AfterValidator, Field


@dataclass(frozen=True)
class NumericSpec(GroupedMetadata):
    """``NUMERIC(precision, scale)`` as field metadata.

    Used as ``Annotated[Decimal, numeric(10, 2, ge=0)]``. It is pydantic
    GROUPED metadata: pydantic expands it into the bound (``Field``) and the
    rounding validator. The spec itself stays in the field's annotation, which
    is where :func:`numeric_spec_of` finds it to compare with the column the
    value is stored in. Being an ordinary object inside ``Annotated`` is what
    lets a type checker accept the alias.
    """

    precision: int
    scale: int
    #: Extra ``Field`` constraints (``ge``/``gt``/``le``), as sorted pairs so
    #: the metadata stays hashable.
    constraints: tuple[tuple[str, Any], ...] = ()

    @property
    def limit(self) -> Decimal:
        """The first magnitude that no longer fits."""
        return Decimal(10) ** (self.precision - self.scale)

    def __iter__(self) -> Iterator[Any]:
        field = dict(self.constraints)
        field.setdefault("lt", self.limit)
        if "ge" not in field and "gt" not in field:
            field["gt"] = -self.limit
        yield Field(
            json_schema_extra={
                "x-numeric": {"precision": self.precision, "scale": self.scale}
            },
            **field,
        )
        yield AfterValidator(_fit(self))


def _fit(spec: NumericSpec) -> Callable[[Decimal], Decimal]:
    quantum = Decimal(1).scaleb(-spec.scale)
    lower = {k: Decimal(str(v)) for k, v in spec.constraints if k in ("gt", "ge")}
    too_big = (
        f"must be less than {spec.limit} in size "
        f"(stored with {spec.scale} decimal places)"
    )

    def validate(value: Decimal) -> Decimal:
        if not value.is_finite():
            raise ValueError("must be a finite number")
        try:
            rounded = value.quantize(quantum, rounding=ROUND_HALF_UP)
        except InvalidOperation as exc:  # more digits than decimal can quantize
            raise ValueError(too_big) from exc
        if abs(rounded) >= spec.limit:
            raise ValueError(too_big)
        # The lower bounds are re-checked AFTER rounding, like the limit: a
        # value that passed `gt=0` can round to 0 (0.004 at two places) and
        # would then fail the column's CHECK as a database error, not a 422.
        if "gt" in lower and not rounded > lower["gt"]:
            raise ValueError(
                f"must be more than {lower['gt']} once rounded to "
                f"{spec.scale} decimal places"
            )
        if "ge" in lower and not rounded >= lower["ge"]:
            raise ValueError(f"must be at least {lower['ge']}")
        return rounded

    return validate


def numeric(precision: int, scale: int, **constraints: Any) -> NumericSpec:
    """The metadata bounding a ``Decimal`` to ``NUMERIC(precision, scale)``.

    ``Annotated[Decimal, numeric(10, 2, ge=0)]``; extra ``Field`` constraints
    (``ge=0``, ``gt=0``, ``le=1``…) pass through.
    """
    return NumericSpec(precision, scale, tuple(sorted(constraints.items())))


def numeric_spec_of(field_info: Any) -> NumericSpec | None:
    """The :class:`NumericSpec` a pydantic field carries, if any.

    Looks in the field's own metadata (a required field) and inside its
    annotation (``X | None``, where the spec rides the union member rather
    than the field).
    """
    for item in getattr(field_info, "metadata", ()):
        if isinstance(item, NumericSpec):
            return item
    return _spec_in_annotation(getattr(field_info, "annotation", None))


def _spec_in_annotation(annotation: Any) -> NumericSpec | None:
    for item in getattr(annotation, "__metadata__", ()):
        if isinstance(item, NumericSpec):
            return item
    for arg in get_args(annotation):
        found = _spec_in_annotation(arg)
        if found is not None:
            return found
    return None
