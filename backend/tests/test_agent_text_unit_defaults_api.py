"""``PUT|GET /api/v1/agent-text-units/defaults`` — the embedded layer.

Phase 4 of plan ``2026-08-31-runner-publishes-embedded-command-defaults``. The
plan's Verification section names the gates and every one of them is a test
here, over the real HTTP surface and the real test database:

* **org isolation** — org A cannot read or write org B's defaults, at the
  membership boundary (403) AND at the storage boundary (A's publish is
  invisible to B);
* **full-set replace** deletes a name dropped from the roster;
* **version compare is semantic** — ``0.9.0 -> 0.10.0`` accepted and
  ``0.10.0 -> 0.9.0`` refused. Single-digit versions would pass under a string
  compare too and prove nothing, so the pin is on the two-digit component;
* **checksum mismatch** is refused with a typed reason;
* **canonical checksum equality** between a stored override and a published
  default with identical files — the digest that makes the baseline diffable
  at all (Design decision 8), and the one the Rust side agrees with byte for
  byte.

Plus the things the storage change must not break: the layer-addressed CRUD
and both list projections never see a published default, an override of the
same name coexists with it (the narrowed partial index), and deleting the
override does not delete the baseline it previews.

Uses ``httpx.AsyncClient`` + ``ASGITransport`` so the handler runs in the SAME
asyncio loop as the shared async DB session — the pattern
``test_agent_text_unit_index_api.py`` follows.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import ExitStack
from typing import Any
from unittest.mock import MagicMock, patch
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, or_
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.api.deps import current_active_user, get_async_db
from app.api.v1.endpoints.agent_commands import router as commands_router
from app.api.v1.endpoints.agent_text_units import router as units_router
from app.models.agent_text_unit import KIND_COMMAND, KIND_SKILL, AgentTextUnit
from app.models.organization import Organization
from app.models.user import User
from app.services.agent_text_unit_service import (
    MAX_FILE_BYTES,
    compute_body_checksum,
    compute_files_checksum,
)

UNITS_PREFIX = "/api/v1/agent-text-units"
COMMANDS_PREFIX = "/api/v1/agent-commands"
DEFAULTS = f"{UNITS_PREFIX}/defaults"
PUBLISHED_AT = "2026-09-05T08:00:00Z"


# ---------------------------------------------------------------------------
# Fixtures: two independent accounts, one client each
# ---------------------------------------------------------------------------


class _Account:
    def __init__(self, org_id: UUID, user_id: UUID) -> None:
        self.org_id = org_id
        self.user_id = user_id

    @property
    def params(self) -> dict[str, str]:
        return {"organization_id": str(self.org_id)}


@pytest_asyncio.fixture
async def def_db(test_engine) -> AsyncGenerator[AsyncSession, None]:
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def accounts(
    def_db: AsyncSession,
) -> AsyncGenerator[tuple[_Account, _Account], None]:
    created: list[_Account] = []
    for _ in range(2):
        user = User(
            email=f"atud_{uuid4()}@example.com",
            username=f"atud_{uuid4().hex[:8]}",
            full_name="Defaults Test User",
            is_active=True,
            is_verified=True,
        )
        def_db.add(user)
        await def_db.flush()
        org = Organization(
            name=f"atud-org-{uuid4().hex[:8]}",
            slug=f"atud-org-{uuid4().hex[:8]}",
            owner_id=user.id,
            settings={},
        )
        def_db.add(org)
        await def_db.flush()
        created.append(_Account(org.id, user.id))
    await def_db.commit()

    yield created[0], created[1]

    await def_db.rollback()
    org_ids = [a.org_id for a in created]
    await def_db.execute(
        delete(AgentTextUnit).where(
            or_(
                AgentTextUnit.organization_id.in_(org_ids),
                AgentTextUnit.organization_id.is_(None),
            )
        )
    )
    await def_db.execute(delete(Organization).where(Organization.id.in_(org_ids)))
    await def_db.execute(delete(User).where(User.id.in_([a.user_id for a in created])))
    await def_db.commit()


def _client(def_db: AsyncSession, user_id: UUID) -> httpx.AsyncClient:
    user = MagicMock()
    user.id = user_id
    user.is_active = True
    user.is_verified = True
    user.is_superuser = False

    app = FastAPI()

    async def _db_override() -> AsyncGenerator[AsyncSession, None]:
        yield def_db

    app.dependency_overrides[get_async_db] = _db_override
    app.dependency_overrides[current_active_user] = lambda: user
    app.include_router(units_router, prefix=UNITS_PREFIX)
    app.include_router(commands_router, prefix=COMMANDS_PREFIX)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    )


@pytest.fixture
def client_a(
    def_db: AsyncSession, accounts: tuple[_Account, _Account]
) -> httpx.AsyncClient:
    return _client(def_db, accounts[0].user_id)


@pytest.fixture
def client_b(
    def_db: AsyncSession, accounts: tuple[_Account, _Account]
) -> httpx.AsyncClient:
    return _client(def_db, accounts[1].user_id)


def _membership(accounts: tuple[_Account, _Account]) -> object:
    """A REAL membership check, not ``always True``: each user is a member of
    exactly their own org. That is what makes the 403 half of org isolation a
    test rather than a tautology."""
    owns = {a.user_id: a.org_id for a in accounts}

    async def _check(_db: object, user_id: UUID, org_id: UUID, **_: object) -> bool:
        return owns.get(user_id) == org_id

    # Both modules import the checker by name, so each binding is patched: the
    # alias's list route is exercised below too.
    stack = ExitStack()
    for module in ("agent_text_units", "agent_commands"):
        stack.enter_context(
            patch(
                f"app.api.v1.endpoints.{module}.check_organization_membership",
                new=_check,
            )
        )
    return stack


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------


def unit(
    name: str,
    body: str,
    version: str,
    *,
    kind: str = KIND_COMMAND,
    checksum: str | None = None,
    published_at: str = PUBLISHED_AT,
) -> dict[str, Any]:
    files = {("SKILL.md" if kind == KIND_SKILL else f"{name}.md"): body}
    return {
        "kind": kind,
        "name": name,
        "files": files,
        "checksum": checksum if checksum is not None else compute_files_checksum(files),
        "published_by_version": version,
        "published_at": published_at,
    }


def roster(version: str, *names: str) -> dict[str, Any]:
    """A complete roster of ``names`` at ``version``; the body names the build
    so a diff between two publishes is visible."""
    return {
        "runner_version": version,
        "units": [unit(n, f"# {n} as of {version}\n", version) for n in names],
    }


async def _publish(
    client: httpx.AsyncClient, account: _Account, payload: dict[str, Any]
) -> httpx.Response:
    return await client.put(DEFAULTS, params=account.params, json=payload)


async def _get(client: httpx.AsyncClient, account: _Account) -> dict[str, Any]:
    response = await client.get(DEFAULTS, params=account.params)
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def _names(body: dict[str, Any]) -> list[str]:
    return sorted(u["name"] for u in body["units"])


# ---------------------------------------------------------------------------
# Round trip + the no-baseline state
# ---------------------------------------------------------------------------


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_no_baseline_reads_as_empty_with_null_version(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """Design decision 7: absent is a real state the frontend renders as
        unavailable. It is ``[]`` + ``null``, never a fabricated default."""
        with _membership(accounts):
            async with client_a:
                body = await _get(client_a, accounts[0])
        assert body == {"units": [], "published_by_version": None, "published_at": None}

    @pytest.mark.asyncio
    async def test_publish_then_get_round_trips_the_generated_shape(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        a = accounts[0]
        payload = roster("0.4.12", "vet-plan", "implement-plan")
        payload["units"].append(
            unit("coord-revive", "# revive\n", "0.4.12", kind=KIND_SKILL)
        )
        with _membership(accounts):
            async with client_a:
                put = await _publish(client_a, a, payload)
                body = await _get(client_a, a)

        assert put.status_code == 200, put.text
        assert put.json() == {
            "accepted": True,
            "rejected_reason": None,
            "stored_version": "0.4.12",
            "count": 3,
        }
        assert body["published_by_version"] == "0.4.12"
        assert body["published_at"] == PUBLISHED_AT
        # Every field of the shared type comes back as sent, kind included:
        # the corpus is kind-discriminated so the baseline must be too.
        by_key = {(u["kind"], u["name"]): u for u in body["units"]}
        for sent in payload["units"]:
            got = by_key[(sent["kind"], sent["name"])]
            assert got == sent

    @pytest.mark.asyncio
    async def test_the_alias_inherits_both_routes_verbatim(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """``/agent-commands/defaults`` is ONE ``include_router`` of the same
        sub-router — and it must precede the alias's ``/{name}`` route or the
        legacy single-command GET swallows it as a command named ``defaults``."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                put = await client_a.put(
                    f"{COMMANDS_PREFIX}/defaults",
                    params=a.params,
                    json=roster("0.4.12", "vet-plan"),
                )
                via_alias = await client_a.get(
                    f"{COMMANDS_PREFIX}/defaults", params=a.params
                )
                via_real = await _get(client_a, a)
        assert put.status_code == 200, put.text
        assert via_alias.status_code == 200, via_alias.text
        assert via_alias.json() == via_real


