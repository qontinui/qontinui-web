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

  it("scrubs a password the pattern cannot delimit (unencoded slash)", () => {
    vi.stubEnv("UI_BRIDGE_RELAY_REDIS_URL", "default:sec/ret@h:6379");
    expect(redactRedisSecrets("oops sec/ret here")).not.toContain("sec/ret");
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
