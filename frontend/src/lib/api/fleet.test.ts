import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `/settings/fleet` designates test hosts through `designateTestTarget` /
 * `undesignateTestTarget`. The backend refuses a device the selected project
 * is not bound to (409 `device_not_bound_to_project`) and a removal whose row
 * lives in another project (409 `designation_in_other_project`), with a message
 * naming the project and the fix. Production wraps that in the error envelope
 * — `error` + `message` at the TOP level — which the old `detail`-only parse
 * never read, so the page showed only "Failed to designate test host". Plan
 * `2026-09-30-test-host-designation-put-stamps-a-tenant-the-device-is-not-bound-to`.
 */

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const { designateTestTarget, undesignateTestTarget } = await import("./fleet");

const NOT_BOUND =
  "Device 'build-box' is not bound to project \"Acme\" ... Bind the device " +
  'to "Acme", or switch to a project the device is bound to, then designate ' +
  "it again.";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("fleet designation refusals", () => {
  it("surfaces the envelope message of a not-bound refusal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "device_not_bound_to_project",
        message: NOT_BOUND,
        timestamp: 1,
        path: "x",
      })
    );
    await expect(designateTestTarget("dev-1", "web", false)).rejects.toThrow(
      NOT_BOUND
    );
  });

  it("surfaces the other-project refusal on removal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        error: "designation_in_other_project",
        message: 'recorded under project "Home"',
      })
    );
    await expect(undesignateTestTarget("dev-1", "web")).rejects.toThrow(
      'recorded under project "Home"'
    );
  });

  it.each([
    ["designation_not_removed", "coord removed nothing: still recorded"],
    ["coord_failed", "coord failed to change the designation (500)."],
    ["designation_in_other_project", 'recorded under project "Home"'],
  ])("unwraps the %s message", async (code, message) => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: code, message }));
    await expect(designateTestTarget("dev-1", "web", false)).rejects.toThrow(
      message
    );
  });

  it("keeps the fallback for an envelope whose code is not a designation refusal", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(500, { error: "internal_error", message: "boom" })
    );
    await expect(designateTestTarget("dev-1", "web", false)).rejects.toThrow(
      "Failed to designate test host"
    );
  });

  it("still reads a string `detail`", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { detail: "nope" }));
    await expect(undesignateTestTarget("dev-1", "web")).rejects.toThrow("nope");
  });
});
