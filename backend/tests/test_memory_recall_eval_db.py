"""Retrieval-efficacy harness — scores the memory query path against the golden set.

Phase 1 of ``2026-07-29-memory-recall-efficacy-benchmark``. The suffix is
``_db`` because this needs Postgres + pgvector, matching the convention of
``test_memory_api_db.py`` / ``test_memory_lifecycle_db.py``: the suffix is
what tells a reader that a local skip is expected rather than a failure.

**A skip and a pass are the same colour in a check list.** CI's Postgres
image ships pgvector (``.github/workflows/backend-ci.yml``), so this runs
there; when it does not run, the eval reported nothing rather than
reporting health. Read executed case counts, not the badge.

Two arms, per the plan's §2.1a:

``fts_only``
    No ``query_embedding``. This is what live agent recall does today —
    ``coord_memory_search`` supplies no vector, so the endpoint reports
    ``vector_arm: "skipped_no_embedding"`` and serves full-text only.
``hybrid``
    ``query_embedding`` supplied, so RRF actually fuses two arms.

The arm is **asserted from the response**, never assumed: a seeded row at
the wrong ``embedding_model`` flips the whole tenant to
``skipped_migrating`` and the hybrid run would silently degrade to FTS
while still producing a full set of plausible numbers.
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Generator, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import NullPool

from app.api.deps import get_async_db
from app.api.v1.endpoints.memory import MemoryPrincipal, get_memory_tenant, router
from app.services.memory_vectors import EMBEDDING_MODEL_TAG
from tests.conftest import TEST_DATABASE_URL
from tests.memory_recall import fixtures as fx
from tests.memory_recall.scorer import CaseScore, SuiteScore, aggregate, score_case

# The seeded-corpus substrate is REUSED from the API suite rather than
# re-derived: there is no ORM model for coord.memory_records (raw-SQL
# alembic + text() queries), so Base.metadata.create_all does not build it,
# and a second hand-copy of ~170 lines of DDL would drift from the
# migration the moment either changed.
from tests.test_memory_api_db import (  # noqa: E402
    _SETUP_SQL,
    HashingStubEmbedder,
)

# Retrieval depth. Recall@20 is the widest metric the plan names, so every
# query asks for 20 (the endpoint's own cap is 50).
QUERY_LIMIT = 20

#: Where a CI run drops the machine-readable report for the PR comment.
REPORT_PATH_ENV = "MEMORY_RECALL_EVAL_REPORT"


def _exec(engine: AsyncEngine, statements: Sequence[str]) -> None:
    async def _go() -> None:
        async with engine.begin() as conn:
            for stmt in statements:
                await conn.execute(text(stmt))

    asyncio.run(_go())


@pytest.fixture(scope="module")
def eval_engine() -> Generator[AsyncEngine, None, None]:
    """Module-scoped engine over the shared test database.

    Skips — never fails — when Postgres or pgvector is absent, matching
    ``test_memory_api_db.py``'s graceful-degrade posture.
    """
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    try:
        _exec(engine, ["SELECT 1"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"test PostgreSQL unavailable: {exc}")
    try:
        _exec(engine, ["CREATE EXTENSION IF NOT EXISTS vector"])
    except Exception as exc:  # pragma: no cover — infra-dependent
        asyncio.run(engine.dispose())
        pytest.skip(f"pgvector unavailable in test PostgreSQL: {exc}")

    _exec(engine, _SETUP_SQL)
    yield engine
    asyncio.run(engine.dispose())


@pytest.fixture(scope="module")
def golden() -> fx.GoldenSet:
    return fx.load_golden_set()


class EvalClient:
    """TestClient bound to one throwaway tenant, over the module engine."""

    def __init__(self, engine: AsyncEngine) -> None:
        self.tenant_id = uuid4()
        principal = MemoryPrincipal(
            tenant_id=self.tenant_id, device_id=None, actor="device"
        )
        maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def _get_db():
            async with maker() as session:
                yield session
                await session.commit()

        app = FastAPI()
        app.include_router(router, prefix="/api/v1/memory")
        app.dependency_overrides[get_memory_tenant] = lambda: principal
        app.dependency_overrides[get_async_db] = _get_db
        self.client = TestClient(app)

    def query(
        self, query_text: str, query_embedding: list[float] | None
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query_text": query_text, "limit": QUERY_LIMIT}
        if query_embedding is not None:
            body["query_embedding"] = query_embedding
            body["query_embedding_model"] = EMBEDDING_MODEL_TAG
        response = self.client.post("/api/v1/memory/query", json=body)
        assert response.status_code == 200, response.text
        return response.json()


def _vector_for(record: fx.GoldenRecord | None, text_: str) -> list[float]:
    """The committed vector when the fixture has one, else the stub's.

    Deriving from the stub keeps the hybrid arm exercisable without
    committing 384 floats per record; the manifest's provenance tag is
    what stops those numbers being read as semantic quality.
    """
    if record is not None and record.embedding is not None:
        return record.embedding
    return HashingStubEmbedder._vec(text_)


def _seed_corpus(
    engine: AsyncEngine, golden: fx.GoldenSet
) -> tuple[EvalClient, dict[str, str]]:
    """Seed the golden corpus into a fresh tenant; return the id→key map.

    Seeding goes through the real write endpoint rather than raw INSERTs,
    so the corpus under test passes the same validation, dedup and
    redaction the production write path applies. A fixture that could only
    be loaded by bypassing the write path would not be scoring the system
    anyone actually uses.
    """
    client = EvalClient(engine)
    payload = {
        "records": [
            {
                "title": r.title,
                "content": r.content,
                "kind": r.kind,
                "importance": r.importance,
                "embedding": _vector_for(r, r.content),
                "embedding_model": EMBEDDING_MODEL_TAG,
            }
            for r in golden.records
        ]
    }
    response = client.client.post("/api/v1/memory/records", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    written = body["records"]
    assert len(written) == len(golden.records), (
        "seed did not write one row per fixture record — "
        f"{len(written)} rows for {len(golden.records)} records"
    )
    # Content-hash dedup would silently collapse two fixture records with
    # identical content into one row, quietly shrinking the corpus.
    assert body["deduped_count"] == 0, (
        f"{body['deduped_count']} fixture record(s) deduped against each "
        "other — two records share identical content"
    )

    # Positional mapping is sound because the write endpoint emits
    # "per-record responses, in request order"
    # (`app/api/v1/endpoints/memory.py`, step 5). If that guarantee ever
    # changed, every score in this module would be silently wrong rather
    # than failing — so the two assertions above (one row per record, zero
    # dedup) are the tripwires: any reordering that also collapsed or
    # dropped a row trips them first.
    key_by_memory_id = {
        written[i]["memory_id"]: r.key for i, r in enumerate(golden.records)
    }
    assert len(key_by_memory_id) == len(golden.records), (
        "two fixture records mapped to the same memory_id — the write "
        "endpoint no longer returns one distinct row per request record"
    )
    return client, key_by_memory_id


@pytest.fixture(scope="module")
def seeded(
    eval_engine: AsyncEngine, golden: fx.GoldenSet
) -> tuple[EvalClient, dict[str, str]]:
    return _seed_corpus(eval_engine, golden)


@dataclass(frozen=True)
class ArmRun:
    """One arm's full result — aggregate, per-case, and the raw rankings.

    The rankings are retained because the regression-detection check
    (verification item 3) must re-score the SAME returned sets in a
    destroyed order; re-querying would change the set as well as the
    order and prove nothing about ranking quality.
    """

    suite: SuiteScore
    scores: list[CaseScore]
    vector_arm: str
    rankings: dict[str, list[str]]


def _run_arm(
    client: EvalClient,
    key_by_memory_id: dict[str, str],
    golden: fx.GoldenSet,
    *,
    arm: str,
) -> ArmRun:
    """Score every case under one arm."""
    record_by_key = {r.key: r for r in golden.records}
    content_bytes = golden.content_bytes_by_key()
    scores: list[CaseScore] = []
    arms_seen: set[str] = set()
    rankings: dict[str, list[str]] = {}

    for case in golden.cases:
        embedding = None
        if arm == "hybrid":
            embedding = (
                case.query_embedding
                if case.query_embedding is not None
                else HashingStubEmbedder._vec(case.query_text)
            )
        body = client.query(case.query_text, embedding)
        arms_seen.add(body["vector_arm"])
        ranked = fx.resolve_keys(
            [hit["memory_id"] for hit in body["hits"]], key_by_memory_id
        )
        rankings[case.case_id] = ranked
        correction = case.correction
        if correction is not None:
            # Guard against a fixture whose pair references a record that
            # was never seeded — that would score a silent precedence fail.
            assert correction[0] in record_by_key and correction[1] in record_by_key
        scores.append(
            score_case(
                case_id=case.case_id,
                case_class=case.case_class,
                ranked=ranked,
                relevant=case.relevant,
                content_bytes=content_bytes,
                correction=correction,
            )
        )

    assert len(arms_seen) == 1, (
        f"the {arm} arm reported more than one vector_arm across cases: "
        f"{sorted(arms_seen)} — the corpus changed mid-run"
    )
    vector_arm = arms_seen.pop()
    return ArmRun(
        suite=aggregate(arm, vector_arm, scores),
        scores=scores,
        vector_arm=vector_arm,
        rankings=rankings,
    )


@pytest.fixture(scope="module")
def fts_only(seeded, golden) -> ArmRun:
    client, mapping = seeded
    return _run_arm(client, mapping, golden, arm="fts_only")


@pytest.fixture(scope="module")
def hybrid(seeded, golden) -> ArmRun:
    client, mapping = seeded
    return _run_arm(client, mapping, golden, arm="hybrid")


class TestArmIntegrity:
    """The arm must be what the run claims — see plan §2.1a."""

    def test_fts_only_arm_really_skipped_the_vector_half(
        self, fts_only: ArmRun
    ) -> None:
        vector_arm = fts_only.vector_arm
        assert vector_arm == "skipped_no_embedding", (
            "the fts_only arm was supposed to send no vector, but the "
            f"endpoint reported {vector_arm!r}"
        )
        assert fts_only.suite.arm == "fts_only"

    def test_hybrid_arm_really_ran_both_arms(self, hybrid: ArmRun) -> None:
        suite, vector_arm = hybrid.suite, hybrid.vector_arm
        # This is the vacuous-green guard. `skipped_migrating` here means a
        # seeded row sits at a different embedding_model tag and the cosine
        # arm never ran — the numbers would be FTS numbers wearing a hybrid
        # label, silently overwriting the baseline they exist to protect.
        assert vector_arm == "hybrid", (
            "the hybrid arm did not run: endpoint reported "
            f"{vector_arm!r}. 'skipped_migrating' means the seeded corpus "
            "is not entirely at EMBEDDING_MODEL_TAG; 'skipped_no_embedding' "
            "means no query vector was sent."
        )
        assert suite.arm == "hybrid"

    def test_every_case_was_actually_scored(
        self, fts_only: ArmRun, golden: fx.GoldenSet
    ) -> None:
        assert fts_only.suite.case_count == len(golden.cases)
        assert len(fts_only.scores) == len(golden.cases)
        assert fts_only.suite.case_count > 0

    def test_a_mismatched_model_tag_degrades_the_arm_and_is_caught(
        self, eval_engine: AsyncEngine, golden: fx.GoldenSet
    ) -> None:
        """Verification item 7 — the self-skip must be detected, not absorbed.

        Seeds a private tenant, then rewrites one row's ``embedding_model``
        so the tenant is mid-migration. The endpoint must report
        ``skipped_migrating``, which is exactly what
        :meth:`test_hybrid_arm_really_ran_both_arms` asserts against — so
        this proves that assertion can actually fire rather than being
        decorative.
        """
        client = EvalClient(eval_engine)
        sample = golden.records[:3]
        response = client.client.post(
            "/api/v1/memory/records",
            json={
                "records": [
                    {
                        "title": r.title,
                        "content": f"{r.content} [arm-degradation probe]",
                        "kind": r.kind,
                        "embedding": _vector_for(r, r.content),
                        "embedding_model": EMBEDDING_MODEL_TAG,
                    }
                    for r in sample
                ]
            },
        )
        assert response.status_code == 200, response.text

        async def _retag() -> None:
            async with eval_engine.begin() as conn:
                await conn.execute(
                    text(
                        "UPDATE coord.memory_records "
                        "SET embedding_model = 'some-older-space' "
                        "WHERE tenant_id = :tid"
                    ),
                    {"tid": client.tenant_id},
                )

        asyncio.run(_retag())

        body = client.query(
            golden.cases[0].query_text,
            HashingStubEmbedder._vec(golden.cases[0].query_text),
        )
        assert body["vector_arm"] == "skipped_migrating"


class TestHarnessDetectsRegressions:
    """Verification item 3 — the harness must be able to see a broken ranking.

    An eval that scores a destroyed ranking the same as a working one
    cannot detect a regression, which makes every baseline it records
    worthless. The pure-logic half lives in ``test_memory_recall_scorer.py``;
    this is the end-to-end half, over rankings the real system produced.

    **The control shuffles ORDER ONLY**, holding each case's returned set
    exactly as retrieved. An earlier draft used a control that returned the
    whole corpus and it beat real retrieval on recall — correctly, because
    returning everything maximises recall by construction. That is a
    different (and far more expensive) strategy, not a degraded ranking;
    comparing against it measures nothing about ranking quality. The cost
    of that strategy is what noise rate and token cost exist to price, and
    :meth:`test_returning_everything_is_priced_not_rewarded` asserts they
    do.
    """

    @staticmethod
    def _rescore(run: ArmRun, golden: fx.GoldenSet, transform) -> SuiteScore:
        content_bytes = golden.content_bytes_by_key()
        return aggregate(
            f"{run.suite.arm}-control",
            run.vector_arm,
            [
                score_case(
                    case_id=c.case_id,
                    case_class=c.case_class,
                    ranked=transform(run.rankings[c.case_id]),
                    relevant=c.relevant,
                    content_bytes=content_bytes,
                    correction=c.correction,
                )
                for c in golden.cases
            ],
        )

    def test_reversing_the_returned_order_degrades_the_ranking(
        self, hybrid: ArmRun, golden: fx.GoldenSet
    ) -> None:
        """Same records, worst-first. Order-sensitive metrics must drop.

        Run against the hybrid arm because it is the one with retrieval
        depth to destroy — the FTS-only arm returns so little that there is
        almost no order to shuffle (which is itself the headline finding,
        asserted in :class:`TestFtsOnlyBaselineIsSparse`).
        """
        reversed_scores = self._rescore(hybrid, golden, lambda r: r[::-1])
        assert hybrid.suite.mrr > reversed_scores.mrr, (
            "reversing the ranking did not lower MRR — the harness cannot "
            "detect an ordering regression"
        )
        assert hybrid.suite.ndcg_at_10 > reversed_scores.ndcg_at_10

    def test_recall_at_k_is_unchanged_by_reordering(
        self, hybrid: ArmRun, golden: fx.GoldenSet
    ) -> None:
        """The control's sanity check: recall@20 is set-based, not order-based.

        If reversing changed recall@20 the transform would be dropping
        records rather than reordering them, and the comparison above would
        be measuring the wrong thing.
        """
        reversed_scores = self._rescore(hybrid, golden, lambda r: r[::-1])
        assert reversed_scores.recall_at_20 == pytest.approx(hybrid.suite.recall_at_20)

    def test_returning_everything_is_priced_not_rewarded(
        self, fts_only: ArmRun, hybrid: ArmRun
    ) -> None:
        """Recall bought with an unbounded budget must show up as cost.

        The wide arm wins recall; the metrics that keep that honest are
        noise rate and token cost. If neither moved, the harness would
        recommend "return everything" as a free win.
        """
        assert hybrid.suite.recall_at_10 > fts_only.suite.recall_at_10
        assert hybrid.suite.noise_rate_at_10 > fts_only.suite.noise_rate_at_10
        assert (
            hybrid.suite.total_token_cost_at_10 > fts_only.suite.total_token_cost_at_10
        )


class TestFtsOnlyBaselineIsSparse:
    """Pin the headline finding so a silent improvement is also detected.

    The FTS-only arm — what live agent recall does today — returns almost
    nothing for question-shaped queries, because ``websearch_to_tsquery``
    ANDs the terms and a natural-language question shares few exact lexemes
    with any record. The tell is ``recall@5 == recall@20``: widening the
    window adds nothing because there was nothing below the cut.

    This is an ASSERTION ABOUT TODAY, deliberately. If the semantic-recall
    work lands and this starts failing, that failure is the good news and
    the baseline in the plan needs re-recording — which is exactly the
    signal a benchmark exists to produce.
    """

    def test_widening_k_adds_almost_nothing(self, fts_only: ArmRun) -> None:
        assert fts_only.suite.recall_at_20 == pytest.approx(
            fts_only.suite.recall_at_5, abs=0.05
        ), (
            "FTS-only recall now improves with a wider window — the "
            "sparsity finding this baseline recorded has changed. "
            "Re-record the baseline in the plan's §3 Phase 2."
        )

    def test_the_hardest_classes_are_where_it_fails(self, fts_only: ArmRun) -> None:
        """Vocabulary mismatch and recency conflict are the classes FTS cannot serve."""
        hard = [
            s
            for s in fts_only.scores
            if s.case_class in {"vocabulary_mismatch", "recency_conflict"}
        ]
        assert hard, "the golden set lost its hard-class cases"
        assert all(s.recall_at_10 == 0.0 for s in hard), (
            "FTS-only now retrieves a vocabulary-mismatch or recency-conflict "
            "case — re-record the baseline."
        )


class TestDeterminism:
    """Verification item 2 — same fixture + same code → identical scores.

    Both arms, and across a RE-SEED rather than just a re-query. The
    re-seed is the part that matters: it gives every record a fresh
    ``memory_id`` and a fresh physical row order, which is exactly what
    a different machine (or a different CI run) would produce.

    Re-querying the same rows twice passes even when retrieval is
    genuinely nondeterministic, because the physical order happens to be
    stable within one table. An earlier version of this test did only
    that, and it passed while the hybrid arm's MRR moved ~4% between
    processes — the cosine ORDER BY had no unique tiebreaker, so tied
    rows came back in arbitrary order. ``vector_search`` /``fts_search``
    now close their ordering on ``memory_id``; this test is what holds
    that fix in place.
    """

    def test_requerying_reproduces_both_arms(self, seeded, golden) -> None:
        client, mapping = seeded
        for arm in ("fts_only", "hybrid"):
            first = _run_arm(client, mapping, golden, arm=arm)
            second = _run_arm(client, mapping, golden, arm=arm)
            assert first.suite == second.suite, f"{arm} not stable across re-query"
            assert first.rankings == second.rankings

    def test_reseeding_into_a_fresh_tenant_reproduces_both_arms(
        self, eval_engine: AsyncEngine, seeded, golden: fx.GoldenSet
    ) -> None:
        original_client, original_mapping = seeded
        fresh_client, fresh_mapping = _seed_corpus(eval_engine, golden)

        for arm in ("fts_only", "hybrid"):
            original = _run_arm(original_client, original_mapping, golden, arm=arm)
            fresh = _run_arm(fresh_client, fresh_mapping, golden, arm=arm)
            # Compare by fixture KEY, not memory_id — the ids differ by
            # construction; the ranking of the underlying records must not.
            assert original.rankings == fresh.rankings, (
                f"the {arm} arm ranked the same corpus differently after a "
                "re-seed — retrieval is not reproducible, so no baseline "
                "recorded from it can be regressed against"
            )
            assert original.suite == fresh.suite


class TestCorrectionPrecedence:
    """The plan's highest-value assertion, end to end."""

    def test_correction_pairs_are_actually_exercised(
        self, fts_only: ArmRun, golden: fx.GoldenSet
    ) -> None:
        expected = sum(1 for c in golden.cases if c.correction is not None)
        assert expected > 0, "the golden set has no correction pairs to score"
        assert fts_only.suite.correction_pairs == expected

    def test_a_failing_pair_is_visible_per_case(self, fts_only: ArmRun) -> None:
        pairs = [s for s in fts_only.scores if s.correction_precedence is not None]
        assert pairs
        # Every pair resolves to a real True/False — never None, which
        # would mean the pair was silently dropped from scoring.
        assert all(isinstance(s.correction_precedence, bool) for s in pairs)


