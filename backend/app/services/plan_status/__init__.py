"""The three-way plan-status classifier, **VENDORED** — D7.

SOURCE OF TRUTH
---------------
``qontinui-dev-notes`` ``scripts/plan_status_classifier.py`` and
``scripts/plan-status-vectors.json``. Both files in this package are COPIES of
those, and :mod:`app.services.plan_status.classifier` is kept **byte-identical**
to its source (it is excluded from ``ruff format`` in ``pyproject.toml`` for
exactly that reason — vendored code is not ours to restyle, and a cosmetic
reformat would make a cross-repo ``diff`` unreadable).

WHY A COPY AND NOT A SHARED FILE
--------------------------------
D7 of plan ``2026-09-03-plan-status-three-way-reconciler-surface``:
qontinui-dev-notes and qontinui-web are separate repos with no package
dependency, and no qontinui-dev-notes workflow checks out a sibling repo. The
vectors therefore **cannot** literally be shared. Pretending otherwise is the
failure mode; making the copy **detectable** is the fix.

So both repos pin the vector file's ``content_sha256`` and each suite asserts
the file it holds hashes to it. A divergence reds both suites on the next run.
:data:`VENDORED_VECTORS_SHA256` is this repo's half of that pin;
``tests/test_plan_library_reconciliation.py`` asserts it, asserts that the
classifier's own :data:`~app.services.plan_status.classifier.VECTORS_SHA256`
agrees with it, and replays every vector through the vendored
:func:`~app.services.plan_status.classifier.classify`.

:data:`VENDORED_CLASSIFIER_SHA256` extends the same idea one file further. D7
only requires the vectors pin, but the classifier is the other half of the
shared spec and an edit to it on either side is exactly as invisible as an edit
to the vectors would have been. The pin costs one constant and one assertion.

WHAT THIS PACKAGE DOES NOT DO
-----------------------------
It performs no I/O of its own (``classify()`` is pure) and it does **not**
decide where the axes come from. On the qontinui-dev-notes side axis B is the
plan document on ``origin/main`` of the plans repo; here it is
``agent.work_artifacts``, which is a materially weaker source (sparse, and
silently freezable). The route that calls this says so in every response
(``document_axis_source``) rather than leaving the difference implicit — see
``app/api/v1/endpoints/plan_library.py``.
"""

import hashlib

from app.services.plan_status.classifier import (
    ADAPTER_NINE_PHRASES,
    AGREE_CLASSES,
    AXIS_A_KEYS,
    AXIS_B_KEYS,
    AXIS_C_KEYS,
    CLASS_ORDER,
    CLASSES,
    DISAGREE_CLASSES,
    UNKNOWN_CLASSES,
    VECTORS_FILENAME,
    VECTORS_SHA256,
    AxisShapeError,
    adapter_tokenizes,
    axis_a,
    axis_b,
    axis_c,
    classify,
    doc_is_terminal,
    load_vectors,
    normalize_status_word,
    unit_is_shipped_class,
    unit_is_terminal,
    vectors_digest,
    vectors_path,
)

#: sha256 of ``plan-status-vectors.json`` as authored in qontinui-dev-notes.
#:
#: Spelled HERE as well as inside the vendored module on purpose. The module's
#: own ``VECTORS_SHA256`` travels WITH the copy, so a wholesale re-vendor of a
#: drifted pair would update both the file and its pin and assert nothing. This
#: constant is qontinui-web's independent record of the digest it agreed to,
#: and the test asserts all three agree: this constant, the module's, and the
#: bytes on disk.
VENDORED_VECTORS_SHA256 = (
    "3566c5790df0a0cc659e1ce150a8a5ee64ac00ca031bdb9f8c5488a3b59aec9d"
)

#: sha256 of ``classifier.py`` as authored in qontinui-dev-notes
#: (``scripts/plan_status_classifier.py``), byte for byte.
#:
#: Beyond D7's letter, in D7's spirit: the cascade ORDER is as much of the
#: shared spec as the vectors are, and the vectors alone cannot detect a
#: reworded reason or a re-ordered arm that still satisfies them.
VENDORED_CLASSIFIER_SHA256 = (
    "31c6171e7ccd0ba4ff40c8625f04f43ac7382e7dcb77979eb0fe4993700adf0a"
)


def _digest(path: str) -> str:
    """sha256 of a file's bytes, exactly as it sits on disk."""
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def classifier_path() -> str:
    """Absolute path to the vendored classifier module's source file."""
    return __file__.replace("__init__.py", "classifier.py")


def classifier_digest() -> str:
    """sha256 of the vendored classifier's bytes."""
    return _digest(classifier_path())


__all__ = [
    "ADAPTER_NINE_PHRASES",
    "AGREE_CLASSES",
    "AXIS_A_KEYS",
    "AXIS_B_KEYS",
    "AXIS_C_KEYS",
    "CLASSES",
    "CLASS_ORDER",
    "DISAGREE_CLASSES",
    "UNKNOWN_CLASSES",
    "VECTORS_FILENAME",
    "VECTORS_SHA256",
    "VENDORED_CLASSIFIER_SHA256",
    "VENDORED_VECTORS_SHA256",
    "AxisShapeError",
    "adapter_tokenizes",
    "axis_a",
    "axis_b",
    "axis_c",
    "classifier_digest",
    "classifier_path",
    "classify",
    "doc_is_terminal",
    "load_vectors",
    "normalize_status_word",
    "unit_is_shipped_class",
    "unit_is_terminal",
    "vectors_digest",
    "vectors_path",
]
