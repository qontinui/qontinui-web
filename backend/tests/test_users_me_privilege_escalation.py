"""``PUT /api/v1/users/me`` must never let a caller escalate their own row.

Plan: ``2026-07-29-web-put-users-me-self-privilege-escalation``.

The defect: ``crud.user.update_user`` was a single permissive helper shared by
the self-service writer (``users.py::update_user_me``, gated only on
``get_current_active_user_async`` — any authenticated user) and the superuser
writer (``users.py::update_user_by_id``). It did
``user_update.dict(exclude_unset=True)`` + ``setattr``, bypassing
fastapi-users' ``create_update_dict()`` whose entire job is excluding
``{id, is_superuser, is_active, is_verified, oauth_accounts}``. Since
``UserUpdate`` inherits all three flags from ``BaseUserUpdate``, any
authenticated caller could ``PUT /api/v1/users/me {"is_superuser": true}``.

The fix splits the helper in two — ``update_user_self`` (applies
``create_update_dict()``) and ``update_user_privileged`` (applies
``create_update_dict_superuser()``) — and DELETES the shared one, so the
permissive path is not reachable at all.

These tests assert the **persisted row**, re-read from Postgres after the
route commits, not the response body: a response model that omits a field
would otherwise hide a successful escalation.

The deactivation guarantee is covered separately by
``test_user_deactivation_coord_revoke.py`` (27 tests); this file only pins
that the privileged arm still carries the flags it must.
"""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models.user import User

# ---------------------------------------------------------------------------
# App wiring
# ---------------------------------------------------------------------------


def _client(app) -> httpx.AsyncClient:
    """Drive the app IN THE CALLING EVENT LOOP.

    Deliberately not ``fastapi.testclient.TestClient``: that runs the ASGI app
    on its own portal loop, while the ``async_db_session`` asyncpg connection
    belongs to the pytest-asyncio loop — the cross-loop await blows up inside
    greenlet_spawn. ``ASGITransport`` keeps both on one loop, which is what
    makes a real-Postgres assertion possible here at all.
    """
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    )


def _build_app(db, caller, superuser=None):
    """Mount the real ``users.py`` router over a real ``AsyncSession``.

    ``caller`` backs the self-service dependencies; ``superuser`` (defaulting
    to ``caller``) backs ``get_current_superuser_async``. Only the auth
    dependencies and the audit logger are stubbed — the CRUD layer under test
    runs for real against Postgres.
    """
    from slowapi import Limiter

    from app.api.deps import (
        get_async_db,
        get_current_active_user_async,
        get_current_superuser_async,
    )
    from app.api.v1.endpoints.users import router as users_router

    app = FastAPI()
    # slowapi's decorator resolves ``request.app.state.limiter`` at call time,
    # so a DISABLED limiter here replaces the module-global ``user_limiter``
    # for these tests. Deliberate: the global has ``memory://`` storage shared
    # for the whole pytest session and buckets every call under
    # ``ip:127.0.0.1`` (``get_user_identifier`` finds no ``request.state.user``),
    # so ``PUT /me``'s "30 per minute" would put this file on a 429 cliff as
    # soon as a case is added here or another file exercises the same route.
    app.state.limiter = Limiter(key_func=lambda _request: "test", enabled=False)
    # ``current_active_user`` is the SAME object as
    # ``get_current_active_user_async`` (``api/deps.py``), so overriding both
    # would just write the same key twice.
    app.dependency_overrides[get_current_active_user_async] = lambda: caller
    app.dependency_overrides[get_current_superuser_async] = lambda: (
        superuser or caller
    )
    app.dependency_overrides[get_async_db] = lambda: db
    app.include_router(users_router, prefix="/api/v1/users")
    return app


