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
``hybrid_link``
    ``hybrid`` plus ``link_expansion``, so the one-hop ``coord.memory_links``
    arm is fused in as a third. Added by plan
    ``2026-08-08-memory-graph-has-no-writer``: the link arm shipped
    default-off pending a measurement this harness could not make, because it
    had no link arm and the corpus had no edges.

The arm is **asserted from the response**, never assumed: a seeded row at
the wrong ``embedding_model`` flips the whole tenant to
``skipped_migrating`` and the hybrid run would silently degrade to FTS
while still producing a full set of plausible numbers. ``link_arm`` gets the
same treatment for the same reason — an expansion that never ran and an
expansion that found nothing produce identical scores, and only the response
discriminator tells them apart.
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
from app.services.memory_store import ARM_LIMIT as _ARM_LIMIT
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
    _content_sha256,
)

# Retrieval depth. Recall@20 is the widest metric the plan names, so every
# query asks for 20 (the endpoint's own cap is 50).
QUERY_LIMIT = 20

#: Corpus:cutoff ratio at or above which link-ONLY hits have actually been
#: OBSERVED, so demanding them is fair. From PR #975's sweep over this fixture:
#: ratio 6.0 (``arm_limit=5``, 30 records) → 45 link-only hits across 22/24
#: cases; ratio 3.0 (``arm_limit=10``) → 73 hits across 23/24. Ratio 1.8 (90
#: records at stock cutoff 50) → ZERO. The crossover lies between 1.8 and 3.0
#: and has never been narrowed further, so 3.0 is the lowest ratio at which a
#: demand is backed by measurement.
LINK_ONLY_MEASURED_RATIO = 3.0

