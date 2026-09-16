/**
 * /admin/coord/members — the backend's REASON reaches the operator.
 *
 * Post-merge follow-up to web #1377. That PR taught `messageFromErrorBody` to
 * read the production error envelope — `app/main.py` registers
 * `middleware/error_handler.http_exception_handler` for every
 * `StarletteHTTPException`, and it rewrites the body into
 * `{error, message, timestamp, path}` with **no `detail` key at all** — and
 * then wired exactly one new call site through it. Nine were left formatting
 * their own status.
 *
 * This file pins FIVE of those nine — the two that decide who has access
 * (grant, revoke), the third mutation (delete mapping), and two section reads
 * (members, my-tenants) — plus the unwrap rule that all nine depend on. The
 * remaining four (`page.tsx`'s group-tenant-roles read, the Cognito groups
 * read, the second group-tenant-roles read inside the Cognito section, and the
 * per-group member-count probe) go through the identical one-line guard and
 * the same helper; they are not separately pinned, and saying so is cheaper
 * than a header that claims a coverage the file does not have.
 *
 * ## Two failure shapes, and why the second is the worse one
 *
 * Six READS threw a bare `HTTP ${res.status}`, discarding the sentence
 * outright: a section that said `HTTP 502` for a backend answering
 * `coord is unreachable`. Bad, but at least not a lie.
 *
 * Three MUTATIONS — grant role, revoke role, delete mapping — appended the raw
 * body instead, so in production the operator got the entire envelope pasted
 * into a toast:
 *
 * ```
 * Grant failed: HTTP 403 {"error":"INSUFFICIENT_PERMISSIONS","message":
 * "{\"error\":\"not_admin_in_target_tenant\"}","timestamp":1758055642.1,
 * "path":"https://…/coord/members/op-1/roles"}
 * ```
 *
 * A float and a URL in an error toast is `[object Object]` one shape along,
 * and it landed on the two controls that change who has access.
 *
 * ## The body-in-a-body, which is the ORDINARY shape here
 *
 * Note the doubly-encoded `message` above — it is not a contrivance. Only
 * `POST /coord/tenant-members` goes through `_proxy_coord_post_readable`;
 * every other route this page calls is a plain coord proxy, and all three of
 * those helpers raise `HTTPException(detail=resp.text)`, i.e. coord's WHOLE
 * body as one string. `http_exception_handler` copies a string detail into
 * `message` untouched, so `message` IS a JSON document for seven of the nine
 * sites.
 *
 * A reader that stops at `message` therefore still hands the operator
 * `{"error":"not_admin_in_target_tenant"}`. `coordProxyEnvelope` below models
 * that real shape; `readableEnvelope` models the composed one. Both are
 * exercised, because a fixture that only carried the composed shape would let
 * the brace-blob back in while the suite stayed green — which is exactly how
 * the first draft of this file passed.
 *
 * ## Reading these tests
 *
 * Each asserts in BOTH directions — the reason is present AND the envelope
 * scaffolding is gone. Asserting only the reason would stay green on the old
 * code, because `HTTP 403 {"error":…}` contains it: the defect was never a
 * missing reason, it was a reason buried in machine noise. The
 * `"timestamp":` / `"path":` / brace assertions are what actually fail on a
 * revert, and they are spelled as regexes against the JSON punctuation rather
 * than as substring checks for the English words `path` and `timestamp`, which
 * a legitimate backend sentence may contain.
 *
 * `renders the code when the envelope carries no sentence` is the positive
 * control for the `error`-only rung: coord's typed refusals
 * (`not_admin_in_target_tenant`) travel with no `message` of their own unless
 * `_readable_coord_refusal` composes one, so a helper that only read `message`
 * would fall back to the status on precisely the refusals this page exists to
 * render.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

const fetchMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({
    isCoordAdmin: true,
    user: { is_superuser: true },
    loading: false,
  }),
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import MembersPage from "./page";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * A production error body from a route that COMPOSED a sentence —
 * `_proxy_coord_post_readable` / `_cognito_http_error`. No `detail` key, and
 * the two fields that made the old mutation toasts unreadable.
 */
function readableEnvelope(error: string, message?: string) {
  return {
    error,
    ...(message === undefined ? {} : { message }),
    timestamp: 1758055642.1234,
    path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
  };
}

/**
 * A production error body from a PLAIN coord proxy — the shape seven of the
 * nine rewired sites actually produce.
 *
 * `_proxy_coord_get` / `_proxy_coord_post(structured_errors=False)` /
 * `_proxy_coord_delete` all raise `HTTPException(detail=resp.text)`, so the
 * inner value is coord's entire response body as a STRING, and
 * `http_exception_handler` copies a string detail into `message` verbatim
 * while stamping its own generic `error` code beside it.
 */
