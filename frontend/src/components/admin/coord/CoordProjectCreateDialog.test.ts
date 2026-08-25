/**
 * Unit tests for the create-project error surface.
 *
 * Plan `2026-08-25-self-service-tenant-project-creation`, Phase 3. The copy
 * is not what breaks here — the PARSING is. Coord's machine-readable code
 * travels through two envelopes (FastAPI's `{detail: ...}`, and coord's own
 * JSON carried inside it as a STRING because `_proxy_coord_post` forwards
 * `resp.text`), so a naive one-level parse would find no code and flatten
 * every distinct failure into the same generic message.
 */

import { describe, expect, it } from "vitest";
import {
  parseTenantCreateError,
  TenantCreateError,
} from "@/components/sessions/api";
import { projectCreateErrorMessage } from "./CoordProjectCreateDialog";

describe("parseTenantCreateError", () => {
  it("unwraps coord's code out of the doubly-wrapped body", () => {
    const body = JSON.stringify({
      detail: '{"error":"slug_taken","slug":"my-pizzeria"}',
    });
    expect(parseTenantCreateError(409, body)).toEqual({
      code: "slug_taken",
      detail: "slug_taken",
    });
  });

  it("prefers coord's own message over the bare code", () => {
    const body = JSON.stringify({
      detail:
        '{"error":"invalid_name","message":"name has no usable characters"}',
    });
    expect(parseTenantCreateError(400, body)).toEqual({
      code: "invalid_name",
      detail: "name has no usable characters",
    });
  });

  it("degrades to the raw text when coord answered plain text", () => {
    const body = JSON.stringify({ detail: "coord is not reachable" });
    expect(parseTenantCreateError(502, body)).toEqual({
      code: null,
      detail: "coord is not reachable",
    });
  });

  it("degrades to the whole body when nothing is JSON at all", () => {
    expect(parseTenantCreateError(500, "<html>502 Bad Gateway</html>")).toEqual(
      {
        code: null,
        detail: "<html>502 Bad Gateway</html>",
      }
    );
  });

  it("survives a FastAPI 422 validation list without inventing a code", () => {
    const body = JSON.stringify({
      detail: [{ loc: ["body", "display_name"], msg: "too short" }],
    });
    const parsed = parseTenantCreateError(422, body);
    expect(parsed.code).toBeNull();
    expect(parsed.detail).toContain("too short");
  });
});

describe("projectCreateErrorMessage", () => {
  it("names a taken name rather than a generic failure", () => {
    const err = new TenantCreateError(409, "slug_taken", "slug_taken");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name is taken. Pick a different one."
    );
  });

  it("treats a bare 409 as a collision even without a parsed code", () => {
    const err = new TenantCreateError(409, null, "");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name is taken. Pick a different one."
    );
  });

  it("tells the user a name is unusable instead of mangling it", () => {
    const err = new TenantCreateError(400, "invalid_name", "invalid_name");
    expect(projectCreateErrorMessage(err)).toBe(
      "That name can't be used — try letters and numbers."
    );
  });

  it("recognizes the per-operator creation cap", () => {
    const err = new TenantCreateError(403, "tenant_cap_reached", "cap reached");
    expect(projectCreateErrorMessage(err)).toBe(
      "You've reached the limit on how many projects you can create."
    );
    const byStatus = new TenantCreateError(429, null, "too many");
    expect(projectCreateErrorMessage(byStatus)).toBe(
      "You've reached the limit on how many projects you can create."
    );
  });

  it("surfaces an unrecognized failure VERBATIM rather than guessing", () => {
    const err = new TenantCreateError(503, "app_unconfigured", "SSO is down");
    expect(projectCreateErrorMessage(err)).toBe(
      "Could not create the project (503): SSO is down"
    );
  });

  it("handles a non-HTTP failure (the fetch itself threw)", () => {
    expect(projectCreateErrorMessage(new Error("NetworkError"))).toBe(
      "NetworkError"
    );
    expect(projectCreateErrorMessage("nope")).toBe(
      "Could not reach the server to create the project."
    );
  });
});