#: Ratio at or below which zero link-only hits is the MEASURED expectation
#: (90/50 = 1.8 produced none). Between this and the constant above the outcome
#: is genuinely unmeasured, and both the assertion and the emitted report say so
#: rather than guessing.
LINK_ONLY_IMPOSSIBLE_RATIO = 1.8

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
        self,
        query_text: str,
        query_embedding: list[float] | None,
        *,
        link_expansion: bool = False,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"query_text": query_text, "limit": QUERY_LIMIT}
        if query_embedding is not None:
            body["query_embedding"] = query_embedding
            body["query_embedding_model"] = EMBEDDING_MODEL_TAG
        if link_expansion:
            body["link_expansion"] = True
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
    # Edges are declared by fixture KEY and sent as the target's
    # content_hash. One pass is enough because the write endpoint inserts
    # every record BEFORE resolving any ref ("sibling records written above
    # are visible", `endpoints/memory.py` step 7), so an edge may point at a
    # record later in the same batch and the positional key<->memory_id
    # mapping below stays intact.
    content_by_key = {r.key: r.content for r in golden.records}
    payload = {
        "records": [
            {
                "title": r.title,
                "content": r.content,
                "kind": r.kind,
                "importance": r.importance,
                "embedding": _vector_for(r, r.content),
                "embedding_model": EMBEDDING_MODEL_TAG,
                **(
                    {
                        "links": [
                            {
                                "target_ref": _content_sha256(
                                    content_by_key[link.target_key]
                                ),
                                "relation": link.relation,
                            }
                            for link in r.links
                        ]
                    }
                    if r.links
                    else {}
                ),
            }
            for r in golden.records
        ]
    }
    response = client.client.post("/api/v1/memory/records", json=payload)
    assert response.status_code == 200, response.text
    body = response.json()
    written = body["records"]
    # The tripwire. The write path DROPS unresolved refs and only counts
    # them, so a hash that no longer matches stored content (a redaction
    # sweep, a normalization) would silently produce an edgeless corpus —
    # and an edgeless corpus scores as "expansion doesn't help", a confident
    # number with nothing behind it. Fail here instead.
    assert body["dropped_links_count"] == 0, (
        f"{body['dropped_links_count']} of {golden.link_count} fixture edge(s) "
        "failed to resolve at seed time — the corpus would be silently "
        "edgeless and every link-arm score meaningless. The target_ref is the "
        "sha256 of the target's STORED content; if the write path now "
        "transforms content before hashing, this is where that shows up."
    )
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
    link_arm: str
    #: case_id -> keys the expansion arm ranked (``link_rank`` set), whether
    #: or not another arm also found them. Non-empty proves the edges landed
    #: and the one-hop query matched real neighbours.
    link_ranked: dict[str, list[str]]
    #: case_id -> keys whose ONLY provenance was the link arm (``link_rank``
    #: set, both other ranks null) — the hits nothing else could have found.
    #: Structurally impossible while the corpus is no larger than
    #: ``ARM_LIMIT``; see :class:`TestLinkArmIntegrity`.
    link_only: dict[str, list[str]]


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
    link_arms_seen: set[str] = set()
    rankings: dict[str, list[str]] = {}
    link_ranked: dict[str, list[str]] = {}
    link_only: dict[str, list[str]] = {}

    for case in golden.cases:
        embedding = None
        if arm in ("hybrid", "hybrid_link"):
            embedding = (
                case.query_embedding
                if case.query_embedding is not None
                else HashingStubEmbedder._vec(case.query_text)
            )
        body = client.query(
            case.query_text, embedding, link_expansion=arm == "hybrid_link"
        )
        arms_seen.add(body["vector_arm"])
        link_arms_seen.add(body["link_arm"])
        ranked = fx.resolve_keys(
            [hit["memory_id"] for hit in body["hits"]], key_by_memory_id
        )
        rankings[case.case_id] = ranked
        expanded_hits = [
            hit
            for hit in body["hits"]
            if hit.get("link_rank") is not None and hit["memory_id"] in key_by_memory_id
        ]
        if expanded_hits:
            link_ranked[case.case_id] = [
                key_by_memory_id[hit["memory_id"]] for hit in expanded_hits
            ]
        reached_by_edge = [
            key_by_memory_id[hit["memory_id"]]
            for hit in expanded_hits
            if hit.get("vector_rank") is None and hit.get("fts_rank") is None
        ]
        if reached_by_edge:
            link_only[case.case_id] = reached_by_edge
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
    assert len(link_arms_seen) == 1, (
        f"the {arm} arm reported more than one link_arm across cases: "
        f"{sorted(link_arms_seen)} — some cases expanded and others did not, "
        "so the run's scores mix two different retrieval strategies"
    )
    vector_arm = arms_seen.pop()
    return ArmRun(
        suite=aggregate(arm, vector_arm, scores),
        scores=scores,
        vector_arm=vector_arm,
        rankings=rankings,
        link_arm=link_arms_seen.pop(),
        link_ranked=link_ranked,
        link_only=link_only,
    )


@pytest.fixture(scope="module")
def fts_only(seeded, golden) -> ArmRun:
    client, mapping = seeded
    return _run_arm(client, mapping, golden, arm="fts_only")


@pytest.fixture(scope="module")
def hybrid(seeded, golden) -> ArmRun:
    client, mapping = seeded
    return _run_arm(client, mapping, golden, arm="hybrid")


@pytest.fixture(scope="module")
def hybrid_link(seeded, golden) -> ArmRun:
    client, mapping = seeded
    return _run_arm(client, mapping, golden, arm="hybrid_link")


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