function coordProxyEnvelope(coordBody: Record<string, unknown>) {
  return {
    error: "INSUFFICIENT_PERMISSIONS",
    message: JSON.stringify(coordBody),
    timestamp: 1758055642.1234,
    path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
  };
}

const OPERATOR = {
  operator_id: "op-1",
  email: "colleague@example.com",
  display_name: null,
  sso_provider: null,
  last_login_at: null,
  created_at: "2026-08-01T00:00:00Z",
  roles: ["admin"],
};

/** One group → tenant → role mapping, so the Advanced panel has a row whose
 * Delete can fail. Its testid key is `${group_id}:${tenant_slug}:${role}`. */
const MAPPING = {
  group_id: "acme-devs",
  tenant_slug: "acme",
  role: "operator",
  auto_create_tenant: false,
  created_at: "2026-08-01T00:00:00Z",
  tenant_id: "t-1",
};

/** Per-path overrides; anything unset answers with a healthy empty read. */
let responses: Record<string, { status: number; body: unknown }>;

/** Open the collapsed "Advanced: auto-provision by SSO group" wrapper. */
async function openAdvanced(
  user_: ReturnType<typeof userEvent.setup>
): Promise<void> {
  const outer = await screen.findByRole("button", {
    name: /advanced: auto-provision by sso group/i,
  });
  if (outer.getAttribute("data-state") !== "open") await user_.click(outer);
}

function installRouter() {
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      for (const [key, res] of Object.entries(responses)) {
        const [m, suffix] = key.split(" ");
        if (m === method && path.endsWith(suffix)) {
          return jsonResponse(res.status, res.body);
        }
      }
      if (path.endsWith("/coord/members")) {
        return jsonResponse(200, { operators: [OPERATOR] });
      }
      if (path.endsWith("/coord/my-tenants")) {
        return jsonResponse(200, { home_tenant_id: null, tenants: [] });
      }
      if (path.endsWith("/coord/group-tenant-roles")) {
        return jsonResponse(200, { group_tenant_roles: [MAPPING] });
      }
      if (path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(200, { groups: [] });
      }
      return jsonResponse(200, {});
    }
  );
}

/** The text of the most recent `toast.error`. */
function lastErrorToast(): string {
  const mock = vi.mocked(toast.error);
  expect(mock.mock.calls.length).toBeGreaterThan(0);
  return String(mock.mock.calls[mock.mock.calls.length - 1][0]);
}

/**
 * Nothing machine-facing survived into operator-facing text. These are the
 * assertions that red on a revert.
 *
 * Spelled against the JSON punctuation (`"timestamp":`) rather than the bare
 * words: a legitimate backend sentence may say "no path to that tenant", and a
 * substring check for `path` would red this suite for the wrong reason — which
 * looks like coverage and is not.
 */
function expectNoEnvelopeScaffolding(text: string): void {
  expect(text).not.toMatch(/"timestamp"\s*:/);
  expect(text).not.toMatch(/"path"\s*:/);
  expect(text).not.toMatch(/"error"\s*:/);
  expect(text).not.toContain("{");
}

beforeEach(() => {
  vi.clearAllMocks();
  // `CollapsiblePanel` persists open/closed to localStorage.
  window.localStorage.clear();
  responses = {};
  installRouter();
});

// ---------------------------------------------------------------------------
// The mutations — the toast is the whole surface
// ---------------------------------------------------------------------------