async def _make_user(db, **overrides) -> User:
    """Persist a plain, unprivileged user row."""
    fields = {
        "email": f"escalation_{uuid4().hex[:12]}@example.com",
        "username": f"escalation_{uuid4().hex[:8]}",
        "full_name": "Original Name",
        "company": "Original Co",
        "phone": "+1-555-0100",
        "cognito_sub": f"sub-{uuid4().hex[:12]}",
        "is_active": True,
        "is_superuser": False,
        "is_verified": False,
    }
    fields.update(overrides)
    user = User(**fields)
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _reread(db, user_id) -> User:
    """Re-SELECT the row from Postgres, bypassing the identity map.

    ``expire_all()`` discards every loaded attribute so the following query
    genuinely round-trips to the database — asserting on the in-memory object
    alone would not prove what was persisted.
    """
    db.expire_all()
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one()


@pytest_asyncio.fixture()
async def audit_stub():
    """Silence the audit writes; they are covered by their own suite."""
    audit = MagicMock()
    audit.log_account_modification = AsyncMock()
    audit.log_pii_access = AsyncMock()
    with patch("app.api.v1.endpoints.users.audit_logger", audit):
        yield audit


# ---------------------------------------------------------------------------
# Coord stubs (only the privileged ``is_active`` arm reaches coord)
# ---------------------------------------------------------------------------

TARGET_OPERATOR_ID = "6b1a0a3e-1111-4222-8333-444455556666"


def _coord_ok(sso_subject: str):
    """A stubbed ``httpx.AsyncClient`` that resolves + accepts the write."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.content = b"x"
    resp.json.return_value = {
        "operators": [
            {
                "operator_id": TARGET_OPERATOR_ID,
                "email": "target@example.com",
                "sso_subject": sso_subject,
            }
        ]
    }
    resp.text = "{}"

    write = MagicMock(spec=httpx.Response)
    write.status_code = 200
    write.content = b"x"
    write.json.return_value = {"ok": True}
    write.text = "{}"

    instance = AsyncMock()
    instance.get.return_value = resp
    instance.post.return_value = write
    instance.__aenter__ = AsyncMock(return_value=instance)
    instance.__aexit__ = AsyncMock(return_value=False)
    return instance


@contextmanager
def _patch_coord(instance):
    """Stub the coord HTTP client the proxy layer uses.

    ORDERING TRAP: ``app.api.v1.endpoints.operations.httpx`` IS the httpx
    module, so this patch replaces ``httpx.AsyncClient`` globally — including
    the class this file's own test client is built from. Always construct the
    ``_client(...)`` context FIRST and apply this patch inside it; the already
    -constructed instance keeps working, a later construction would not.
    """
    with patch("app.api.v1.endpoints.operations.httpx.AsyncClient") as mock_cls:
        mock_cls.return_value = instance
        yield instance


# ---------------------------------------------------------------------------
# The core regression: self-service PUT /me cannot escalate
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "flag", ["is_superuser", "is_active", "is_verified"], ids=lambda f: f
)
async def test_put_me_cannot_set_privileged_flag(async_db_session, audit_stub, flag):
    """The escalation itself: a non-superuser self-setting a gated flag.

    All three live in fastapi-users' excluded set and travelled the same
    ``setattr`` loop, so all three are pinned:

    * ``is_superuser`` — grants every ``get_current_superuser_async`` route,
      the PII-bearing user listings, and the superuser bypass at
      ``operations.py:240``.
    * ``is_active``   — web-local reactivation (defence in depth; a
      deactivated caller is already 401'd by the ``active=True`` dependency,
      which is what keeps this arm unreachable in practice today).
    * ``is_verified`` — set from Cognito's ``email_verified`` claim at
      provisioning (``cognito_provision.py``); self-setting it would let a
      user assert an email-verification state Cognito never granted.

    The assertion is on the row re-read from Postgres, not the response body.
    """
    db = async_db_session
    caller = await _make_user(db, is_active=True, is_superuser=False, is_verified=False)
    original = {
        "is_superuser": caller.is_superuser,
        "is_active": caller.is_active,
        "is_verified": caller.is_verified,
    }
    # Flip the requested flag away from its stored value so a successful
    # write would be unmistakable.
    requested = not original[flag]

    async with _client(_build_app(db, caller)) as client:
        resp = await client.put("/api/v1/users/me", json={flag: requested})

    # The request is accepted (the field is silently dropped, matching
    # fastapi-users' own PATCH /me semantics) — but nothing changed.
    assert resp.status_code == 200, resp.text
    row = await _reread(db, caller.id)
    assert getattr(row, flag) == original[flag], (
        f"PRIVILEGE ESCALATION: PUT /me persisted {flag}={requested}"
    )
    assert resp.json()[flag] == original[flag]


@pytest.mark.asyncio
async def test_put_me_cannot_escalate_alongside_a_legitimate_field(
    async_db_session, audit_stub
):
    """A real self-service edit must not smuggle the flags along with it."""
    db = async_db_session
    caller = await _make_user(db)

    async with _client(_build_app(db, caller)) as client:
        resp = await client.put(
            "/api/v1/users/me",
            json={
                "full_name": "Legit Rename",
                "is_superuser": True,
                "is_active": False,
                "is_verified": True,
            },
        )

    assert resp.status_code == 200, resp.text
    row = await _reread(db, caller.id)
    assert row.full_name == "Legit Rename"
    assert row.is_superuser is False
    assert row.is_active is True
    assert row.is_verified is False


@pytest.mark.asyncio
async def test_put_me_still_updates_self_service_fields(async_db_session, audit_stub):
    """The split must not break the route's legitimate purpose."""
    db = async_db_session
    caller = await _make_user(db)

    async with _client(_build_app(db, caller)) as client:
        resp = await client.put(
            "/api/v1/users/me",
            json={"full_name": "New Name", "company": "New Co", "phone": "+1-555-0199"},
        )

    assert resp.status_code == 200, resp.text
    row = await _reread(db, caller.id)
    assert (row.full_name, row.company, row.phone) == (
        "New Name",
        "New Co",
        "+1-555-0199",
    )


