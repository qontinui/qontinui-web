"""Operator-editable model family per plan difficulty.

Plan ``2026-10-08-operator-editable-model-family-per-plan-difficulty``. Pins:

* the closed vocabularies — the model's CHECK sources, the request schema's
  ``Literal``, the display copy and ``DifficultyLevel`` — agree;
* ``GET /plan-library/model-routing`` serves the defaults until an operator
  writes, with per-level provenance;
* ``PUT`` records the FULL map for the caller's personal organization only,
  refuses the shared NULL bucket (409) and any malformed map (422);
* after a write, ``GET /plan-library``, ``/candidates`` and ``/difficulty``
  serve the STORED map, byte-identically, with ``model_tiers`` derived from it;
* one organization's map never reaches another's reads.

The device-JWT refusal of the PUT is in ``test_plan_library_device_auth.py``
beside the kind PATCH's, which it mirrors.
"""

from __future__ import annotations

import json
from typing import get_args
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plan_model_route import MODEL_FAMILIES, ROUTE_LEVELS
from app.schemas.plan_library import ModelFamily
from app.services.plan_difficulty import (
    DEFAULT_MODEL_SELECTORS,
    MODEL_FAMILY_DISPLAY,
    MODEL_SELECTOR_VOCABULARY,
    DifficultyLevel,
    model_tiers_for,
)
from tests.test_plan_library_device_auth import (
    _build_app,
    _make_personal_org,
    _make_user,
)

API_PREFIX = "/api/v1/plan-library"
ROUTING = f"{API_PREFIX}/model-routing"
_ENVELOPE_KEYS = ("model_tiers", "model_selectors", "model_selector_vocabulary")


# ─────────────────────────── vocabularies ───────────────────────────


class TestVocabulariesAgree:
    def test_levels_are_the_difficulty_levels(self) -> None:
        assert set(ROUTE_LEVELS) == set(get_args(DifficultyLevel))
        assert set(DEFAULT_MODEL_SELECTORS) == set(ROUTE_LEVELS)

    def test_families_are_one_set_everywhere(self) -> None:
        assert set(MODEL_FAMILIES) == set(get_args(ModelFamily))
        assert set(MODEL_FAMILIES) == set(MODEL_FAMILY_DISPLAY)
        assert set(DEFAULT_MODEL_SELECTORS.values()) <= set(MODEL_FAMILIES)

    def test_the_vocabulary_is_the_agent_tools(self) -> None:
        # The skills reject any other vocabulary name (vet-imp-sweep
        # "Model routing", run-level check 3).
        assert MODEL_SELECTOR_VOCABULARY == "claude_code_agent_tool_v1"


# ───────────────────────────── fixtures ─────────────────────────────


async def _client_for(db: AsyncSession, user):
    app = _build_app(db_session=db, cognito_user=user)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest_asyncio.fixture()
async def operator(async_db_session: AsyncSession):
    """A Cognito operator WITH a personal organization."""
    user = await _make_user(async_db_session, "routing_op")
    await _make_personal_org(async_db_session, user)
    async with await _client_for(async_db_session, user) as client:
        yield client


@pytest_asyncio.fixture()
async def bucketless(async_db_session: AsyncSession):
    """A Cognito user with NO personal organization — the NULL bucket."""
    user = await _make_user(async_db_session, "routing_nobucket")
    async with await _client_for(async_db_session, user) as client:
        yield client


async def _envelopes(client: httpx.AsyncClient) -> dict[str, dict]:
    responses = {
        "list": await client.get(API_PREFIX, params={"kind": "plan", "limit": 1}),
        "candidates": await client.get(
            f"{API_PREFIX}/candidates",
            params={"include_coord": "false", "limit": 1},
        ),
        "difficulty": await client.get(f"{API_PREFIX}/difficulty"),
    }
    out: dict[str, dict] = {}
    for route, response in responses.items():
        assert response.status_code == 200, (route, response.text)
        out[route] = response.json()
    return out