describe("Grant / revoke — the refusal reaches the toast, the envelope does not", () => {
  it("surfaces the envelope's sentence on a failed grant", async () => {
    responses["POST /coord/members/op-1/roles"] = {
      status: 403,
      // The real wire for this route: a plain coord proxy, so coord's whole
      // body arrives as a STRING inside the envelope's `message`.
      body: coordProxyEnvelope({
        error: "not_coord_tenant_admin",
        message: "You are not an administrator of this tenant.",
      }),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("You are not an administrator of this tenant.");
    expectNoEnvelopeScaffolding(text);
  });

  it("renders the code when the envelope carries no sentence", async () => {
    // Coord's typed refusals arrive as `{"error": "..."}` with no `message`.
    // `not_admin_in_target_tenant` is a poor sentence and a far better answer
    // than `HTTP 403` — it is the string an operator searches for.
    responses["POST /coord/members/op-1/roles"] = {
      status: 403,
      body: coordProxyEnvelope({ error: "not_admin_in_target_tenant" }),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("not_admin_in_target_tenant");
    expectNoEnvelopeScaffolding(text);
  });

  it("surfaces the envelope's sentence on a failed revoke", async () => {
    responses["DELETE /coord/members/op-1/roles"] = {
      status: 409,
      body: coordProxyEnvelope({
        error: "last_admin",
        message: "A tenant must keep one administrator.",
      }),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    // The revoke control lives in the row expansion.
    await user_.click(await screen.findByText("colleague@example.com"));
    await user_.click(await screen.findByTestId("revoke-op-1-admin"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("A tenant must keep one administrator.");
    expectNoEnvelopeScaffolding(text);
  });

  it("surfaces the reason on a failed mapping delete", async () => {
    // The third mutation named in this file's header, and the one inside the
    // folded Advanced panel — so it is the easiest of the three to leave
    // untested while believing all three are covered.
    responses["DELETE /coord/group-tenant-roles"] = {
      status: 409,
      body: coordProxyEnvelope({
        error: "mapping_in_use",
        message: "That mapping still has members provisioned through it.",
      }),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await openAdvanced(user_);
    await user_.click(
      await screen.findByRole("button", {
        name: /group → tenant → role mappings/i,
      })
    );
    await user_.click(
      await screen.findByTestId("delete-mapping-acme-devs:acme:operator")
    );

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain(
      "That mapping still has members provisioned through it."
    );
    expectNoEnvelopeScaffolding(text);
  });

  it("surfaces a COMPOSED refusal from the add-by-email route", async () => {
    // The other proxy shape: `POST /coord/tenant-members` goes through
    // `_proxy_coord_post_readable`, so its `message` is already a sentence and
    // must NOT be unwrapped, re-parsed, or otherwise touched.
    responses["POST /coord/tenant-members"] = {
      status: 403,
      body: readableEnvelope(
        "not_admin_in_target_tenant",
        "coord refused this (403): not_admin_in_target_tenant"
      ),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.type(
      await screen.findByTestId("add-member-email"),
      "someone@example.com"
    );
    await user_.click(screen.getByTestId("add-member-submit"));

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toContain(
        "coord refused this (403): not_admin_in_target_tenant"
      )
    );
    expectNoEnvelopeScaffolding(outcome.textContent ?? "");
  });

  it("names the offending field on a 422 instead of 'Invalid request data'", async () => {
    // `validation_exception_handler` puts the same generic sentence on every
    // 422 and the only specific thing it knows in a sibling `details` array.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        error: "VALIDATION_ERROR",
        message: "Invalid request data",
        details: [
          { field: "body.role", message: "unexpected value", type: "enum" },
        ],
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("body.role");
    expect(text).toContain("unexpected value");
    expectNoEnvelopeScaffolding(text);
  });
});

// ---------------------------------------------------------------------------
// The reads — the section's error paragraph, not a bare status
// ---------------------------------------------------------------------------

describe("Section reads — the error paragraph carries the reason", () => {
  it("shows the backend's sentence instead of `HTTP 502` on the members read", async () => {
    responses["GET /coord/members"] = {
      status: 502,
      body: coordProxyEnvelope({
        error: "coord_unreachable",
        message: "coord did not answer in time.",
      }),
    };
    render(<MembersPage />);

    expect(
      await screen.findByText("coord did not answer in time.")
    ).toBeTruthy();
    expect(screen.queryByText("HTTP 502")).toBeNull();
    // The absence claim must not appear beside a read that never landed.
    expect(screen.queryByText("No members yet.")).toBeNull();
  });

  it("shows the backend's sentence on the `my-tenants` read", async () => {
    responses["GET /coord/my-tenants"] = {
      status: 403,
      body: coordProxyEnvelope({
        error: "tenant_not_resolved",
        message: "No coord tenant for this user.",
      }),
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    // "Your tenant & roles" is `defaultOpen={false}`, and Radix unmounts a
    // collapsed body — so the error paragraph does not exist until the panel
    // is opened. (The collapsed header's own `unknown` badge is pinned by
    // `page.sectionReadFailures.test.tsx`; what is under test here is the
    // sentence inside.)
    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );

    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toContain("No coord tenant for this user.")
    );
    expect(card.textContent ?? "").not.toContain("HTTP 403");
  });

  it("refuses a gateway HTML page and shows the status instead", async () => {
    // A load balancer or reverse proxy answers with an HTML error page, not
    // JSON and not a sentence. Rendering it verbatim into the section's `<p>`
    // is the brace-blob defect one shape further along — React escapes it, so
    // the operator reads `<html><head><title>502 Bad Gateway…` as prose.
    const html =
      "<html><head><title>502 Bad Gateway</title></head><body>" +
      "<center><h1>502 Bad Gateway</h1></center>" +
      "<hr><center>nginx</center></body></html>";
    // The shared router is NOT used here: `jsonResponse` JSON-stringifies,
    // which would make the body a QUOTED JSON string rather than raw HTML, and
    // then `JSON.parse` would succeed on it. Override the mock wholesale so
    // the wire is what a gateway really sends.
    fetchMock.mockImplementation(async (url: string) => {
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      if (path.endsWith("/coord/members")) {
        return {
          ok: false,
          status: 502,
          text: async () => html,
          json: async () => {
            throw new Error("not json");
          },
        } as unknown as Response;
      }
      return jsonResponse(200, {
        operators: [],
        tenants: [],
        group_tenant_roles: [],
        groups: [],
      });
    });
    render(<MembersPage />);

    expect(await screen.findByText("HTTP 502")).toBeTruthy();
    expect(screen.queryByText(/nginx/)).toBeNull();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });

  it("refuses gateway HTML that arrives NESTED, which is the likelier level", async () => {
    // The level that actually happens. `_proxy_coord_get` sets
    // `detail=resp.text` for any coord status >= 400, so a proxy in front of
    // coord answering 502 with an HTML page puts that HTML inside the
    // envelope's `message`. For HTML to arrive at the TOP level instead, the
    // web backend's own gateway would have to fail — in which case
    // `http_exception_handler` never ran and there is no envelope at all.
    //
    // Guarding only the top level refuses the HTML that is hard to reach and
    // passes the HTML that is easy to, which is why this case exists
    // separately from the one above.
    responses["GET /coord/members"] = {
      status: 502,
      body: {
        error: "BAD_GATEWAY",
        message:
          "<html><head><title>502 Bad Gateway</title></head><body>" +
          "<center><h1>502 Bad Gateway</h1></center>" +
          "<hr><center>nginx</center></body></html>",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText("HTTP 502")).toBeTruthy();
    expect(screen.queryByText(/nginx/)).toBeNull();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });

  it("refuses a Python repr of a dict rather than printing its quotes", async () => {
    // `http_exception_handler` emits `str(detail_value)` when a dict detail
    // carries `error` but no `message`, so what arrives is a Python repr —
    // single quotes, therefore not JSON, therefore it would fall through the
    // recursion's parse and out of the catch arm as "text". That is the exact
    // leak `_readable_coord_refusal` exists to stop server-side.
    responses["GET /coord/members"] = {
      status: 403,
      body: {
        error: "FORBIDDEN",
        message: "{'error': 'not_admin_in_target_tenant'}",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText("HTTP 403")).toBeTruthy();
    expect(screen.queryByText(/'error'/)).toBeNull();
  });

  it("still shows a legitimate sentence that merely BEGINS with a brace", async () => {
    // The control for the repr guard. It matches a brace followed by a QUOTE,
    // so placeholder-style copy must keep working — a guard that ate this
    // would be trading one silent loss for another.
    responses["GET /coord/members"] = {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        message: "{role} is not a valid tier",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText("{role} is not a valid tier")).toBeTruthy();
  });

  it("appends coord's `hint` to a code-only refusal", async () => {
    // `_readable_coord_refusal` composes `<code> — <hint|reason>` server-side.
    // The recursion does client-side what that helper does, so the two must
    // not disagree about which half of coord's body is worth showing: the
    // hint is the actionable half.
    responses["GET /coord/members"] = {
      status: 409,
      body: coordProxyEnvelope({
        error: "repo_has_no_remote",
        hint: "add a remote first",
      }),
    };
    render(<MembersPage />);

    expect(
      await screen.findByText("repo_has_no_remote — add a remote first")
    ).toBeTruthy();
  });

  it("reads `detail.error` when no middleware rewrote the body", async () => {
    // FastAPI's own default handler — which is what a test app that does not
    // register the production middleware produces — passes a structured coord
    // refusal through as `{"detail": {"error": …}}` with no `message`. Reading
    // `error` there is what makes the two environments answer alike, and
    // without this case that rung ships unexercised.
    responses["GET /coord/members"] = {
      status: 403,
      body: { detail: { error: "not_admin_in_target_tenant" } },
    };
    render(<MembersPage />);

    expect(await screen.findByText("not_admin_in_target_tenant")).toBeTruthy();
    expect(screen.queryByText("HTTP 403")).toBeNull();
  });

  it("falls back to the status only when the body carries nothing", async () => {
    // The positive control for the LAST rung. A body with no sentence and no
    // code must still produce the status — degrading everything to a generic
    // string would destroy the signal instead of qualifying it.
    responses["GET /coord/members"] = { status: 500, body: {} };
    render(<MembersPage />);

    expect(await screen.findByText("HTTP 500")).toBeTruthy();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });
});