class TestLinkArmIntegrity:
    """The link arm must have RUN, and must have had something to run over.

    Plan ``2026-08-08-memory-graph-has-no-writer``. Every assertion here
    exists because the link arm's failure mode is silence: an expansion that
    never fired, an expansion over an empty edge table, and an expansion that
    genuinely found nothing all produce byte-identical scores. Without these,
    a "link expansion changes nothing" verdict could not be distinguished
    from "link expansion never happened" — and the first would be reported as
    if it were a measurement.
    """

    def test_the_fixture_actually_declares_edges(self, golden: fx.GoldenSet) -> None:
        assert golden.link_count > 0, (
            "the golden corpus declares no links, so the hybrid_link arm has "
            "nothing to expand over and its scores cannot say anything about "
            "link expansion"
        )

    def test_baseline_arms_do_not_consult_the_graph(
        self, fts_only: ArmRun, hybrid: ArmRun
    ) -> None:
        """The comparison is only meaningful if the baselines really abstain."""
        assert fts_only.link_arm == "skipped_disabled"
        assert hybrid.link_arm == "skipped_disabled"
        assert not fts_only.link_only
        assert not hybrid.link_only

    def test_the_link_arm_really_expanded(self, hybrid_link: ArmRun) -> None:
        assert hybrid_link.link_arm == "expanded", (
            "the link arm did not run: endpoint reported "
            f"{hybrid_link.link_arm!r}. 'skipped_disabled' means the request "
            "did not carry link_expansion; 'skipped_no_seeds' means the "
            "vector+FTS fuse returned nothing to expand from."
        )
        assert hybrid_link.vector_arm == "hybrid"

    def test_an_edgeless_corpus_scores_identically_with_the_arm_on(
        self, eval_engine: AsyncEngine, golden: fx.GoldenSet
    ) -> None:
        """The apparatus control: no edges ⇒ no effect, exactly.

        Every other number in this module is a DIFFERENCE between the two- and
        three-arm runs, so the whole comparison rests on the third arm being
        inert when the graph is empty. If it were not — if merely asking for
        expansion perturbed ranking — every reported delta would be measuring
        the request flag rather than the edges.

        Measured 2026-08-08: identical to 4 decimal places on MRR, nDCG@10 and
        recall@5, while the same corpus WITH 9 edges moved MRR from 0.8306 to
        0.2918. That contrast is what makes the degradation attributable to
        the graph.
        """
        edgeless = fx.GoldenSet(
            embedding_source=golden.embedding_source,
            records=tuple(
                fx.GoldenRecord(
                    key=r.key,
                    title=r.title,
                    content=r.content,
                    kind=r.kind,
                    importance=r.importance,
                    embedding=r.embedding,
                    links=(),
                )
                for r in golden.records
            ),
            cases=golden.cases,
        )
        client, mapping = _seed_corpus(eval_engine, edgeless)
        baseline = _run_arm(client, mapping, edgeless, arm="hybrid")
        expanded = _run_arm(client, mapping, edgeless, arm="hybrid_link")

        assert expanded.link_arm == "expanded"
        assert not expanded.link_ranked
        assert expanded.rankings == baseline.rankings, (
            "asking for link expansion changed the ranking on a corpus with "
            "no edges at all — the third arm is not inert when the graph is "
            "empty, so every hybrid vs hybrid_link delta this module reports "
            "is confounded"
        )

    def test_enabling_the_arm_does_not_degrade_ranking(
        self, hybrid: ArmRun, hybrid_link: ArmRun
    ) -> None:
        """The regression this arm actually shipped with, now guarded.

        With the link arm fused at an EQUAL vote, enabling it cost MRR
        0.8306 -> 0.2918 and nDCG@10 0.8412 -> 0.4402 on this corpus, while
        recall@20 stayed at 1.0 — so no recall-based check could have caught
        it. `ARM_WEIGHTS` damps the arm to 0.1, which brings both back to
        within fixture noise of the arm-off baseline.

        The tolerance is 0.01 absolute, which is ~7x the residual difference
        at the shipped weight (~0.0015) and ~50x smaller than the regression
        it must catch (~0.54). Wide enough not to encode a 50-case fixture's
        exact digits; nowhere near wide enough to absorb a real collapse.
        """
        tolerance = 0.01
        assert hybrid_link.suite.mrr >= hybrid.suite.mrr - tolerance, (
            f"link expansion dropped MRR from {hybrid.suite.mrr:.4f} to "
            f"{hybrid_link.suite.mrr:.4f}. Check ARM_WEIGHTS['link'] in "
            "endpoints/memory.py — at an equal vote this lands near 0.29."
        )
        assert hybrid_link.suite.ndcg_at_10 >= hybrid.suite.ndcg_at_10 - tolerance, (
            f"link expansion dropped nDCG@10 from {hybrid.suite.ndcg_at_10:.4f} "
            f"to {hybrid_link.suite.ndcg_at_10:.4f}"
        )
        # Recall is deliberately checked too, but it is NOT the guard: it was
        # 1.0 either way through the whole regression.
        assert hybrid_link.suite.recall_at_10 >= hybrid.suite.recall_at_10 - tolerance

    def test_the_expansion_matched_real_neighbours(
        self, hybrid_link: ArmRun, golden: fx.GoldenSet
    ) -> None:
        """Non-vacuity, at the strongest bar this corpus can support.

        ``link_arm == "expanded"`` only says the query was ISSUED — it is
        equally true over an empty edge table. This says the expansion
        actually matched seeded edges and their neighbours reached the
        response, which is what would silently be false if the seed's
        ``target_ref`` hashes stopped resolving.
        """
        assert hybrid_link.link_ranked, (
            f"the link arm ran and the fixture declares {golden.link_count} "
            "edge(s), but no returned hit carried a link_rank — the expansion "
            "matched nothing, so the arm's scores describe an empty graph"
        )

    def test_link_only_hits_track_the_corpus_cutoff_ratio(
        self, hybrid_link: ArmRun, golden: fx.GoldenSet
    ) -> None:
        """A link-ONLY hit needs corpus DENSITY, not corpus SIZE.

        A link-only hit requires the semantic arm to have EXCLUDED the record
        the edge reaches. That arm returns its top ``ARM_LIMIT`` (50), so what
        decides exclusion is the corpus:cutoff RATIO — how many records are
        more similar to the query than the link target is.

        **This assertion used to branch on ``len(records) > ARM_LIMIT`` and
        demand hits above it. That premise was disproved three days after it
        was written** (PR #975, plan ``2026-08-08-memory-graph-has-no-writer``
        §4c): 60 added distractors took the corpus to 90 — past the cutoff —
        and still produced ZERO link-only hits, because distractors rank BELOW
        topically-relevant records, so the top-50 merely becomes "every
        original plus some filler". Pushing a target at median rank 17 past 50
        needs ~33 records *more similar to that query* than the target. That is
        density, and it cannot be hand-authored without writing the answer key.

        Growing the golden set to its 50-case floor (plan
        ``2026-08-04-memory-golden-set-grow-to-target``) took the corpus to 64
        records — past ``ARM_LIMIT``, ratio 1.28 — and reproduced exactly that:
        zero link-only hits. Under the old branch that was a RED backend CI on
        a fixture change that did nothing wrong.

        So the bands below are keyed to what has actually been measured, and
        the middle band asserts nothing rather than guessing. The arm's real
        measurement lives in
        :class:`TestLinkArmUnderAProductionLikeCutoff`, which shrinks the
        cutoff to reach a production-like ratio instead of inflating the corpus.
        """
        ARM_LIMIT = _ARM_LIMIT
        observed = sum(len(v) for v in hybrid_link.link_only.values())
        ratio = len(golden.records) / ARM_LIMIT

        if ratio <= LINK_ONLY_IMPOSSIBLE_RATIO:
            assert observed == 0, (
                f"a link-only hit appeared at corpus:cutoff ratio {ratio:.2f} "
                f"({len(golden.records)} records, ARM_LIMIT={ARM_LIMIT}). At "
                "this ratio the semantic arm still returns every link target "
                "(measured at 30/50 and 90/50), so every hit must carry a "
                "vector_rank. Either ARM_LIMIT changed or the per-arm ranks "
                "are being reported wrongly."
            )
            # Deliberately NOT xfail/skip: this is a real, passing assertion
            # about a real invariant. Marking it xfail would make the module's
            # own warning come true — "a skip and a pass are the same colour in
            # a check list" — and would hide the limitation instead of
            # recording it. The limitation travels in the emitted report as
            # `link_only_measurable: false`, where the human reading the
            # numbers will see it.
            return

        if ratio < LINK_ONLY_MEASURED_RATIO:
            # 1.8 < ratio < 3.0 — no measurement exists in this band. Asserting
            # either direction here would be a guess dressed as a contract.
            return

        assert observed > 0, (
            f"corpus:cutoff ratio is {ratio:.2f} ({len(golden.records)} "
            f"records, ARM_LIMIT={ARM_LIMIT}), at or above the ratio where "
            "link-only hits have been measured (#975: 73 hits across 23/24 "
            "cases at ratio 3.0) — but none occurred. The seeded edges point "
            "only at records the other arms already return, so the comparison "
            "still measures nothing."
        )

    # NOT asserted here: "link expansion never removes an id the two-arm fuse
    # returned." It sounds like a correctness invariant and is not one. The
    # response is capped at `limit`, so a third arm that merely RE-RANKS will
    # push tail entries past the cut — measured on this corpus, the expanded
    # run displaced two baseline tail hits while contributing no link-only
    # hit at all. The genuine superset property lives one level down, in
    # `rrf_fuse` (every distinct id across all arms survives fusion), where
    # it is observable and already unit-tested in `test_memory_rrf.py`.
    # Asserting it end-to-end would only encode the retrieval depth.


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
        self,
        fts_only: ArmRun,
        hybrid: ArmRun,
        hybrid_link: ArmRun,
        golden: fx.GoldenSet,
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
            "links": golden.link_count,
            # The link arm's counterpart to semantic_quality_measurable: a
            # delta between `hybrid` and `hybrid_link` is interpretable only
            # if the graph actually contributed hits no other arm found.
            # Zero here means the comparison measured nothing, however
            # clean the numbers below look.
            "link_ranked_hits": sum(len(v) for v in hybrid_link.link_ranked.values()),
            "link_only_hits": sum(len(v) for v in hybrid_link.link_only.values()),
            "link_only_cases": sorted(hybrid_link.link_only),
            # Why link_only_hits is 0 and the hybrid/hybrid_link delta is ~0:
            # a link-ONLY hit needs the semantic arm to have EXCLUDED the link
            # target, and that depends on the corpus:cutoff RATIO, not on the
            # corpus merely exceeding the cutoff. Without this field a reader
            # would take the null delta as evidence that link expansion does
            # not help, when it is evidence that this corpus cannot test it.
            #
            # This field read `len(records) > ARM_LIMIT` until 2026-08-14. That
            # is the premise PR #975 disproved (90 records > 50 produced zero
            # link-only hits), so at 64 records it began reporting
            # `measurable: true` over a run that measured nothing — the exact
            # misreading the field exists to prevent. It is now the same
            # ratio-banded judgement the assertion uses, and it reports what
            # was OBSERVED rather than what the arithmetic permits.
            "link_only_measurable": (
                len(golden.records) / _ARM_LIMIT >= LINK_ONLY_MEASURED_RATIO
            ),
            "link_only_corpus_cutoff_ratio": round(len(golden.records) / _ARM_LIMIT, 3),
            "arm_limit": _ARM_LIMIT,
            "arms": [
                self._suite_rows(fts_suite),
                self._suite_rows(hybrid_suite),
                self._suite_rows(hybrid_link.suite),
            ],
            "by_class": {
                "fts_only": self._by_class(fts_scores),
                "hybrid": self._by_class(hybrid_scores),
                "hybrid_link": self._by_class(hybrid_link.scores),
            },
        }

        rendered = json.dumps(report, indent=2, sort_keys=True)
        print("\n=== MEMORY RECALL EVAL ===\n" + rendered)

        destination = os.environ.get(REPORT_PATH_ENV)
        if destination:
            Path(destination).write_text(rendered, encoding="utf-8")

        # Structural assertions only — this test REPORTS, it does not gate.
        # Thresholding a ~50-case subjective set would be exactly the flaky
        # quality gate the plan's §4 rejects.
        assert report["arms"][0]["cases"] > 0
        assert report["arms"][1]["cases"] > 0
        assert report["arms"][2]["cases"] > 0


