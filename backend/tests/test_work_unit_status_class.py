"""The vendored coord ``status_class`` classifier.

Mirrors qontinui-coord ``work_unit_status_class.rs`` ``classify``: eight
recognized words in three tiers, exact matching, and only emptiness trimmed.
"""

import pytest

from app.services.work_unit_status_class import STATUS_CLASSES, classify


@pytest.mark.parametrize(
    ("status", "expected"),
    [
        ("draft", "free_known"),
        ("in_progress", "free_known"),
        ("blocked", "free_known"),
        ("vetted", "attested"),
        ("superseded", "attested"),
        ("obsolete", "attested"),
        ("ready", "derived"),
        ("shipped", "derived"),
        ("", "unset"),
        ("   ", "unset"),
        (None, "unset"),
        ("done", "off_vocabulary"),
        ("vetted_unattested", "off_vocabulary"),
        # Exact, as coord's own lifecycle SQL is: a case or whitespace
        # variant is invisible to every ``status = 'shipped'`` query.
        ("Shipped", "off_vocabulary"),
        (" shipped ", "off_vocabulary"),
        ("in-progress", "off_vocabulary"),
    ],
)
def test_classify(status: str | None, expected: str) -> None:
    assert classify(status) == expected


def test_the_class_vocabulary_is_coords_five_in_report_order() -> None:
    assert STATUS_CLASSES == (
        "derived",
        "attested",
        "free_known",
        "off_vocabulary",
        "unset",
    )
