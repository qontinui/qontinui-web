import { describe, expect, it } from "vitest";

import {
  browserFamily,
  normalizeErrorMessage,
  scrubFrame,
  scrubHost,
  scrubPathTemplate,
  scrubStack,
} from "./scrub";

const ORIGIN = "https://qontinui.io";

describe("scrubHost", () => {
  it("returns only the host, never path/query/fragment", () => {
    expect(
      scrubHost(
        "https://web.staging.qontinui.io/api/v1/users/me?token=secret#frag",
        ORIGIN
      )
    ).toBe("web.staging.qontinui.io");
  });

  it("resolves relative URLs against the page origin", () => {
    expect(scrubHost("/api/v1/auth/users/me", ORIGIN)).toBe("qontinui.io");
  });

  it("returns undefined for empty / unparseable input with no base", () => {
    expect(scrubHost("")).toBeUndefined();
    // With an explicit (empty) base and a clearly invalid URL, no host resolves.
    expect(scrubHost("h ttp://::bad", "")).toBeUndefined();
  });

  it("never returns the raw input string as-is", () => {
    const raw = "::::not a url::::";
    const out = scrubHost(raw);
    // jsdom may resolve a partial against the page origin; the contract is only
    // that we never emit the raw unparsed string itself.
    expect(out).not.toBe(raw);
  });
});

describe("scrubPathTemplate", () => {
  it("strips query + fragment entirely", () => {
    const t = scrubPathTemplate(
      "https://qontinui.io/projects?token=abc#section",
      ORIGIN
    );
    expect(t).toBe("/projects");
    expect(t).not.toContain("token");
    expect(t).not.toContain("?");
    expect(t).not.toContain("#");
  });

  it("templatizes numeric ids", () => {
    expect(scrubPathTemplate("https://qontinui.io/users/12345", ORIGIN)).toBe(
      "/users/:id"
    );
  });

  it("templatizes uuids", () => {
    expect(
      scrubPathTemplate(
        "https://qontinui.io/sessions/11111111-2222-3333-4444-555555555555",
        ORIGIN
      )
    ).toBe("/sessions/:id");
  });

  it("templatizes emails (PII in path)", () => {
    expect(
      scrubPathTemplate("https://qontinui.io/u/jspinak@gmail.com", ORIGIN)
    ).toBe("/u/:id");
  });

  it("templatizes long opaque tokens", () => {
    const tok = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(scrubPathTemplate(`https://qontinui.io/t/${tok}`, ORIGIN)).toBe(
      "/t/:id"
    );
  });

  it("keeps static route names intact", () => {
    expect(scrubPathTemplate("https://qontinui.io/settings", ORIGIN)).toBe(
      "/settings"
    );
  });
});

describe("normalizeErrorMessage", () => {
  it("DROPS the raw free-text message body (allowlist, not denylist)", () => {
    const raw =
      "Failed to load user jspinak@gmail.com with token eyJhbGciOi...secret";
    const norm = normalizeErrorMessage("TypeError", raw);
    expect(norm).not.toContain("jspinak@gmail.com");
    expect(norm).not.toContain("eyJhbGci");
    expect(norm).not.toContain("secret");
  });

  it("ships only class name when no known shape is present", () => {
    expect(
      normalizeErrorMessage("TypeError", "some user-specific 0xDEADBEEF detail")
    ).toBe("TypeError");
  });

  it("recognizes the worked-example failed-to-fetch shape", () => {
    expect(normalizeErrorMessage("TypeError", "Failed to fetch")).toBe(
      "TypeError:failed_to_fetch"
    );
  });

  it("defaults a missing name to Error", () => {
    expect(normalizeErrorMessage("", undefined)).toBe("Error");
  });
});

describe("scrubFrame", () => {
  it("keeps symbol + file:line, strips host + query from file", () => {
    const f = scrubFrame({
      symbol: "getCurrentUser",
      file: "https://qontinui.io/_next/static/chunk.js?v=abc",
      line: 42,
      column: 7,
    });
    expect(f.symbol).toBe("getCurrentUser");
    expect(f.file).toBe("/_next/static/chunk.js");
    expect(f.file).not.toContain("qontinui.io");
    expect(f.file).not.toContain("?");
    expect(f.line).toBe(42);
  });

  it("drops eval/inline synthetic sources", () => {
    const f = scrubFrame({ symbol: "x", file: "eval at <anonymous>" });
    expect(f.file).toBeUndefined();
  });
});

describe("scrubStack", () => {
  it("parses V8-style stacks to symbol + file:line", () => {
    const stack = [
      "TypeError: Failed to fetch",
      "    at getCurrentUser (https://qontinui.io/_next/app.js:10:5)",
      "    at fetch (https://qontinui.io/_next/app.js:20:3)",
    ].join("\n");
    const frames = scrubStack(stack);
    expect(frames).toHaveLength(2);
    expect(frames[0].symbol).toBe("getCurrentUser");
    expect(frames[0].file).toBe("/_next/app.js");
    expect(frames[1].symbol).toBe("fetch");
  });

  it("parses Firefox/Safari-style stacks", () => {
    const stack = "getCurrentUser@https://qontinui.io/app.js:10:5";
    const frames = scrubStack(stack);
    expect(frames[0].symbol).toBe("getCurrentUser");
    expect(frames[0].line).toBe(10);
  });

  it("returns empty array for undefined stack", () => {
    expect(scrubStack(undefined)).toEqual([]);
  });
});

describe("browserFamily", () => {
  it("classifies coarse families only", () => {
    expect(browserFamily("Mozilla/5.0 ... Chrome/120 Safari/537")).toBe(
      "Chrome"
    );
    expect(browserFamily("Mozilla/5.0 ... Firefox/120")).toBe("Firefox");
    expect(browserFamily("Mozilla/5.0 ... Version/17 Safari/605")).toBe(
      "Safari"
    );
    expect(browserFamily("SomeBot/1.0")).toBe("Other");
  });
});