@pytest.mark.asyncio
async def test_put_me_profile_still_updates_self_service_fields(
    async_db_session, audit_stub
):
    """``PUT /me/profile`` is the sibling ``setattr`` writer — wiring check.

    This only proves the route still reaches the (now gated)
    ``update_user_profile``. It deliberately does NOT try to escalate:
    ``UserProfileUpdate`` declares only self-service fields, so pydantic
    drops any privileged key before the CRUD layer is reached and such a
    test would pass against the vulnerable code too — vacuous. The gate is
    pinned for real by ``test_update_user_profile_filters_a_privileged_field``
    below.
    """
    db = async_db_session
    caller = await _make_user(db)

    async with _client(_build_app(db, caller)) as client:
        resp = await client.put(
            "/api/v1/users/me/profile",
            json={"full_name": "Profile Name", "company": "Profile Co"},
        )

    assert resp.status_code == 200, resp.text
    row = await _reread(db, caller.id)
    assert (row.full_name, row.company) == ("Profile Name", "Profile Co")


@pytest.mark.asyncio
async def test_update_user_profile_filters_a_privileged_field(async_db_session):
    """The profile gate must actually BITE when a privileged field exists.

    The whole point of routing ``update_user_profile`` through
    ``create_update_dict()`` is that a privileged field ADDED to
    ``UserProfileUpdate`` later cannot reopen the escalation. That future is
    simulated here with a subclass carrying the flags, driven through the
    real CRUD helper — which is what makes this a genuine pin rather than a
    restatement of pydantic's unknown-key behaviour. Against the previous
    ``profile_update.dict(exclude_unset=True)`` + ``setattr`` body this
    persists ``is_superuser=True``.
    """
    from app.crud.user import update_user_profile
    from app.schemas.user import UserProfileUpdate

    class _FutureProfileUpdate(UserProfileUpdate):
        is_superuser: bool | None = None
        is_verified: bool | None = None

    db = async_db_session
    user = await _make_user(db)

    await update_user_profile(
        db,
        user,
        _FutureProfileUpdate(full_name="Filtered", is_superuser=True, is_verified=True),
    )

    row = await _reread(db, user.id)
    assert row.full_name == "Filtered"
    assert row.is_superuser is False
    assert row.is_verified is False


