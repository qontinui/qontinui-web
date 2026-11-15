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
