"""Regression guard — the backend must never embed again.

Phase 4 of ``2026-07-13-runner-paid-embedding`` deleted
``app/services/memory_embedder.py`` and the ``fastembed`` dependency. The
backend now computes ZERO embeddings: the request path takes
client-supplied vectors (``app/schemas/memory.py``) and background work
is enqueued on ``coord.memory_jobs`` for a runner to claim, compute
locally and post back. What remains is ``app/services/memory_vectors.py``
— constants and validation only, no model.

This test bans the dead pattern from coming back, in the same "ban the
dead pattern" idiom as ``test_no_celery_import.py``. An import-ban is the
right instrument here precisely BECAUSE it doesn't depend on exercising a
rare code path: a re-introduced embedder would otherwise only reveal
itself when some seldom-hit branch loaded the model in prod (the exact
cost this plan exists to remove), long after CI was green.

Comments and docstrings that MENTION fastembed (explaining why it's gone)
are fine — only real imports fail.
"""

from __future__ import annotations

import ast
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parent.parent / "app"

# fastembed itself plus the heavyweight stacks it exists to avoid — any
# of them under app/ means the backend is loading model weights again.
BANNED_ROOTS = {
    "fastembed",
    "onnxruntime",
    "sentence_transformers",
    "torch",
    "transformers",
}


def _banned(module: str | None) -> bool:
    """True if ``module`` is (or is inside) a banned package."""
    if not module:
        return False
    return module.split(".")[0] in BANNED_ROOTS


def _offending_imports(path: Path) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    hits: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _banned(alias.name):
                    hits.append(f"{path}:{node.lineno}: import {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            # Ignore relative imports (node.level > 0); they can't reach
            # a third-party embedding library.
            if node.level == 0 and _banned(node.module):
                hits.append(f"{path}:{node.lineno}: from {node.module} import ...")
    return hits


def test_no_embedding_model_import_under_app() -> None:
    """No module under app/ may import an embedding model library."""
    offenders: list[str] = []
    for path in APP_ROOT.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        offenders.extend(_offending_imports(path))

    assert not offenders, (
        "Embedding-model imports are banned — the backend computes no "
        "embeddings. Callers supply their own vectors on the request path, "
        "and background embedding is enqueued on coord.memory_jobs for a "
        "runner to execute. Found:\n" + "\n".join(offenders)
    )


def test_memory_embedder_module_is_gone() -> None:
    """The old server-side embedder must not come back."""
    assert not (APP_ROOT / "services" / "memory_embedder.py").exists(), (
        "app/services/memory_embedder.py is back — the backend does not "
        "embed. Vector-space constants live in app/services/memory_vectors.py; "
        "the compute belongs to the runner."
    )


def test_memory_vectors_holds_no_model() -> None:
    """memory_vectors.py is constants + validation, never a model.

    It is the module that inherited the embedder's constants, so it is the
    likeliest place for a model to creep back in.
    """
    from app.services import memory_vectors

    assert memory_vectors.EMBEDDING_DIM == 384
    assert memory_vectors.EMBEDDING_MODEL_TAG in (
        memory_vectors.ACCEPTED_EMBEDDING_MODEL_TAGS
    )
    for banned in ("get_embedder", "TextEmbedding", "embed_texts"):
        assert not hasattr(memory_vectors, banned), (
            f"memory_vectors.{banned} exists — this module must hold no "
            "embedder; the runner computes every vector."
        )


def test_fastembed_is_not_a_declared_dependency() -> None:
    """fastembed must be gone from pyproject, not merely unimported.

    An unimported-but-installed fastembed still costs every deploy its
    onnxruntime install weight — the thing Phase 4 removes.
    """
    pyproject = (APP_ROOT.parent / "pyproject.toml").read_text(encoding="utf-8")
    offending = [
        line
        for line in pyproject.splitlines()
        if line.strip().startswith("fastembed") and "=" in line
    ]
    assert not offending, (
        "fastembed is declared in backend/pyproject.toml again: "
        f"{offending}. The backend embeds nothing; drop the dependency."
    )