# ---------------------------------------------------------------------------
# The privileged arm must keep working
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_superuser_put_by_id_still_sets_privileged_flags(
    async_db_session, audit_stub
):
    """A superuser writing another row keeps full reach.

    No ``is_active`` in the payload, so ``apply_activation_transition``
    short-circuits and coord is never called — asserted, so a regression that
    started making coord calls on non-activation writes would fail here.
    """
    db = async_db_session
    target = await _make_user(db)
    admin = await _make_user(db, is_superuser=True, is_verified=True)

    instance = _coord_ok(target.cognito_sub)
    async with _client(_build_app(db, caller=admin, superuser=admin)) as client:
        with _patch_coord(instance):
            resp = await client.put(
                f"/api/v1/users/{target.id}",
                json={"is_superuser": True, "is_verified": True},
                headers={"Authorization": "Bearer caller-token"},
            )

    assert resp.status_code == 200, resp.text
    row = await _reread(db, target.id)
    assert row.is_superuser is True
    assert row.is_verified is True
    instance.post.assert_not_called()


@pytest.mark.asyncio
async def test_superuser_put_by_id_still_deactivates_through_coord(
    async_db_session, audit_stub
):
    """The deactivation writer keeps both halves: coord call AND local flip.

    This is the path plan
    ``2026-07-24-web-deactivation-must-revoke-coord-membership`` shipped;
    routing it to the privileged variant must not change it.
    """
    db = async_db_session
    target = await _make_user(db)
    admin = await _make_user(db, is_superuser=True, is_verified=True)

    instance = _coord_ok(target.cognito_sub)
    async with _client(_build_app(db, caller=admin, superuser=admin)) as client:
        with _patch_coord(instance):
            resp = await client.put(
                f"/api/v1/users/{target.id}",
                json={"is_active": False, "is_superuser": True},
                headers={"Authorization": "Bearer caller-token"},
            )

    assert resp.status_code == 200, resp.text
    assert instance.post.call_args.args[0].endswith(
        f"/coord/operators/{TARGET_OPERATOR_ID}/disable"
    )
    row = await _reread(db, target.id)
    assert row.is_active is False
    assert row.is_superuser is True


# ---------------------------------------------------------------------------
# Field-policy pins (no DB needed)
# ---------------------------------------------------------------------------


class TestFieldPolicy:
    """Pin the library contract the split now delegates to."""

    def test_user_update_self_dict_excludes_the_privileged_flags(self):
        from app.schemas.user import UserUpdate

        data = UserUpdate(
            full_name="X",
            is_superuser=True,
            is_active=False,
            is_verified=True,
        ).create_update_dict()

        assert data == {"full_name": "X"}

    def test_user_update_superuser_dict_keeps_the_privileged_flags(self):
        from app.schemas.user import UserUpdate

        data = UserUpdate(
            full_name="X",
            is_superuser=True,
            is_active=False,
            is_verified=True,
        ).create_update_dict_superuser()

        assert data == {
            "full_name": "X",
            "is_superuser": True,
            "is_active": False,
            "is_verified": True,
        }

    def test_both_dicts_drop_password(self):
        """Cognito-only: there is no ``hashed_password`` column to write."""
        from app.schemas.user import UserUpdate

        update = UserUpdate(password="hunter2", full_name="X")
        assert "password" not in update.create_update_dict()
        assert "password" not in update.create_update_dict_superuser()

    def test_profile_update_carries_the_library_field_policy(self):
        """``UserProfileUpdate`` is now a ``CreateUpdateDictModel`` too.

        Pinned so the gate cannot be dropped back to a bare ``BaseModel``
        without a failing test.
        """
        from fastapi_users import schemas as fu_schemas

        from app.schemas.user import UserProfileUpdate

        assert issubclass(UserProfileUpdate, fu_schemas.CreateUpdateDictModel)
        assert UserProfileUpdate(full_name="X").create_update_dict() == {
            "full_name": "X"
        }

    def test_permissive_shared_helper_is_gone(self):
        """The deleted helper must not come back as an alias.

        Leaving ``update_user`` reachable — even deprecated — is how the hole
        reopens: a new route would import the familiar name and get the
        permissive behaviour.
        """
        import app.crud.user as crud_user

        assert not hasattr(crud_user, "update_user")
        assert hasattr(crud_user, "update_user_self")
        assert hasattr(crud_user, "update_user_privileged")


