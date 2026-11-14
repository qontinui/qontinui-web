"""Phase 0b: the ``/machines/{id}/ci-node`` pair accepts a coord device JWT.

Plan ``2026-09-27-ci-node-shadow-dispatch-never-passes-checkout-race-lost-leases-unfiltered-selection``
Phase 0b. An agent must enable, probe and DISABLE a CI node through the same
door the dashboard uses, so ``GET``/``PUT /machines/{id}/ci-node`` take
:func:`~app.api.deps.get_audit_actor_principal`, and a device-arm PUT is
forwarded to coord's agent twin ``/devenv/agent-ci-node-dispatch`` (which
rejects a Cognito bearer, as the operator door rejects a device JWT).

What these tests pin:

* a device JWT carrying ``user_id`` saves to ``devenv.machines`` and routes to
  the twin, with the caller's bearer and the twin's exact wire keys;
* a Cognito caller still routes to the operator door;
* a device JWT WITHOUT ``user_id`` gets a 401 and nothing is saved or sent;
* a device JWT for user U cannot read or write user V's machine (404, the same
  answer as an absent machine).

coord's JWKS is not under test. The missing-``user_id`` case stubs only
``coord_jwks_client.verify_token``, so the REAL ``_verify_device_jwt`` runs its
``user_id`` check; the others stub ``deps._verify_device_jwt`` whole.
"""

from __future__ import annotations

from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.devenv import Machine
from tests.test_devenv_environments import (
    _CALLER_TOKEN,
    API_PREFIX,
    _bearer_client,
    _build_app,
    _capturing_post,
    _mk_coord_device,
    _stub_ci_node_reachability,
)

DEVICE_BEARER = "device-jwt-for-test"

_AGENT_PATH = "/devenv/agent-ci-node-dispatch"
_OPERATOR_PATH = "/devenv/ci-node-dispatch"

_BODY = {
    "enabled": True,
    "max_concurrent_builds": 1,
    "repo_allowlist": ["qontinui/qontinui-runner"],
    "min_free_disk_gb": 20,
}


def _stub_device_jwt(monkeypatch, user) -> None:
    """Make ``DEVICE_BEARER`` verify as a device paired to ``user``.

    Stubs ``deps._verify_device_jwt`` (looked up at call time) rather than the
    JWKS client: the real verifier resolves the user through its OWN session,
    which cannot see rows this test's transaction has not committed. The
    ``user_id``-claim refusal is exercised separately against the real verifier
    (:func:`_stub_verify_token`), because it fails before that lookup.
    """
    from app.api import deps

    async def _fake_verify(token: str):
        if token != DEVICE_BEARER:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unexpected token")
        return ({"device_id": str(uuid4()), "user_id": str(user.id)}, user)

    monkeypatch.setattr(deps, "_verify_device_jwt", _fake_verify)


def _stub_verify_token(monkeypatch, claims: dict) -> None:
    """Make ``DEVICE_BEARER`` verify to ``claims``; any other token is refused."""
    from app.services.coord_jwks import coord_jwks_client

    async def _fake_verify(token: str, *a, **kw):
        if token != DEVICE_BEARER:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "unexpected token")
        return claims

    monkeypatch.setattr(coord_jwks_client, "verify_token", _fake_verify)


async def _mk_machine(db: AsyncSession, *, owner_id, coord_device_id) -> Machine:
    from app.repositories.devenv import machine_repo

    machine = await machine_repo.create(
        db,
        owner_id=owner_id,
        name=f"ci-box-{uuid4().hex[:6]}",
        hostname=None,
        description=None,
    )
    machine.coord_device_id = coord_device_id
    await db.commit()
    await db.refresh(machine)
    return machine


@pytest_asyncio.fixture()
async def second_user(async_db_session: AsyncSession):
    """A second real user row: the owner of the machine the token cannot touch."""
    from app.models.user import User

    user = User(
        email=f"other_{uuid4()}@example.com",
        username=f"other_{uuid4().hex[:8]}",
        full_name="Other User",
        is_active=True,
        is_verified=True,
    )
    async_db_session.add(user)
    await async_db_session.commit()
    await async_db_session.refresh(user)
    return user


