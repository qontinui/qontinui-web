import { afterEach, describe, expect, it, vi } from "vitest";

import {
  redactRedisSecrets,
  redisHostOnly,
  safeRedisErrorText,
} from "./redis-redact";

const SCHEMED = "redis://default:secret@host.example:6379";
const SCHEMELESS = "default:secret@host.example:6379";

afterEach(() => vi.unstubAllEnvs());

describe("redisHostOnly", () => {
  it("drops credentials", () => {
    expect(redisHostOnly(SCHEMED)).toBe("host.example:6379");
    expect(redisHostOnly("not a url")).toBe("<unparseable-url>");
  });

  // The relay's degraded-init warning logs this for every URL the strict
  // grammar (redis-url.ts) accepts. A bare `new URL` reads the scheme-less
  // forms' `user:` / `host:` as a SCHEME, so they used to log `<unknown-host>`.
  it("keeps the host of a scheme-less URL, as ioredis reads it", () => {
    expect(redisHostOnly(SCHEMELESS)).toBe("host.example:6379");
    expect(redisHostOnly("host.example:6379")).toBe("host.example:6379");
    expect(redisHostOnly("localhost")).toBe("localhost");
    expect(redisHostOnly("rediss://u:pw@h.example")).toBe("h.example");
    expect(redisHostOnly("REDISS://u:pw@h.example:1/0")).toBe("h.example:1");
    expect(redisHostOnly("//u:pw@h.example:6380")).toBe("h.example:6380");
    expect(redisHostOnly("default:pw@Host.Example:6379")).toBe(
      "Host.Example:6379"
    );
  });

  it("never returns credentials or a socket path", () => {
    for (const url of [SCHEMED, SCHEMELESS, "//default:secret@h:1"]) {
      expect(redisHostOnly(url)).not.toContain("secret");
    }
    expect(redisHostOnly("/var/run/redis.sock")).toBe("<unix-socket>");
  });

  // The grammar accepts a bare token as a one-label hostname, and ioredis
  // reads `user:<digits>/…@h` as host=user, port=<digits>.
  it("withholds a 'host' that is really a pasted password or a username", () => {
    expect(redisHostOnly("AXyzSECRETtoken123")).toBe("<host-withheld>");
    for (const url of [
      "default:12345/SECRETX@h.example:6379",
      "SECRETUSER:4242#pw@h.example",
      "//SECRETUSER:4242/pw@h.example",
      "redis://SECRETUSER:4242/x@h.example",
    ]) {
      const out = redisHostOnly(url);
      expect(out).toBe("<host-withheld>");
    }
    // A one-label host is kept when it carries a port (a compose `redis:6379`).
    expect(redisHostOnly("redis:6379")).toBe("redis:6379");
    expect(redisHostOnly("[::1]:6379")).toBe("[::1]:6379");
  });

  it("substitutes a known secret even inside a host-shaped value", () => {
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "tok.SECRETVALUE.x");
    expect(redisHostOnly("tok.SECRETVALUE.x")).not.toContain("SECRETVALUE");
  });
});

describe("redactRedisSecrets", () => {
  it.each([SCHEMED, SCHEMELESS])("pattern pass scrubs %s", (url) => {
    const out = redactRedisSecrets(`connect failed for ${url} (retry)`);
    expect(out).not.toContain("secret");
    expect(out).toContain("host.example");
  });

  it("scrubs a password-only scheme URL", () => {
    expect(redactRedisSecrets("rediss://secret@h:1")).not.toContain("secret");
  });

  it.each([SCHEMED, SCHEMELESS])(
    "known-secret pass scrubs a bare password from env %s",
    (url) => {
      vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", url);
      const out = redactRedisSecrets("AUTH failed: bad password secret given");
      expect(out).not.toContain("secret");
    }
  );

  it("known-secret pass handles an '@' inside the password", () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "default:sec@ret@h:6379");
    expect(redactRedisSecrets("oops sec@ret here")).not.toContain("sec@ret");
  });

  it("pattern pass handles an '@' inside the password", () => {
    const out = redactRedisSecrets("x redis://default:sec@ret@h.example:6379");
    expect(out).not.toContain("sec");
    expect(out).not.toContain("ret@");
    expect(out).toContain("h.example:6379");
    const bare = redactRedisSecrets("x default:sec@ret@h.example:6379");
    expect(bare).not.toContain("sec@");
    expect(bare).not.toContain("ret@");
  });

  it.each([
    ["after ]", "[err]default:secret@h.example:6379"],
    ["after ;", "failed;default:secret@h.example:6379"],
    ["after :", "failed:default:secret@h.example:6379"],
  ])("scheme-less match %s", (_n, text) => {
    expect(redactRedisSecrets(text)).not.toContain("secret");
  });

  it("does not take userinfo from a path/query '@'", () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "redis://h:6379/0?x=abcdef@b");
    // No bogus secret: ordinary text containing 'abcdef' is untouched.
    expect(redactRedisSecrets("abcdef and h:6379")).toBe("abcdef and h:6379");
  });

  it("skips known-secret substitution for passwords under 4 chars", () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "redis://default:ab@h:6379");
    expect(redactRedisSecrets("a table about abc")).toBe("a table about abc");
  });

  it("false positive accepted: ssh://git@host is masked", () => {
    expect(redactRedisSecrets("ssh://git@github.com")).toBe(
      "ssh://***@github.com"
    );
  });

  it("leaves unrelated text alone", () => {
    expect(redactRedisSecrets("getaddrinfo ENOTFOUND host.example")).toBe(
      "getaddrinfo ENOTFOUND host.example"
    );
  });
});

