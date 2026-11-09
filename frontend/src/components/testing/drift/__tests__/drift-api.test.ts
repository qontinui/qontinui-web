/**
 * The drift client's URLs and its refusal predicate.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { get: (...args: unknown[]) => getMock(...args) },
}));

import { PLATFORM_ADMIN_REFUSAL } from "@/lib/api/fleet";
import {
  fetchDriftEntry,
  fetchDriftReport,
  isDriftAdminRefusal,
  isDriftNotFound,
  retryDriftRead,
} from "../drift-api";

const rejection = (status: number, body: string) =>
  new Error(`GET /api/v1/runs/r/drift failed: ${status} - ${body}`);

describe("drift client URLs", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("keeps each id inside its own segment", async () => {
    await fetchDriftReport("run?x");
    await fetchDriftEntry("run?x", "a/b#c");

    expect(getMock.mock.calls).toEqual([
      ["/api/v1/runs/run%3Fx/drift"],
      ["/api/v1/runs/run%3Fx/drift/a%2Fb%23c"],
    ]);
  });
});

describe("isDriftAdminRefusal", () => {
  it.each([
    ["the error envelope's message", { message: PLATFORM_ADMIN_REFUSAL }],
    ["a bare app's detail", { detail: PLATFORM_ADMIN_REFUSAL }],
  ])("recognises %s", (_name, body) => {
    expect(isDriftAdminRefusal(rejection(403, JSON.stringify(body)))).toBe(
      true
    );
  });

  it.each<[string, unknown]>([
    ["another 403's sentence", rejection(403, '{"message":"Forbidden"}')],
    ["a proxy's HTML 403", rejection(403, "<html>blocked</html>")],
    [
      "the sentence on another status",
      rejection(500, JSON.stringify({ message: PLATFORM_ADMIN_REFUSAL })),
    ],
    ["a network error", new TypeError("Failed to fetch")],
    ["no error at all", null],
  ])("does not take %s for it", (_name, err) => {
    expect(isDriftAdminRefusal(err)).toBe(false);
  });
});

describe("isDriftNotFound", () => {
  it.each(["drift-report-not-found", "drift-entry-not-found"])(
    "recognises the runner's %s",
    (sentence) => {
      const err = rejection(404, JSON.stringify({ message: sentence }));
      expect(isDriftNotFound(err)).toBe(true);
    }
  );

  it.each<[string, unknown]>([
    ["a route that is not there", rejection(404, '{"detail":"Not Found"}')],
    [
      "the sentence on another status",
      rejection(502, '{"message":"drift-report-not-found"}'),
    ],
    ["a page that is not JSON", rejection(404, "<html>")],
    ["a network error", new TypeError("Failed to fetch")],
  ])("does not take %s for it", (_name, err) => {
    expect(isDriftNotFound(err)).toBe(false);
  });
});

describe("retryDriftRead", () => {
  it.each([401, 403, 404, 422])("does not ask again after a %i", (status) => {
    expect(retryDriftRead(0, rejection(status, "{}"))).toBe(false);
  });

  it("asks again after a 5xx or a transport failure, up to three times", () => {
    expect(retryDriftRead(2, rejection(503, "{}"))).toBe(true);
    expect(retryDriftRead(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(retryDriftRead(3, rejection(503, "{}"))).toBe(false);
  });
});
