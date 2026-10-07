"""Redis registry primitives of the remote-terminal relay.

The key and channel builders, the two atomic Lua scripts that bind and release
the per-terminal return route, and the thin helpers that run them against the
sync/async union redis-py types its commands with — and ``RelayRegistry``, the
relay's claim / record / bind / release of one attachment's keys. The client
itself stays on the relay core (``app.services.runner.remote_terminal_relay``),
reached through ``RelayCore._get_redis`` so that patching the relay module's
``get_redis`` still reaches every command issued here.
"""

from __future__ import annotations

import inspect
from typing import Any

from redis import asyncio as aioredis

from app.services.runner.remote_relay.core import RelayCore
from app.services.runner.remote_relay.protocol import KIND_CREATE
from app.services.runner.remote_relay.state import _Attachment


async def _maybe_await(result: Any) -> Any:
    """Resolve a redis-py return typed as the sync/async union.

    redis-py annotates its commands as ``Awaitable[T] | T``, which ``await``
    rejects outright; narrowing on the returned object is the honest spelling
    of "this client is async".
    """
    if inspect.isawaitable(result):
        return await result
    return result


async def _hset(redis: aioredis.Redis, key: str, mapping: dict[str, str]) -> None:
    await _maybe_await(redis.hset(key, mapping=mapping))


# The per-terminal route is claimed and released by two server-side scripts so
# each is ONE atomic round trip. The bind runs inside the listener task, which
# ``release_source`` cancels: as four separate commands, a cancel landing
# between ``HSETNX`` and ``EXPIREAT`` left a busy terminal key with no TTL —
# forever. The release is compare-and-delete: an expired in-memory attachment
# dropped lazily must not delete a key another grant has since bound to the
# same terminal, which would break the one-holder invariant.
#
# BIND — KEYS[1] terminal key; ARGV[1] source_device_id, ARGV[2] grant_jti,
# ARGV[3] exp. Returns 1 when this grant holds the key afterwards (fresh claim
# or its own re-bind), 0 when another grant holds it.
BIND_TERMINAL_SCRIPT = """
local holder = redis.call('HGET', KEYS[1], 'grant_jti')
if holder and holder ~= ARGV[2] then
  return 0
end
redis.call('HSET', KEYS[1],
  'source_device_id', ARGV[1], 'grant_jti', ARGV[2], 'exp', ARGV[3])
redis.call('EXPIREAT', KEYS[1], tonumber(ARGV[3]))
return 1
"""

# RELEASE — KEYS[1] terminal key; ARGV[1] grant_jti. Deletes the key only
# while THIS grant holds it; returns the number of keys deleted (0 or 1).
RELEASE_TERMINAL_SCRIPT = """
if redis.call('HGET', KEYS[1], 'grant_jti') == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
"""


async def _eval(redis: aioredis.Redis, script: str, key: str, *args: str) -> int:
    """Run one of the module's scripts against a single key; the integer reply."""
    return int(await _maybe_await(redis.eval(script, 1, key, *args)))


def claim_key(grant_jti: str) -> str:
    """Redis key of the atomic single-use grant claim (a string, ``SET NX EXAT``)."""
    return f"remote_attach:claim:{grant_jti}"


def grant_key(grant_jti: str) -> str:
    """Redis key of the per-grant attachment record."""
    return f"remote_attach:grant:{grant_jti}"


def terminal_key(target_device_id: str, terminal_id: str) -> str:
    """Redis key of the per-terminal return-route record."""
    return f"remote_attach:{target_device_id}:{terminal_id}"


def response_channel(target_device_id: str) -> str:
    """The target's EXISTING runner→mobile response channel."""
    return f"runner:terminal_response:{target_device_id}"


def remote_response_channel(target_device_id: str) -> str:
    """The remote-only channel for target frames no mobile watcher consumes."""
    return f"runner:remote_terminal_response:{target_device_id}"


class RelayRegistry:
    """One attachment's Redis keys: the single-use claim, the grant record, and
    the per-terminal return route. Leaf of the collaborator graph (plan D2)."""

    def __init__(self, core: RelayCore) -> None:
        self.core = core

    async def _claim_grant(self, att: _Attachment) -> bool:
        """Atomically claim the grant for this attachment; False when held.

        ``SET NX EXAT`` in one round trip: the claim can never outlive the
        grant, and a second presentation — on this socket, another socket, or
        another replica — reads False while the first attachment is live.
        """
        redis = await self.core._get_redis()
        ok = await _maybe_await(
            redis.set(
                claim_key(att.grant_jti), att.source_device_id, nx=True, exat=att.exp
            )
        )
        return bool(ok)

    async def _write_grant_record(self, att: _Attachment) -> None:
        redis = await self.core._get_redis()
        record: dict[str, str] = {
            "source_device_id": att.source_device_id,
            "target_device_id": att.target_device_id,
            "target_session_id": att.target_session_id or "",
            "kind": att.kind,
            "exp": str(att.exp),
            "request_id": att.request_id or "",
            "requested_terminal_id": att.requested_terminal_id or "",
            "terminal_id": "",
        }
        await _hset(redis, grant_key(att.grant_jti), mapping=record)
        await redis.expireat(grant_key(att.grant_jti), att.exp)

    async def _bind_terminal(self, att: _Attachment, terminal_id: str) -> bool:
        """Claim the ``(target, terminal)`` route for this grant; False when busy.

        One atomic round trip (``BIND_TERMINAL_SCRIPT``): the key is never
        observable half-written or without its TTL. On success the in-memory
        record is updated HERE, before any further await, so a teardown that
        runs next releases the key instead of leaking it until the grant's
        expiry.
        """
        redis = await self.core._get_redis()
        key = terminal_key(att.target_device_id, terminal_id)
        bound = await _eval(
            redis,
            BIND_TERMINAL_SCRIPT,
            key,
            att.source_device_id,
            att.grant_jti,
            str(att.exp),
        )
        if not bound:
            return False
        att.terminal_id = terminal_id
        att.attached = True
        await _hset(
            redis, grant_key(att.grant_jti), mapping={"terminal_id": terminal_id}
        )
        return True

    async def _release_registry(self, att: _Attachment) -> None:
        """Delete the attachment's keys; the terminal key only while ours.

        **A CREATE's claim key is NOT deleted.** ``SET NX EXAT`` made it expire
        with the grant, so leaving it is what "one grant, one spawn" means for
        the 15 minutes the grant lives. Deleting it here freed the jti the
        instant the create completed, and the only barriers left were a
        PROCESS-LOCAL tombstone on the target and coord's ``consumed_at`` —
        which a single detached no-retry POST sets. A coord blip during that
        POST plus a target restart inside the TTL let the source replay the
        identical frame into a second PTY, repeatably, once per restart.

        Attach keeps the delete: re-presenting an attach grant is the documented
        reattach path, not a replay.
        """
        redis = await self.core._get_redis()
        if att.kind == KIND_CREATE:
            await redis.delete(grant_key(att.grant_jti))
        else:
            await redis.delete(claim_key(att.grant_jti), grant_key(att.grant_jti))
        if att.terminal_id is not None:
            await _eval(
                redis,
                RELEASE_TERMINAL_SCRIPT,
                terminal_key(att.target_device_id, att.terminal_id),
                att.grant_jti,
            )