# ---------------------------------------------------------------------------
# The plan's gates
# ---------------------------------------------------------------------------


class TestOrgIsolation:
    @pytest.mark.asyncio
    async def test_a_cannot_read_or_write_b_and_storage_is_per_org(
        self,
        client_a: httpx.AsyncClient,
        client_b: httpx.AsyncClient,
        accounts: tuple[_Account, _Account],
    ) -> None:
        a, b = accounts
        with _membership(accounts):
            async with client_a, client_b:
                # A publishes its own baseline.
                assert (
                    await _publish(client_a, a, roster("1.0.0", "vet-plan"))
                ).status_code == 200

                # A cannot READ B's layer nor WRITE it: membership boundary.
                read_b_as_a = await client_a.get(DEFAULTS, params=b.params)
                write_b_as_a = await client_a.put(
                    DEFAULTS, params=b.params, json=roster("1.0.0", "vet-plan")
                )

                # B sees no baseline: storage boundary. Then B publishes a
                # DIFFERENT roster and A's is untouched.
                b_before = await _get(client_b, b)
                assert (
                    await _publish(client_b, b, roster("2.0.0", "gate", "policy"))
                ).status_code == 200
                a_after = await _get(client_a, a)
                b_after = await _get(client_b, b)

        assert read_b_as_a.status_code == 403
        assert write_b_as_a.status_code == 403
        assert b_before["units"] == [] and b_before["published_by_version"] is None
        assert (
            _names(a_after) == ["vet-plan"]
            and a_after["published_by_version"] == "1.0.0"
        )
        assert (
            _names(b_after) == ["gate", "policy"]
            and b_after["published_by_version"] == "2.0.0"
        )


