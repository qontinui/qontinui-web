import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";

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

const {
  PLATFORM_ADMIN_REFUSAL,
  designateTestTarget,
  isPlatformAdminRefusal,
  undesignateTestTarget,
} = await import("./fleet");

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

/**
 * The fleet UI shows its "limited to platform administrators" state only for
 * the backend's `require_admin` refusal, recognised by its exact sentence. If
 * `PLATFORM_ADMIN_REFUSAL` and the backend's `ADMIN_REQUIRED_DETAIL` drift
 * apart, every non-admin sees a generic load error instead, and the page and
 * panel tests stay green because their fixtures carry this side's sentence.
 * So this reads the backend's assignment itself; the backend's
 * `tests/test_fleet_apps_platform_admin_gate.py` reads `fleet.ts` the same way.
 */
describe("the platform-admin refusal sentence", () => {
  // src/lib/api -> the repo root is four levels up.
  const REPO_ROOT = join(__dirname, "../../../..");
  const ADMIN_DEPS_PATH = "backend/app/api/admin_deps.py";
  const ADMIN_DEPS = join(REPO_ROOT, ADMIN_DEPS_PATH);
  const FRONTEND_CI = join(REPO_ROOT, ".github/workflows/frontend-ci.yml");

  it("is the sentence the backend's require_admin refuses with", () => {
    const source = readFileSync(ADMIN_DEPS, "utf8");
    const assignment = /^ADMIN_REQUIRED_DETAIL = "([^"\\]*)"$/m.exec(source);
    expect(
      assignment,
      `${ADMIN_DEPS} no longer assigns ADMIN_REQUIRED_DETAIL on one line; retarget this check rather than deleting it`
    ).not.toBeNull();
    const backendSentence = assignment![1];

    expect(PLATFORM_ADMIN_REFUSAL).toBe(backendSentence);
    // Recognised in both shapes the sentence arrives in: production's error
    // envelope (`message`) and a bare FastAPI app (`detail`).
    expect(isPlatformAdminRefusal(403, { message: backendSentence })).toBe(
      true
    );
    expect(isPlatformAdminRefusal(403, { detail: backendSentence })).toBe(true);
  });

  // Frontend CI is path-filtered. Without admin_deps.py in both filters, a
  // backend-only PR that reshapes the assignment runs no Frontend CI, and the
  // check above first fails on a later, unrelated frontend PR.
  it("runs in the PR that changes admin_deps.py alone", () => {
    const workflow = parseYaml(readFileSync(FRONTEND_CI, "utf8")) as {
      on?: Record<string, { paths?: unknown } | undefined>;
    };
    for (const trigger of ["pull_request", "push"]) {
      const paths = workflow.on?.[trigger]?.paths;
      expect(
        Array.isArray(paths) ? paths : null,
        `frontend-ci.yml has no on.${trigger}.paths list`
      ).not.toBeNull();
      expect(
        paths,
        `${ADMIN_DEPS_PATH} is not in frontend-ci.yml on.${trigger}.paths, so a change to it alone never runs the check above`
      ).toContain(ADMIN_DEPS_PATH);
    }
  });
});
