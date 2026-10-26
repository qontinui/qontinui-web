/**
 * The presentation scope client's save refusals (plan
 * `2026-10-23-console-presentation-spaces` D3.3). A 409 is one of two
 * refusals of the save's compare-and-set, and the form acts differently on
 * each: a version that moved is re-read and the edit kept for the operator to
 * check; a project that is not the edit's sets the edit aside. The client is
 * what tells them apart, from the backend's `error` code.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const http = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/services/service-factory", () => ({ httpClient: http }));

import { BackendError } from "@/lib/errors/backend-error-message";
import {
  PresentationScopeConflict,
  conflictKindOf,
  savePresentationScope,
} from "./presentationScope";

const WRITE = {
  first_party_owners: null,
  confidential_terms: ["Acme Corp"],
  expected_version: 3,
  expected_tenant_id: "00000000-0000-0000-0000-00000000000a",
};

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => http.fetch.mockReset());

describe("conflictKindOf", () => {
  it.each<[string, string, "version" | "tenant"]>([
    [
      "a version that moved",
      JSON.stringify({ error: "presentation_scope_conflict" }),
      "version",
    ],
    [
      "an edit made for another project",
      JSON.stringify({ error: "presentation_scope_tenant_mismatch" }),
      "tenant",
    ],
    ["a code it does not know", JSON.stringify({ error: "other" }), "version"],
    ["a body that is not JSON", "<html>409</html>", "version"],
    ["a JSON null", "null", "version"],
  ])("reads %s", (_name, text, kind) => {
    expect(conflictKindOf(text)).toBe(kind);
  });
});

describe("savePresentationScope", () => {
  it("rejects a project conflict as one, keeping the backend's sentence", async () => {
    http.fetch.mockResolvedValue(
      answer(409, {
        error: "presentation_scope_tenant_mismatch",
        message:
          "This edit was made for another project than the one now active.",
      })
    );
    const refused = await savePresentationScope(WRITE).catch((e) => e);
    expect(refused).toBeInstanceOf(PresentationScopeConflict);
    expect(refused).toBeInstanceOf(BackendError);
    expect((refused as PresentationScopeConflict).conflict).toBe("tenant");
    expect((refused as PresentationScopeConflict).status).toBe(409);
    expect((refused as Error).message).toContain("another project");
  });

  it("rejects a version conflict as one", async () => {
    http.fetch.mockResolvedValue(
      answer(409, {
        error: "presentation_scope_conflict",
        message: "The presentation scope changed since it was read.",
        current_version: 4,
      })
    );
    const refused = await savePresentationScope(WRITE).catch((e) => e);
    expect((refused as PresentationScopeConflict).conflict).toBe("version");
  });

  it("rejects any other refusal as a plain BackendError with its status", async () => {
    http.fetch.mockResolvedValue(
      answer(403, { error: "forbidden", message: "not_coord_tenant_admin" })
    );
    const refused = await savePresentationScope(WRITE).catch((e) => e);
    expect(refused).toBeInstanceOf(BackendError);
    expect(refused).not.toBeInstanceOf(PresentationScopeConflict);
    expect((refused as BackendError).status).toBe(403);
  });

  it("sends the write as the body of a PUT", async () => {
    http.fetch.mockResolvedValue(answer(200, { tenant_id: "x" }));
    await savePresentationScope(WRITE);
    expect(http.fetch).toHaveBeenCalledWith("/api/v1/presentation/scope", {
      method: "PUT",
      body: JSON.stringify(WRITE),
    });
  });
});