class TestFullSetReplace:
    @pytest.mark.asyncio
    async def test_a_name_dropped_from_the_roster_is_deleted(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """Design decision 3: the payload is authoritative. A default that
        outlives its bundle entry is the stale baseline the plan removes."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                await _publish(
                    client_a, a, roster("1.0.0", "vet-plan", "gate", "whereami")
                )
                second = await _publish(
                    client_a, a, roster("1.0.0", "vet-plan", "gate")
                )
                body = await _get(client_a, a)
        assert second.json()["count"] == 2
        assert _names(body) == ["gate", "vet-plan"]

    @pytest.mark.asyncio
    async def test_a_kept_name_is_updated_in_place_not_duplicated(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                await _publish(client_a, a, roster("1.0.0", "vet-plan"))
                await _publish(client_a, a, roster("1.1.0", "vet-plan"))
                body = await _get(client_a, a)
        assert len(body["units"]) == 1
        assert body["units"][0]["files"] == {"vet-plan.md": "# vet-plan as of 1.1.0\n"}
        assert body["units"][0]["published_by_version"] == "1.1.0"


class TestMonotonicGuard:
    @pytest.mark.asyncio
    async def test_versions_compare_semantically_not_lexically(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """``"0.10.0" < "0.9.0"`` as strings. A string guard would refuse the
        NEWER build and accept the OLDER one — silently, since the refusal is a
        normal 200. ``0.9.0 -> 0.10.0`` accepted and ``0.10.0 -> 0.9.0`` refused
        is the pair that tells the two implementations apart."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                first = await _publish(client_a, a, roster("0.9.0", "vet-plan"))
                newer = await _publish(client_a, a, roster("0.10.0", "vet-plan"))
                older = await _publish(client_a, a, roster("0.9.0", "vet-plan"))
                body = await _get(client_a, a)

        assert first.json()["accepted"] is True
        assert newer.json() == {
            "accepted": True,
            "rejected_reason": None,
            "stored_version": "0.10.0",
            "count": 1,
        }
        # A normal 200, not an error: an old device is not a fault.
        assert older.status_code == 200
        assert older.json() == {
            "accepted": False,
            "rejected_reason": "older_than_stored",
            "stored_version": "0.10.0",
            "count": 0,
        }
        # And the refused publish wrote nothing.
        assert body["published_by_version"] == "0.10.0"
        assert body["units"][0]["files"] == {"vet-plan.md": "# vet-plan as of 0.10.0\n"}

    @pytest.mark.asyncio
    async def test_equal_versions_last_writer_wins(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """Design decision 4 says so explicitly: the guard is a mitigation. Two
        devices on the same build tie-break last-writer, and the response
        names the version that stands."""
        a = accounts[0]
        payload = {
            "runner_version": "1.0.0",
            "units": [unit("vet-plan", "# from device two\n", "1.0.0")],
        }
        with _membership(accounts):
            async with client_a:
                await _publish(client_a, a, roster("1.0.0", "vet-plan"))
                second = await _publish(client_a, a, payload)
                body = await _get(client_a, a)
        assert second.json()["accepted"] is True
        assert second.json()["stored_version"] == "1.0.0"
        assert body["units"][0]["files"] == {"vet-plan.md": "# from device two\n"}

    @pytest.mark.asyncio
    async def test_an_unparseable_runner_version_is_a_typed_422(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        a = accounts[0]
        payload = roster("1.0.0", "vet-plan")
        payload["runner_version"] = "not-a-version"
        payload["units"][0]["published_by_version"] = "not-a-version"
        with _membership(accounts):
            async with client_a:
                response = await _publish(client_a, a, payload)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["reason"] == "invalid_runner_version"


class TestRefusals:
    @pytest.mark.asyncio
    async def test_checksum_mismatch_is_refused_and_writes_nothing(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """A client-asserted digest is not evidence: the store recomputes with
        the canonical files-map digest and refuses a mismatch — including the
        specific wrong digest a confused client would send, the legacy
        single-body one the ``/agent-commands`` alias still carries."""
        a = accounts[0]
        body = "# vet-plan\n"
        wrong = compute_body_checksum(body)
        assert wrong != compute_files_checksum({"vet-plan.md": body})
        payload = {
            "runner_version": "1.0.0",
            "units": [
                unit("gate", "# gate\n", "1.0.0"),
                unit("vet-plan", body, "1.0.0", checksum=wrong),
            ],
        }
        with _membership(accounts):
            async with client_a:
                response = await _publish(client_a, a, payload)
                after = await _get(client_a, a)
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["reason"] == "checksum_mismatch"
        assert detail["unit"] == "command/vet-plan"
        # Validated as a whole before anything is written: the good unit in
        # the same roster did not land either.
        assert after["units"] == []

    @pytest.mark.asyncio
    async def test_published_by_version_must_equal_runner_version(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        a = accounts[0]
        payload = {
            "runner_version": "1.0.0",
            "units": [unit("vet-plan", "# vet\n", "0.9.9")],
        }
        with _membership(accounts):
            async with client_a:
                response = await _publish(client_a, a, payload)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["reason"] == "version_mismatch"

    @pytest.mark.asyncio
    async def test_a_default_obeys_the_same_rules_as_an_override(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """Name, path and size rules are the override's, unrelaxed — a baseline
        that could not be stored as a unit is not one anything can be diffed
        against. The size rule is the per-file 1 MiB bound."""
        a = accounts[0]
        cases = {
            "traversal": unit("vet-plan", "# x\n", "1.0.0")
            | {"files": {"../vet-plan.md": "# x\n"}},
            "bad-name": unit("Vet Plan", "# x\n", "1.0.0"),
            "too-large": unit("vet-plan", "x" * (MAX_FILE_BYTES + 1), "1.0.0"),
            "missing-entrypoint": unit("vet-plan", "# x\n", "1.0.0")
            | {"files": {"notes.md": "# x\n"}},
        }
        for case in cases.values():
            case["checksum"] = compute_files_checksum(case["files"])
        results: dict[str, httpx.Response] = {}
        with _membership(accounts):
            async with client_a:
                for label, bad in cases.items():
                    results[label] = await _publish(
                        client_a, a, {"runner_version": "1.0.0", "units": [bad]}
                    )
        for label, response in results.items():
            assert response.status_code == 422, (label, response.text)
            assert response.json()["detail"]["reason"] == "invalid_unit", label

    @pytest.mark.asyncio
    async def test_duplicate_units_in_one_roster_are_refused(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        a = accounts[0]
        payload = {
            "runner_version": "1.0.0",
            "units": [
                unit("vet-plan", "# a\n", "1.0.0"),
                unit("vet-plan", "# b\n", "1.0.0"),
            ],
        }
        with _membership(accounts):
            async with client_a:
                response = await _publish(client_a, a, payload)
        assert response.status_code == 422
        assert response.json()["detail"]["reason"] == "duplicate_unit"


# ---------------------------------------------------------------------------
# The baseline against the stored layers
# ---------------------------------------------------------------------------


class TestBaselineBesideTheStoredLayers:
    @pytest.mark.asyncio
    async def test_override_and_default_share_the_canonical_checksum(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """Design decision 8's warning, as a test: a default and an override with
        identical files must digest to the same value, or the baseline is
        always-drifted and the diff view can never say "identical"."""
        a = accounts[0]
        files = {"vet-plan.md": "# vet-plan\r\nline two\r\n"}
        with _membership(accounts):
            async with client_a:
                stored = await client_a.post(
                    UNITS_PREFIX,
                    params=a.params,
                    json={"name": "vet-plan", "files": files},
                )
                published = await _publish(
                    client_a,
                    a,
                    {
                        "runner_version": "1.0.0",
                        "units": [unit("vet-plan", "# vet-plan\nline two\n", "1.0.0")],
                    },
                )
                baseline = await _get(client_a, a)
        assert stored.status_code == 200, stored.text
        assert published.status_code == 200, published.text
        # CRLF on one side, LF on the other: the canonical digest is
        # line-ending invariant, so the two still compare equal.
        assert stored.json()["checksum"] == baseline["units"][0]["checksum"]
        assert stored.json()["checksum"] == compute_files_checksum(files)

    @pytest.mark.asyncio
    async def test_the_stored_layers_never_see_a_published_default(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """The runner reads the list projections on the spawn path and
        provisions what they return. The published default is the runner's own
        embedded copy — folding it in would put the network back on the
        out-of-the-box path (plan Risk 5). Neither projection, at either layer,
        and not the layer-addressed single GET either."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                await _publish(client_a, a, roster("1.0.0", "vet-plan", "gate"))
                listing = await client_a.get(UNITS_PREFIX, params=a.params)
                index = await client_a.get(f"{UNITS_PREFIX}/index", params=a.params)
                raw_layer = await client_a.get(
                    UNITS_PREFIX, params={**a.params, "include_fleet_defaults": "false"}
                )
                addressed = await client_a.get(
                    f"{UNITS_PREFIX}/vet-plan",
                    params={
                        **a.params,
                        "kind": KIND_COMMAND,
                        "include_fleet_defaults": "false",
                    },
                )
                # The alias an unrebuilt runner reads, most of all.
                alias = await client_a.get(
                    COMMANDS_PREFIX, params={**a.params, "limit": "500"}
                )
        assert listing.json()["items"] == []
        assert index.json()["items"] == []
        assert raw_layer.json()["items"] == []
        assert addressed.status_code == 404
        assert alias.json()["items"] == []

    @pytest.mark.asyncio
    async def test_get_unit_falls_through_to_the_baseline_as_its_last_rung(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """``account override -> fleet default -> embedded default``, and the
        response names the layer that answered."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                await _publish(client_a, a, roster("1.0.0", "vet-plan"))
                resolved = await client_a.get(
                    f"{UNITS_PREFIX}/vet-plan",
                    params={**a.params, "kind": KIND_COMMAND},
                )
        assert resolved.status_code == 200, resolved.text
        assert resolved.json()["source"] == "embedded"
        assert resolved.json()["files"] == {"vet-plan.md": "# vet-plan as of 1.0.0\n"}

    @pytest.mark.asyncio
    async def test_an_override_coexists_with_its_baseline_and_a_reset_keeps_it(
        self, client_a: httpx.AsyncClient, accounts: tuple[_Account, _Account]
    ) -> None:
        """The narrowed partial index is what lets the pair exist at all; and
        deleting the override — the "reset" the dialog previews — must reveal
        the baseline rather than delete it."""
        a = accounts[0]
        with _membership(accounts):
            async with client_a:
                await _publish(client_a, a, roster("1.0.0", "vet-plan"))
                override = await client_a.post(
                    UNITS_PREFIX,
                    params=a.params,
                    json={"name": "vet-plan", "files": {"vet-plan.md": "# mine\n"}},
                )
                # The override wins the resolved read while it exists...
                while_overridden = await client_a.get(
                    f"{UNITS_PREFIX}/vet-plan",
                    params={**a.params, "kind": KIND_COMMAND},
                )
                # ...and the baseline is untouched by the override's write.
                baseline_before = await _get(client_a, a)
                reset = await client_a.delete(
                    f"{UNITS_PREFIX}/vet-plan",
                    params={**a.params, "kind": KIND_COMMAND},
                )
                after_reset = await client_a.get(
                    f"{UNITS_PREFIX}/vet-plan",
                    params={**a.params, "kind": KIND_COMMAND},
                )
                baseline_after = await _get(client_a, a)
        assert override.status_code == 200, override.text
        assert while_overridden.json()["source"] == "user"
        assert while_overridden.json()["files"] == {"vet-plan.md": "# mine\n"}
        assert baseline_before["units"][0]["files"] == {
            "vet-plan.md": "# vet-plan as of 1.0.0\n"
        }
        assert reset.status_code == 204
        assert after_reset.json()["source"] == "embedded"
        assert baseline_after == baseline_before


# ---------------------------------------------------------------------------
# Checksum conformance with the Rust side (no database)
# ---------------------------------------------------------------------------


def test_files_checksum_agrees_with_the_rust_implementation_byte_for_byte() -> None:
    """The six vectors ``qontinui-schemas/rust/src/agent_text_units.rs`` pins in
    ``digests_match_the_python_implementation_byte_for_byte``. That test was
    generated by RUNNING this function; this one closes the loop from the other
    side, so an edit to either implementation fails somewhere. It matters here
    specifically because the runner computes ``AgentTextUnitDefault.checksum``
    with the Rust function and this store recomputes it with the Python one —
    if they disagreed, every publish would be refused as ``checksum_mismatch``.
    """
    vectors = [
        (
            {
                "SKILL.md": "# coord-revive\nrun the script\n",
                "coord-revive.sh": "#!/usr/bin/env bash\n",
            },
            "sha256-72d07280e4ff0f72f46b9a47e5ade16960c556d73c4c7a89e102b7e61fbc065d",
        ),
        (
            {"SKILL.md": "hi\n", "run.sh": "x"},
            "sha256-e0e50bed79005cfb3e09c488fe374297232bf438beaee54c3a1dd972828b9f45",
        ),
        (
            {"r": "b", "S": "a"},
            "sha256-3746938afa65bd1f60512f87645c3ee1d19ad6e142a78b19b96171d25d1d562d",
        ),
        (
            {"a.md": "x\r\ny\r\n"},
            "sha256-4aae522c5ab6be12c342c5363dbab82d09c6f645f4075828ea9f87168b504f5c",
        ),
        (
            {"é.md": "λ"},
            "sha256-3b504b6796f1a0054aa0eac9edf70db67d28398de8e1bab40bf3b9a324952148",
        ),
        (
            {"vet-plan.md": "# /vet-plan\n"},
            "sha256-9d821fc6a34805612729c37c8b98b7aeb2e52ee2675ca18b4ac4a4bd64c9aac8",
        ),
    ]
    for files, expected in vectors:
        assert compute_files_checksum(files) == expected, sorted(files)