def _assert_served(envelopes: dict[str, dict], selectors: dict[str, str]) -> None:
    blocks = set()
    for route, payload in envelopes.items():
        assert payload["model_selectors"] == selectors, route
        assert payload["model_tiers"] == model_tiers_for(selectors), route
        assert payload["model_selector_vocabulary"] == MODEL_SELECTOR_VOCABULARY
        blocks.add(json.dumps({k: payload[k] for k in _ENVELOPE_KEYS}))
    assert len(blocks) == 1, blocks


# ─────────────────────────────── reads ───────────────────────────────


@pytest.mark.asyncio
class TestDefaults:
    async def test_no_row_serves_the_defaults_everywhere(
        self, operator: httpx.AsyncClient
    ) -> None:
        response = await operator.get(ROUTING)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["model_selectors"] == DEFAULT_MODEL_SELECTORS
        assert payload["default_selectors"] == DEFAULT_MODEL_SELECTORS
        assert payload["sources"] == dict.fromkeys(ROUTE_LEVELS, "default")
        assert payload["updated_at"] is None
        assert payload["can_edit"] is True
        assert [f["family"] for f in payload["families"]] == list(MODEL_FAMILY_DISPLAY)
        _assert_served(await _envelopes(operator), DEFAULT_MODEL_SELECTORS)

    async def test_the_null_bucket_reads_defaults_and_cannot_write(
        self, bucketless: httpx.AsyncClient
    ) -> None:
        response = await bucketless.get(ROUTING)
        assert response.status_code == 200, response.text
        assert response.json()["can_edit"] is False
        assert response.json()["model_selectors"] == DEFAULT_MODEL_SELECTORS

        put = await bucketless.put(
            ROUTING, json={"high": "opus", "medium": "opus", "low": "sonnet"}
        )
        assert put.status_code == 409, put.text
        assert put.json()["detail"]["error"] == "no_organization_scope"
        _assert_served(await _envelopes(bucketless), DEFAULT_MODEL_SELECTORS)


# ─────────────────────────────── writes ───────────────────────────────


@pytest.mark.asyncio
class TestWrite:
    async def test_a_save_is_served_on_all_three_routes(
        self, operator: httpx.AsyncClient
    ) -> None:
        # The operator's actual intent: hard AND medium plans on Opus.
        wanted = {"high": "opus", "medium": "opus", "low": "sonnet"}
        put = await operator.put(ROUTING, json=wanted)
        assert put.status_code == 200, put.text
        payload = put.json()
        assert payload["model_selectors"] == wanted
        assert payload["model_tiers"] == {
            "high": "Opus (latest)",
            "medium": "Opus (latest)",
            "low": "Sonnet (latest)",
        }
        assert payload["sources"] == dict.fromkeys(ROUTE_LEVELS, "stored")
        assert payload["updated_at"] is not None
        assert payload["updated_by_user_id"] is not None

        reread = (await operator.get(ROUTING)).json()
        assert reread["model_selectors"] == wanted
        assert reread["sources"] == dict.fromkeys(ROUTE_LEVELS, "stored")
        _assert_served(await _envelopes(operator), wanted)

    async def test_a_second_save_replaces_the_first(
        self, operator: httpx.AsyncClient
    ) -> None:
        first = {"high": "opus", "medium": "opus", "low": "sonnet"}
        second = {"high": "fable", "medium": "sonnet", "low": "haiku"}
        assert (await operator.put(ROUTING, json=first)).status_code == 200
        # Read in between so the session holds the first rows — the save must
        # still be what the next read returns.
        assert (await operator.get(ROUTING)).json()["model_selectors"] == first
        put = await operator.put(ROUTING, json=second)
        assert put.status_code == 200, put.text
        assert put.json()["model_selectors"] == second
        _assert_served(await _envelopes(operator), second)

    @pytest.mark.parametrize(
        "body",
        [
            {"high": "opus", "medium": "opus"},  # a level missing
            {"high": "opus", "medium": "opus", "low": "gpt"},  # not a family
            {"high": "Opus", "medium": "opus", "low": "sonnet"},  # not exact
            {"high": "opus 5.5", "medium": "opus", "low": "sonnet"},  # a version
            {"high": "opus", "medium": "opus", "low": "sonnet", "extra": "opus"},
        ],
    )
    async def test_a_malformed_map_is_refused_and_writes_nothing(
        self, operator: httpx.AsyncClient, body: dict
    ) -> None:
        put = await operator.put(ROUTING, json=body)
        assert put.status_code == 422, put.text
        assert (await operator.get(ROUTING)).json()["sources"] == dict.fromkeys(
            ROUTE_LEVELS, "default"
        )

    async def test_one_organizations_map_never_reaches_another(
        self, async_db_session: AsyncSession, operator: httpx.AsyncClient
    ) -> None:
        wanted = {"high": "haiku", "medium": "haiku", "low": "haiku"}
        assert (await operator.put(ROUTING, json=wanted)).status_code == 200

        other = await _make_user(async_db_session, "routing_other")
        await _make_personal_org(async_db_session, other)
        async with await _client_for(async_db_session, other) as other_client:
            payload = (await other_client.get(ROUTING)).json()
            assert payload["model_selectors"] == DEFAULT_MODEL_SELECTORS
            _assert_served(await _envelopes(other_client), DEFAULT_MODEL_SELECTORS)