# ---------------------------------------------------------------------------
# The fastapi-users PATCH /me route (the OTHER self-service writer)
# ---------------------------------------------------------------------------


def _admin_like():
    from datetime import UTC, datetime

    now = datetime(2026, 7, 29, tzinfo=UTC)
    return SimpleNamespace(
        id=uuid4(),
        email="patcher@example.com",
        username="patcher",
        full_name="Patcher",
        is_active=True,
        is_superuser=False,
        is_verified=False,
        cognito_sub="patch-sub",
        subscription_tier="free",
        created_at=now,
        updated_at=now,
    )


class TestFastAPIUsersPatchMe:
    """``PATCH /api/v1/auth/users/me`` goes through the library's manager.

    ``fastapi_users/router/users.py`` calls ``user_manager.update(...,
    safe=True)`` and ``BaseUserManager.update`` then uses
    ``create_update_dict()`` — so this route was never vulnerable. Verified
    against the installed v15 source and pinned here, because a fastapi-users
    bump that flipped ``safe`` would silently hand this route the privileged
    field set.
    """

    def _client(self, user, applied):
        from app.auth.config import (
            UserManager,
            auth_backend,
            fastapi_users,
            get_jwt_strategy,
            get_user_manager,
        )
        from app.schemas.user import UserRead, UserUpdate

        user_db = MagicMock()
        user_db.get = AsyncMock(return_value=user)

        async def _update(u, data):
            applied.update(data)
            for field, value in data.items():
                setattr(u, field, value)
            return u

        user_db.update = AsyncMock(side_effect=_update)
        manager = UserManager(user_db)
        manager.on_after_update = AsyncMock()

        class _StubStrategy:
            async def read_token(self, token, user_manager):
                return user

            async def write_token(self, u):  # pragma: no cover - unused
                return "stub"

            async def destroy_token(self, token, u):  # pragma: no cover
                return None

        app = FastAPI()
        app.dependency_overrides[get_user_manager] = lambda: manager
        app.dependency_overrides[get_jwt_strategy] = lambda: _StubStrategy()
        app.dependency_overrides[auth_backend.get_strategy] = lambda: _StubStrategy()
        app.include_router(
            fastapi_users.get_users_router(UserRead, UserUpdate),
            prefix="/api/v1/auth/users",
        )
        return TestClient(app)

    def test_patch_me_drops_the_privileged_flags(self):
        user = _admin_like()
        applied: dict = {}
        client = self._client(user, applied)

        instance = _coord_ok("patch-sub")
        with _patch_coord(instance):
            resp = client.patch(
                "/api/v1/auth/users/me",
                json={
                    "full_name": "Renamed",
                    "is_superuser": True,
                    "is_active": False,
                    "is_verified": True,
                },
                headers={"Authorization": "Bearer caller-token"},
            )

        assert resp.status_code == 200, resp.text
        # Only the self-service field reached the user-DB write.
        assert applied == {"full_name": "Renamed"}
        assert user.is_superuser is False
        assert user.is_active is True
        assert user.is_verified is False
        # ``safe=True`` short-circuits the deactivation override entirely:
        # zero coord traffic on the self-service arm.
        instance.get.assert_not_called()
        instance.post.assert_not_called()