@pytest.fixture()
def no_network(monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(
        "app.api.v1.endpoints.devenv.post_to_coord", _capturing_post(captured)
    )
    _stub_ci_node_reachability(monkeypatch)
    return captured


class TestCiNodeDevicePrincipal:
    @pytest.mark.asyncio
    async def test_device_jwt_with_user_id_saves_and_routes_to_the_twin(
        self, async_db_session: AsyncSession, test_user, monkeypatch, no_network
    ) -> None:
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=test_user.id, coord_device_id=device_id
        )
        _stub_device_jwt(monkeypatch, test_user)
        app = _build_app(db_session=async_db_session, user=None)
        async with _bearer_client(app, DEVICE_BEARER) as client:
            r = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node", json=_BODY
            )
            assert r.status_code == 200, r.text
            assert r.json()["dispatched"] is True
            assert r.json()["requested"]["enabled"] is True

            # Routed to the TWIN only, with the caller's own bearer.
            assert set(no_network) == {_AGENT_PATH}
            sent = no_network[_AGENT_PATH]
            assert sent["headers"] == {"Authorization": f"Bearer {DEVICE_BEARER}"}
            # The twin refuses any key outside its contract (and any tenant
            # key) — the body must be exactly its three top-level keys.
            assert set(sent["body"]) == {"target_device_id", "machine_id", "ci_node"}
            assert sent["body"]["target_device_id"] == device_id
            # ``model_access`` is omitted when unset, so exactly these four.
            assert set(sent["body"]["ci_node"]) == {
                "enabled",
                "max_concurrent_builds",
                "repo_allowlist",
                "min_free_disk_gb",
            }

            # The durable record is the same row the dashboard reads.
            r = await client.get(f"{API_PREFIX}/machines/{machine.id}/ci-node")
            assert r.status_code == 200, r.text
            assert r.json()["configured"] is True
            assert r.json()["requested"]["repo_allowlist"] == [
                "qontinui/qontinui-runner"
            ]

            # Reversible through the same door.
            r = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node",
                json={**_BODY, "enabled": False},
            )
            assert r.status_code == 200, r.text
            assert no_network[_AGENT_PATH]["body"]["ci_node"]["enabled"] is False

    @pytest.mark.asyncio
    async def test_cognito_caller_still_routes_to_the_operator_door(
        self, async_db_session: AsyncSession, test_user, no_network
    ) -> None:
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=test_user.id, coord_device_id=device_id
        )
        app = _build_app(db_session=async_db_session, user=test_user)
        async with _bearer_client(app) as client:
            r = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node", json=_BODY
            )
        assert r.status_code == 200, r.text
        assert set(no_network) == {_OPERATOR_PATH}
        assert no_network[_OPERATOR_PATH]["headers"] == {
            "Authorization": f"Bearer {_CALLER_TOKEN}"
        }

    @pytest.mark.asyncio
    async def test_device_jwt_without_user_id_is_401_and_nothing_is_saved(
        self, async_db_session: AsyncSession, test_user, monkeypatch, no_network
    ) -> None:
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=test_user.id, coord_device_id=device_id
        )
        _stub_verify_token(monkeypatch, {"device_id": str(uuid4())})
        app = _build_app(db_session=async_db_session, user=None)
        async with _bearer_client(app, DEVICE_BEARER) as client:
            r = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node", json=_BODY
            )
            assert r.status_code == 401, r.text
            # The refusal came from the DEVICE arm's claim check, not from a
            # Cognito-only dependency refusing an unknown bearer.
            assert "missing user_id claim" in r.text
            r = await client.get(f"{API_PREFIX}/machines/{machine.id}/ci-node")
            assert r.status_code == 401, r.text
            assert "missing user_id claim" in r.text
        assert no_network == {}
        await async_db_session.refresh(machine)
        assert machine.ci_node_config is None

    @pytest.mark.asyncio
    async def test_device_jwt_for_user_u_cannot_touch_user_vs_machine(
        self,
        async_db_session: AsyncSession,
        test_user,
        second_user,
        monkeypatch,
        no_network,
    ) -> None:
        # The machine belongs to second_user; the token speaks for test_user.
        device_id = await _mk_coord_device(async_db_session, user_id=second_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=second_user.id, coord_device_id=device_id
        )
        _stub_device_jwt(monkeypatch, test_user)
        app = _build_app(db_session=async_db_session, user=None)
        async with _bearer_client(app, DEVICE_BEARER) as client:
            put = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node", json=_BODY
            )
            get = await client.get(f"{API_PREFIX}/machines/{machine.id}/ci-node")
            absent = await client.get(f"{API_PREFIX}/machines/{uuid4()}/ci-node")
        assert put.status_code == 404, put.text
        assert get.status_code == 404, get.text
        # Indistinguishable from a machine that does not exist.
        assert put.json() == absent.json()
        assert no_network == {}
        await async_db_session.refresh(machine)
        assert machine.ci_node_config is None


class TestCiNodeDeviceArmDetails:
    @pytest.mark.asyncio
    async def test_device_arm_skips_the_sso_only_routing_probe(
        self, async_db_session: AsyncSession, test_user, monkeypatch
    ) -> None:
        """coord's routing read refuses a device JWT, so the device arm reports
        ``unknown`` without making the doomed call."""
        captured: dict = {}
        monkeypatch.setattr(
            "app.api.v1.endpoints.devenv.post_to_coord", _capturing_post(captured)
        )
        calls: list = []

        async def _routing(*a, **kw):
            calls.append((a, kw))
            return {"device_id": "x", "ws_session_id": "s"}

        monkeypatch.setattr("app.services.coord_device.get_device_routing", _routing)
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=test_user.id, coord_device_id=device_id
        )
        _stub_device_jwt(monkeypatch, test_user)
        app = _build_app(db_session=async_db_session, user=None)
        async with _bearer_client(app, DEVICE_BEARER) as client:
            r = await client.get(f"{API_PREFIX}/machines/{machine.id}/ci-node")
        assert r.status_code == 200, r.text
        assert r.json()["reachability"] == "unknown"
        assert calls == []

    @pytest.mark.asyncio
    async def test_device_arm_forwards_its_header_not_a_stale_cookie(
        self, async_db_session: AsyncSession, test_user, monkeypatch, no_network
    ) -> None:
        device_id = await _mk_coord_device(async_db_session, user_id=test_user.id)
        machine = await _mk_machine(
            async_db_session, owner_id=test_user.id, coord_device_id=device_id
        )
        _stub_device_jwt(monkeypatch, test_user)
        app = _build_app(db_session=async_db_session, user=None)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://test",
            headers={"Authorization": f"Bearer {DEVICE_BEARER}"},
            cookies={"access_token": "stale-browser-cookie"},
        ) as client:
            r = await client.put(
                f"{API_PREFIX}/machines/{machine.id}/ci-node", json=_BODY
            )
        assert r.status_code == 200, r.text
        assert no_network[_AGENT_PATH]["headers"] == {
            "Authorization": f"Bearer {DEVICE_BEARER}"
        }
