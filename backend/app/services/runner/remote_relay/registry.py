"""Redis registry primitives of the remote-terminal relay.

The key and channel builders, the two atomic Lua scripts that bind and release
the per-terminal return route, and the thin helpers that run them against the
sync/async union redis-py types its commands with. Functions only; the relay
itself (``app.services.runner.remote_terminal_relay``) owns the client.
"""

from __future__ import annotations

import inspect
from typing import Any

from redis import asyncio as aioredis


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
