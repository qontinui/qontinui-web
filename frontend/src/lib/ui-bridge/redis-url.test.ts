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
  ])("accepts %s", (url) => {
    expect(isParseableRedisUrl(url)).toBe(true);
  });

  it.each([
    "default:SEC/RET@host.example:6379",
    "redis://default:SEC/RET@host.example:6379",
    "redis://host:notaport",
    "",
  ])("rejects %j", (url) => {
    expect(isParseableRedisUrl(url)).toBe(false);
  });
});