@pytest.mark.asyncio
class TestReset:
    async def test_reset_returns_every_level_to_the_followed_default(
        self, operator: httpx.AsyncClient
    ) -> None:
        # Saving a copy of the defaults is NOT a reset: it pins them as stored.
        assert (await operator.put(ROUTING, json=DEFAULT_MODEL_SELECTORS)).json()[
            "sources"
        ] == dict.fromkeys(ROUTE_LEVELS, "stored")

        reset = await operator.delete(ROUTING)
        assert reset.status_code == 200, reset.text
        assert reset.json()["sources"] == dict.fromkeys(ROUTE_LEVELS, "default")
        assert reset.json()["updated_at"] is None
        _assert_served(await _envelopes(operator), DEFAULT_MODEL_SELECTORS)
        # Idempotent.
        assert (await operator.delete(ROUTING)).status_code == 200

    async def test_the_null_bucket_cannot_reset(
        self, bucketless: httpx.AsyncClient
    ) -> None:
        assert (await bucketless.delete(ROUTING)).status_code == 409


# ─────────────────────────── read failures ───────────────────────────


@pytest.mark.asyncio
class TestReadFailure:
    async def test_an_absent_table_serves_the_defaults(
        self, async_db_session: AsyncSession
    ) -> None:
        """``deploy-web`` can serve before ``migrate`` has created the table;
        the three plan-library reads must stay up, and with no table there is
        no stored row, so the defaults are exactly right."""
        from sqlalchemy import text

        from app.services.plan_model_routing import load_model_routing

        savepoint = await async_db_session.begin_nested()
        try:
            await async_db_session.execute(
                text(
                    "ALTER TABLE agent.plan_difficulty_model_routes "
                    "RENAME TO plan_difficulty_model_routes_hidden"
                )
            )
            routing = await load_model_routing(async_db_session, uuid4())
            assert routing.selectors == DEFAULT_MODEL_SELECTORS
            assert set(routing.sources.values()) == {"default"}
            # The caller's transaction survived the failed statement.
            assert (await async_db_session.execute(text("SELECT 1"))).scalar_one() == 1
        finally:
            await savepoint.rollback()

    async def test_any_other_read_failure_raises_rather_than_defaulting(
        self, async_db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sqlalchemy.exc import ProgrammingError

        from app.services.plan_model_routing import load_model_routing

        class _Orig(Exception):
            sqlstate = "42501"  # insufficient_privilege

        async def _boom(*_args: object, **_kwargs: object) -> None:
            raise ProgrammingError("SELECT …", {}, _Orig())

        monkeypatch.setattr(async_db_session, "execute", _boom)
        with pytest.raises(ProgrammingError):
            await load_model_routing(async_db_session, uuid4())
