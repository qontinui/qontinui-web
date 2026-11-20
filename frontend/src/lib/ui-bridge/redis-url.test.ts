import { describe, expect, it } from "vitest";

import { isParseableRedisUrl } from "./redis-url";

describe("isParseableRedisUrl", () => {
  it.each([
    "redis://default:pw@host.example:6379",
    "rediss://default:pw@host.example:6380/0",
    "default:pw@host.example:6379",
    "host.example:6379",
    "redis://localhost",
    "default:p%2Fw@host.example:6379",
    "REDISS://default:pw@host.example:6379",
    "rediss://:pw@host.example:6379?family=6",
    "redis://[::1]:6379",
    "/tmp/redis.sock",
    // A trailing newline from a dashboard paste: ioredis's WHATWG parse strips it.
    "rediss://default:pw@host.example:6379\n",
    "default:pw@host.example:6379 ",
  ])("accepts %s", (url) => {
    expect(isParseableRedisUrl(url)).toBe(true);
  });

  it.each([
    "default:SEC/RET@host.example:6379",
    "redis://default:SEC/RET@host.example:6379",
    "redis://host:notaport",
    "",
    // Shapes ioredis 5.x reads as a UNIX SOCKET PATH (only redis:// and
    // rediss:// count as a scheme; anything else is prepended with redis://
    // and its pathname becomes `path`), so every failed connect is
    // `connect ENOENT <path>` with the password inside the path text
    // (finding 57f04594). Each passed the old `new URL` check.
    "UI_BRIDGE_RELAY_REDIS_URL=rediss://default:SEC/RET123@host.example:6379",
    "UI_BRIDGE_RELAY_REDIS_URL=rediss://default:SECRET123@host.example:6379",
    '"rediss://default:SECRET123@host.example:6379"',
    "https://default:SECRET123@host.example:6379",
    "default:1234/SECRET123@host.example:6379",
    "default:/SECRET123@host.example:6379",
    "redis:/default:SECRET123@host.example:6379",
    "host.example:6379/0",
    "/default:SECRET123@host.example:6379",
    // A stray character ioredis would mangle or a malformed escape.
    " rediss://default:SECRET123@host.example:6379",
    "default:SEC%zzRET@host.example:6379",
    "redis://default:SECRET123@host.example:99999",
    // Query keys ioredis merges into its options, turning TCP into a socket.
    "redis://default:SECRET123@host.example:6379?path=/tmp/x",
    "redis://default:SECRET123@host.example:6379?host=other",
    "//default:SECRET123@host.example:6379",
    "/tmp/redis.sock\n",
  ])("rejects %j", (url) => {
    expect(isParseableRedisUrl(url)).toBe(false);
  });
});
