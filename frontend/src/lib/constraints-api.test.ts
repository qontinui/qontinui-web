/**
 * The constraints routes are for platform admins only (coord finding
 * `5a6791e9-607c-4658-82e2-3b509e459996`). `isConstraintsAdminRefusal` is
 * what lets the UI render the backend's `require_admin` refusal as an
 * admin-only state rather than as a failure; anything else that fails must
 * stay a failure, with the backend's sentence as its reason.
 *
 * `httpClient.fetch` is mocked at the service boundary; the bodies are the
 * production error envelope (`error` + `message` at the top level, the typed
 * refusal nested under `refusal`) and a bare FastAPI app's `{ detail }`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    fetch: (...args: unknown[]) => fetchMock(...args),
  },
}));

const {
  ConstraintsApiError,
  fetchActiveConstraints,
  fetchConstraintConfig,
  isConstraintsAdminRefusal,
  saveConstraintConfig,
} = await import("./constraints-api");
const { PLATFORM_ADMIN_REFUSAL } = await import("@/lib/api/fleet");

function respond(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type":
        typeof body === "string" ? "text/html" : "application/json",
    },
  });
}

/** The production 403 `require_admin` answers a non-admin with. */
const ADMIN_REFUSAL_ENVELOPE = {
  error: "FORBIDDEN",
  message: PLATFORM_ADMIN_REFUSAL,
  timestamp: 1790000000,
  path: "https://api.test/api/v1/constraints/active",
  refusal: {
    code: "permission_denied",
    discriminator: "platform_admin_required",
    next_action: { kind: "none_terminal" },
    glossary_terms: [],
    detail: PLATFORM_ADMIN_REFUSAL,
    observed_at: "2026-10-27T12:00:00+00:00",
    source: "web_backend",
  },
};

const UNREACHABLE =
  "The runner on this backend's host is not reachable. Start the desktop " +
  "runner, then try again.";

async function failureOf(call: Promise<unknown>): Promise<unknown> {
  try {
    await call;
  } catch (err) {
    return err;
  }
  throw new Error("expected the call to fail");
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("the platform-admin refusal", () => {
  it("is recognised in the production envelope", async () => {
    fetchMock.mockResolvedValue(respond(403, ADMIN_REFUSAL_ENVELOPE));

    const err = await failureOf(fetchActiveConstraints());

    expect(err).toBeInstanceOf(ConstraintsApiError);
    expect(isConstraintsAdminRefusal(err)).toBe(true);
    expect((err as Error).message).toBe(
      `Failed to fetch active constraints: ${PLATFORM_ADMIN_REFUSAL}`
    );
  });

  it("is recognised in a bare app's detail", async () => {
    fetchMock.mockResolvedValue(
      respond(403, { detail: PLATFORM_ADMIN_REFUSAL })
    );

    const err = await failureOf(saveConstraintConfig("[c]\n", "/srv/acme"));

    expect(isConstraintsAdminRefusal(err)).toBe(true);
  });

  it.each([
    ["another 403's JSON", 403, { message: "Forbidden by policy" }],
    ["a proxy's HTML 403", 403, "<html>403 Forbidden</html>"],
    [
      "the sentence on another status",
      401,
      { message: PLATFORM_ADMIN_REFUSAL },
    ],
  ])("is not %s", async (_label, status, body) => {
    fetchMock.mockResolvedValue(respond(status, body));

    const err = await failureOf(fetchConstraintConfig());

    expect(err).toBeInstanceOf(ConstraintsApiError);
    expect(isConstraintsAdminRefusal(err)).toBe(false);
  });

  it("is not an error that never came from the backend", () => {
    expect(isConstraintsAdminRefusal(new Error(PLATFORM_ADMIN_REFUSAL))).toBe(
      false
    );
  });
});

describe("a failed constraints call", () => {
  it("names the backend's own sentence as its reason", async () => {
    fetchMock.mockResolvedValue(
      respond(502, {
        error: "BAD_GATEWAY",
        message: UNREACHABLE,
        refusal: { discriminator: "constraints_runner_unreachable" },
      })
    );

    const err = await failureOf(fetchActiveConstraints());

    expect(isConstraintsAdminRefusal(err)).toBe(false);
    expect((err as Error).message).toBe(
      `Failed to fetch active constraints: ${UNREACHABLE}`
    );
    expect((err as InstanceType<typeof ConstraintsApiError>).status).toBe(502);
  });

  it("names the status when the body has no sentence", async () => {
    fetchMock.mockResolvedValue(respond(500, { unexpected: true }));

    const err = await failureOf(fetchActiveConstraints());

    expect((err as Error).message).toBe(
      "Failed to fetch active constraints: HTTP 500"
    );
  });
});

describe("a read the workflow builder makes", () => {
  it("sends no project_path, so the runner uses its workspace root", async () => {
    fetchMock.mockResolvedValue(
      respond(200, { success: true, data: { toml: "", path: null } })
    );

    await expect(fetchConstraintConfig()).resolves.toEqual({
      toml: "",
      path: null,
    });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(
      /\/api\/v1\/constraints\/config$/
    );
  });
});