describe("redactRedisSecrets: ioredis socket-path (ENOENT) messages", () => {
  // ioredis 5.x reads `KEY=rediss://u:p@h`, `"rediss://u:p@h"`, `https://u:p@h`
  // and `u:1234/p@h` as a UNIX SOCKET PATH, so every failed connect reports
  // `connect ENOENT <path>` with the password inside the path (finding
  // 57f04594). Synthetic secrets only.
  it.each([
    ["// path form", "connect ENOENT //default:SEC/RET123@host.example:6379"],
    [
      "// path, quote",
      "connect ENOENT //default:SEC/RET123@host.example:6379%22",
    ],
    ["// path, no @ (cut)", "connect ENOENT //default:SEC/RET123"],
    [
      "// path, alnum pw",
      "connect ENOENT //default:SECRET123@host.example:6379",
    ],
    ["scheme-less / pw", "Invalid URL default:SEC/RET123@host.example:6379"],
    ["scheme, / pw", "bad redis://default:SEC/RET123@host.example:6379"],
    ["single-/ path", "connect ENOENT /SEC/RET123@host.example:6379"],
    ["quote in pw", "connect ENOENT /SEC'RET123@host.example:6379"],
    ["double quote in pw", 'Invalid URL default:SEC"RET123@host.example:6379'],
    ["colon-less userinfo with //", "x SEC//RET123@host.example:6379"],
  ])("pattern pass scrubs the %s", (_n, text) => {
    const out = redactRedisSecrets(text);
    // Every case's password starts with SEC: no part of it may survive.
    expect(out).not.toContain("SEC");
    expect(out).not.toContain("RET123");
    expect(out).not.toContain("SECRET123");
    if (text.includes("@")) expect(out).toContain("@host.example:6379");
  });

  it("keeps the host of a path form so the line stays diagnosable", () => {
    expect(
      redactRedisSecrets(
        "connect ENOENT //default:SEC/RET123@host.example:6379"
      )
    ).toBe("connect ENOENT //***@host.example:6379");
  });

  it("does not substitute a short /-tail of a known password", () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "default:abcd/6379@h.example:6379");
    expect(redactRedisSecrets("connect ECONNREFUSED 10.0.0.1:6379")).toBe(
      "connect ECONNREFUSED 10.0.0.1:6379"
    );
  });

  it("does not mask a credential-free host in a JSON-ish line", () => {
    const line = `{"url":"redis://h.example:6379","x":"y"}`;
    expect(redactRedisSecrets(line)).toBe(line);
  });

  it("does not mask a plain host:port URL", () => {
    expect(redactRedisSecrets("redis://host.example:6379/0 down")).toBe(
      "redis://host.example:6379/0 down"
    );
    expect(redactRedisSecrets("connect ECONNREFUSED 127.0.0.1:6379")).toBe(
      "connect ECONNREFUSED 127.0.0.1:6379"
    );
  });

  it.each([
    "UI_BRIDGE_RELAY_REDIS_URL=rediss://default:SECRETPW123@host.example:6379",
    '"rediss://default:SECRETPW123@host.example:6379"',
    "default:1234/SECRETPW123@host.example:6379",
  ])("known-secret pass resolves the password of %s", (url) => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", url);
    // Bare password text with no userinfo shape around it: only the
    // known-secret pass can catch this.
    const out = redactRedisSecrets("auth said SECRETPW123 was wrong");
    expect(out).not.toContain("SECRETPW123");
  });
});

describe("safeRedisErrorText", () => {
  it("uses only the redacted message, not stack/input", () => {
    const err = Object.assign(new Error(`Invalid URL ${SCHEMELESS}`), {
      input: SCHEMELESS,
    });
    const out = safeRedisErrorText(err);
    expect(out).not.toContain("secret");
  });

  it("handles non-Error values", () => {
    expect(safeRedisErrorText(`bad ${SCHEMED}`)).not.toContain("secret");
  });
});