class TestBaselineReport:
    """Emit the numbers. This is the phase's actual deliverable."""

    @staticmethod
    def _suite_rows(suite: SuiteScore) -> dict[str, Any]:
        return {
            "arm": suite.arm,
            "vector_arm": suite.vector_arm,
            "cases": suite.case_count,
            "recall_at_5": round(suite.recall_at_5, 4),
            "recall_at_10": round(suite.recall_at_10, 4),
            "recall_at_20": round(suite.recall_at_20, 4),
            "mrr": round(suite.mrr, 4),
            "ndcg_at_10": round(suite.ndcg_at_10, 4),
            "noise_rate_at_10": round(suite.noise_rate_at_10, 4),
            "total_token_cost_at_10": suite.total_token_cost_at_10,
            "correction_pairs": suite.correction_pairs,
            "correction_precedence_passes": suite.correction_precedence_passes,
            "correction_precedence_rate": round(suite.correction_precedence_rate, 4),
        }

    @staticmethod
    def _by_class(scores: Sequence[CaseScore]) -> dict[str, dict[str, float]]:
        """Per-class means — an aggregate can hide a collapsed bucket."""
        out: dict[str, dict[str, float]] = {}
        for case_class in sorted({s.case_class for s in scores}):
            bucket = [s for s in scores if s.case_class == case_class]
            out[case_class] = {
                "cases": len(bucket),
                "recall_at_10": round(
                    sum(s.recall_at_10 for s in bucket) / len(bucket), 4
                ),
                "mrr": round(sum(s.reciprocal_rank for s in bucket) / len(bucket), 4),
            }
        return out

    def test_emit_baseline(
        self, fts_only: ArmRun, hybrid: ArmRun, golden: fx.GoldenSet
    ) -> None:
        fts_suite, fts_scores = fts_only.suite, fts_only.scores
        hybrid_suite, hybrid_scores = hybrid.suite, hybrid.scores

        report = {
            "plan": "2026-07-29-memory-recall-efficacy-benchmark",
            "embedding_source": golden.embedding_source,
            # The single most important field for a reader: under a stub
            # provenance the hybrid arm's numbers describe fusion
            # mechanics, NOT semantic retrieval quality.
            "semantic_quality_measurable": golden.has_real_vectors,
            "records": len(golden.records),
            "arms": [
                self._suite_rows(fts_suite),
                self._suite_rows(hybrid_suite),
            ],
            "by_class": {
                "fts_only": self._by_class(fts_scores),
                "hybrid": self._by_class(hybrid_scores),
            },
        }

        rendered = json.dumps(report, indent=2, sort_keys=True)
        print("\n=== MEMORY RECALL EVAL ===\n" + rendered)

        destination = os.environ.get(REPORT_PATH_ENV)
        if destination:
            Path(destination).write_text(rendered, encoding="utf-8")

        # Structural assertions only — this test REPORTS, it does not gate.
        # Thresholding a ~24-case subjective set would be exactly the flaky
        # quality gate the plan's §4 rejects.
        assert report["arms"][0]["cases"] > 0
        assert report["arms"][1]["cases"] > 0