class TestLinkArmUnderAProductionLikeCutoff:
    """The arm's distinctive contribution, measured by shrinking the cutoff.

    Plan ``2026-08-08-memory-graph-has-no-writer`` §4c. A link-ONLY hit needs
    the semantic arm to have EXCLUDED the record, and that arm returns its top
    ``ARM_LIMIT`` (50). At this fixture's corpus:cutoff ratio the arm still
    returns every link target, so no hit can be link-only at stock settings
    (asserted in :class:`TestLinkArmIntegrity`).

    The obvious fix — grow the corpus past 50 — was tried and **does not
    work**: 60 added distractors moved link targets' vector ranks only from
    median 17 to 20, and produced zero link-only hits. Growing the golden set
    to 64 records for its own reasons (plan
    ``2026-08-04-memory-golden-set-grow-to-target``) reproduced the same zero. Distractors rank BELOW
    topically-relevant records, so the top-50 just becomes "every original plus
    some filler". What would push a target out is ~33 records *more similar to
    that query* than the target — corpus DENSITY, which cannot be hand-authored
    without effectively writing the answer key.

    So shrink the cutoff instead. ``arm_limit=5`` over this corpus reproduces the
    structural situation of ``arm_limit=50`` over 300: it is the corpus:cutoff
    RATIO that decides whether the graph can reach past the semantic arm. This
    needs no production change — the limit is a keyword argument on the store
    functions.
    """

    @staticmethod
    def _capped(cap: int):
        """Patch both primary arms to a smaller per-arm cutoff."""
        import functools

        from app.services import memory_store as store

        def wrap(fn):
            @functools.wraps(fn)
            async def inner(*args, **kwargs):
                kwargs["arm_limit"] = cap
                return await fn(*args, **kwargs)

            return inner

        return wrap(store.vector_search), wrap(store.fts_search)

    def test_a_smaller_cutoff_lets_the_graph_reach_past_the_semantic_arm(
        self, seeded, golden: fx.GoldenSet, monkeypatch
    ) -> None:
        """At a production-like ratio, link-ONLY hits appear. At stock, none do.

        Both halves matter. The second is what stops this being a test that
        merely proves the patch works: at the stock cutoff the same fixture and
        the same edges must still yield nothing, which is the §4b invariant.
        """
        from app.api.v1.endpoints import memory as endpoint

        client, mapping = seeded

        def link_only_count() -> int:
            total = 0
            for case in golden.cases:
                body = client.query(
                    case.query_text, case.query_embedding, link_expansion=True
                )
                total += sum(
                    1
                    for hit in body["hits"]
                    if hit.get("link_rank") is not None
                    and hit.get("vector_rank") is None
                    and hit.get("fts_rank") is None
                )
            return total

        assert link_only_count() == 0, "stock cutoff should expose no link-only hit"

        vector_search, fts_search = self._capped(10)
        monkeypatch.setattr(endpoint.store, "vector_search", vector_search)
        monkeypatch.setattr(endpoint.store, "fts_search", fts_search)
        assert link_only_count() > 0, (
            "with the cutoff shrunk to a production-like ratio the graph still "
            "reached nothing the semantic arm had excluded — the arm cannot "
            "contribute a record on its own, which is its entire premise"
        )

    def test_the_live_no_vector_path_gains_recall_without_adding_noise(
        self, seeded, golden: fx.GoldenSet
    ) -> None:
        """The configuration live agents actually run, and the arm's best case.

        ``coord_memory_search`` sends no query vector, so real recall is the
        FTS-only arm. Measured 2026-08-12: recall@10 0.0417 -> 0.0625 (+50%
        relative) with noise@10 unchanged at 0.0 — the arm's strongest result,
        and the only configuration where it buys recall for free.

        Asserted as DIRECTIONS, not as those digits: pinning a score to a
        50-case subjective fixture would be the flaky quality gate the
        benchmark plan's §4 rejects. What must hold is that the arm does not
        LOSE recall here and does not pay for it in noise.
        """
        content_bytes = golden.content_bytes_by_key()
        client, mapping = seeded

        def run(link_expansion: bool) -> SuiteScore:
            scores = [
                score_case(
                    case_id=case.case_id,
                    case_class=case.case_class,
                    ranked=fx.resolve_keys(
                        [
                            hit["memory_id"]
                            for hit in client.query(
                                case.query_text, None, link_expansion=link_expansion
                            )["hits"]
                        ],
                        mapping,
                    ),
                    relevant=case.relevant,
                    content_bytes=content_bytes,
                    correction=case.correction,
                )
                for case in golden.cases
            ]
            return aggregate("fts_only", "skipped_no_embedding", scores)

        baseline, expanded = run(False), run(True)

        assert expanded.recall_at_10 >= baseline.recall_at_10
        assert expanded.noise_rate_at_10 <= baseline.noise_rate_at_10 + 1e-9, (
            "link expansion added noise on the no-vector path, where it "
            "previously bought recall for free"
        )
