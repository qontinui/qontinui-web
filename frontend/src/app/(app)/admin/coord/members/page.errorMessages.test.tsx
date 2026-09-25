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

  it("refuses gateway HTML that arrives NESTED and falls through to the code", async () => {
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
    //
    // What it shows once the HTML is refused is the rung BELOW: the envelope
    // always carries a machine `error` beside its human `message`, so a
    // refused `message` is a fact about that value and not about the body.
    // Here the code is `get_default_error_code(502)`, no more informative than
    // the status — but the same fallthrough is what turns a 500 whose
    // `message` is a gateway page into `cognito_pool_misconfigured` instead of
    // `HTTP 500`, and the rule has to be one rule.
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

    expect(await screen.findByText("BAD_GATEWAY")).toBeTruthy();
    expect(screen.queryByText(/nginx/)).toBeNull();
    expect(screen.queryByText(/<html/)).toBeNull();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });

  it("refuses a Python repr of a dict rather than printing its quotes", async () => {
    // `http_exception_handler` emits `str(detail_value)` when a dict detail
    // carries `error` but no `message`, so what arrives is a Python repr —
    // single quotes, therefore not JSON, therefore it would fall through the
    // recursion's parse and out of the catch arm as "text". That is the exact
    // leak `_readable_coord_refusal` exists to stop server-side.
    //
    // As with the nested-HTML case above, the refused `message` falls through
    // to the envelope's `error` rather than ending the search at the status.
    //
    // `error` is coord's OWN code here rather than a generic `FORBIDDEN`,
    // because that is the shape this rung exists for: asserting `FORBIDDEN`
    // would assert `403` spelled out and undersell the fix.
    //
    // The two CAN co-occur, and an earlier revision of this comment claimed
    // they could not. `http_exception_handler`'s dict branch is gated on
    // `isinstance(dict) and "error" in detail_value`, so a dict detail with NO
    // `error` key falls to the `else`, which sets a generic code from the
    // status AND a repr `message` from `str(exc.detail)`. `_coord_error_detail`
    // passes any coord JSON object through verbatim, and coord is not obliged
    // to send an `error`. That body is handled correctly too — the repr is
    // refused and rung 5 answers the generic code — it is just not the shape
    // worth pinning here.
    responses["GET /coord/members"] = {
      status: 403,
      body: {
        error: "not_admin_in_target_tenant",
        message: "{'error': 'not_admin_in_target_tenant'}",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText("not_admin_in_target_tenant")).toBeTruthy();
    expect(screen.queryByText(/'error'/)).toBeNull();
    expect(screen.queryByText(/\{/)).toBeNull();
    expect(screen.queryByText("HTTP 403")).toBeNull();
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

// ---------------------------------------------------------------------------
// A REFUSED candidate falls through to the next rung, never straight to the
// status — and the guard reaches every rung, including the one `details` takes
// ---------------------------------------------------------------------------

/**
 * Follow-up to web #1378, which introduced the `plainSentence` guard and then
 * treated its refusal as the END of extraction rather than as a fact about one
 * value. Three shapes lost information the previous code delivered, and a
 * fourth kept leaking through the one branch the guard did not reach.
 *
 * The first is a REGRESSION, measured against `9d639412b^`: the backend
 * composes operator prose on purpose, and the 300-character ceiling sat below
 * its own sentences.
 */
describe("A refused candidate falls through to the next rung", () => {
  /**
   * Byte-for-byte the 502 sentence `_raise_mapping_check_unreadable` composes
   * (`operations.py`), with `reason` set to `the body carries no mapped_total`
   * — one of the strings `_verdict_count` actually passes it.
   *
   * **457 characters**, and the template is 425 with an empty `reason`, so
   * every producible form of this sentence was refused wholesale by the
   * 300-character ceiling.
   *
   * Spelled out rather than generated because the test is about THIS backend's
   * real copy: a synthetic `"x".repeat(400)` would pin the number and not the
   * reason, and the number is the thing that was wrong. Transcribe it from the
   * backend if that copy moves — an earlier revision of this fixture invented
   * its closing clause while claiming to be byte-for-byte, which is the defect
   * this comment exists to stop repeating.
   */
  const REAL_BACKEND_SENTENCE =
    "Refused: coord answered without an error status, but the body is not " +
    "its group blast-radius verdict (the body carries no mapped_total), so " +
    "there is no way to tell what this delete would break. Nothing was " +
    "deleted. An unreadable answer is UNKNOWN, not 'this group has no " +
    "mappings' — treating it as the latter would let the delete through with " +
    "every guard unchecked. Something answered where coord should have, so " +
    "check coord's route AND anything proxying it.";

  const GATEWAY_HTML =
    "<html><head><title>502 Bad Gateway</title></head><body>" +
    "<center><h1>502 Bad Gateway</h1></center><hr>" +
    "<center>nginx</center></body></html>";

  it("shows a 457-character backend sentence, which the 300 ceiling ate", async () => {
    // REGRESSION GUARD. Before #1378 this sentence reached the operator
    // verbatim; after it, every message over 300 characters rendered as the
    // bare status — including on the delete-group refusals, which are the
    // page's most consequential messages and the longest it composes.
    // Pin the LENGTH, not just "over 300". The comment above asks the next
    // author to re-transcribe this if the backend copy moves; without an exact
    // assertion it asks them for a favour instead of failing when they skip it.
    expect(REAL_BACKEND_SENTENCE).toHaveLength(457);
    responses["GET /coord/members"] = {
      status: 502,
      body: {
        // The code the backend actually emits: `http_exception_handler`
        // promotes the dict detail's own `error`, which is lowercase.
        error: "mapping_check_unreadable",
        message: REAL_BACKEND_SENTENCE,
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText(/Nothing was deleted\./)).toBeTruthy();
    expect(screen.queryByText("HTTP 502")).toBeNull();
    expect(screen.queryByText("No members yet.")).toBeNull();
  });

  it("BOUNDS an over-long body instead of refusing it", async () => {
    // The counterpart to the sentence above, and the reason length is not in
    // the refusal list. Guards 1 and 3 interpolate `_render_affected`, a
    // `", ".join(named)` over a tenant list with NO upper bound, so no ceiling
    // can be "big enough — and refusing on length loses a real refusal for a
    // heavily-mapped group. Truncating keeps the beginning  — where the
    // tenants and the instruction are  — and still bounds the toast.
    responses["GET /coord/members"] = {
      status: 500,
      body: {
        error: "INTERNAL_SERVER_ERROR",
        message: "a".repeat(3000),
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    const shown = await screen.findByText(/a{50}/);
    // `.trim()` because the element's text node carries the surrounding
    // markup's whitespace; the assertion is about the VALUE, not the layout.
    const text = (shown.textContent ?? "").trim();
    // Bounded, and visibly cut. 2001 is the ceiling plus the ellipsis.
    expect(text).toHaveLength(2001);
    expect(text.endsWith("…")).toBe(true);
    expect(text.startsWith("a".repeat(100))).toBe(true);
  });

  it("reaches the real code when the sentence beside it is a gateway page", async () => {
    // The case the fallthrough exists for. `_cognito_http_error` raises a dict
    // detail whose `error` is a genuine diagnostic, so when a proxy replaces
    // the sentence with an HTML page the code one key over is still the true
    // answer — and `HTTP 500` was not.
    responses["POST /coord/members/op-1/roles"] = {
      status: 500,
      body: {
        error: "cognito_pool_misconfigured",
        message: GATEWAY_HTML,
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("cognito_pool_misconfigured");
    expect(text).not.toContain("nginx");
    expectNoEnvelopeScaffolding(text);
  });

  it("guards the `details` branch too, which returned its value verbatim", async () => {
    // #1378's round 2 found the guard sitting one level too shallow and moved
    // it into the unwrap arm — but the 422 arm composed `${sentence}: ${field}`
    // from a value that had ALREADY fallen back to the raw `message`, so a
    // refused body walked straight out through the one branch carrying a
    // `details` array. A guard has to hold on every path out, not on most.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        error: "VALIDATION_ERROR",
        message: GATEWAY_HTML,
        details: [{ field: "body.role", message: "not a valid tier" }],
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).not.toContain("<html");
    expect(text).not.toContain("nginx");
    // Rung 5 answered, with the field decorating it: `VALIDATION_ERROR:
    // body.role — not a valid tier`. The field standing ALONE is rung 6, which
    // this body does not reach because it carries an `error` — see the
    // FastAPI-422 test below, which does.
    expect(text).toContain("VALIDATION_ERROR");
    expect(text).toContain("body.role — not a valid tier");
  });

  it("refuses a JSON ARRAY body, the brace-blob one bracket along", async () => {
    // `_proxy_coord_get` sets `detail=resp.text`, so coord answering with a
    // JSON array puts that array in the slot a sentence belongs in. The brace
    // guard did not match it, and it printed raw.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        detail: JSON.stringify([
          { loc: ["body", "role"], msg: "field required", type: "missing" },
        ]),
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).not.toContain("loc");
    expect(text).not.toContain("[{");
    expect(text).toContain("HTTP 422");
  });

  it("still shows a legitimate sentence that merely BEGINS with a bracket", async () => {
    // The control for the array guard. It decides by PARSING, so anything that
    // is not a valid JSON array is prose — including a sentence that opens
    // with a bracketed token. Two earlier spellings of this guard were pattern
    // matches, and each was wrong in one direction: `[` plus a quote or brace
    // let `[]` through, and "closing bracket then whitespace" refused
    // `[admin]: not a valid tier` and a Cognito group legitimately named
    // `[acme]-home`.
    responses["GET /coord/members"] = {
      status: 400,
      body: {
        error: "BAD_REQUEST",
        message: "[admin] is not a valid tier",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(await screen.findByText("[admin] is not a valid tier")).toBeTruthy();
  });

  it("guards coord's `hint`, the second path out that faced no guard", async () => {
    // `_readable_coord_refusal` composes `<code> — <hint|reason|detail>` and
    // this rung mirrors it, so `hint` is coord's own string and arrives the
    // same way every other value here does " through `detail=resp.text`. It
    // was returned unguarded, so all four refusal classes walked out through
    // it, and an unbounded `hint` defeated the ceiling on the ordinary
    // coord-proxy path.
    responses["POST /coord/members/op-1/roles"] = {
      status: 502,
      body: {
        error: "BAD_GATEWAY",
        message: JSON.stringify({
          error: "repo_has_no_remote",
          hint:
            "<html><head><title>502 Bad Gateway</title></head><body>" +
            "<center>nginx</center></body></html>",
          reason: "add a remote first",
        }),
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).not.toContain("<html");
    expect(text).not.toContain("nginx");
    // A refused `hint` falls through to `reason` rather than ending the rung,
    // so the actionable half still reaches the operator.
    expect(text).toContain(`repo_has_no_remote — add a remote first`);
  });

  it("guards coord's `status` on a 2xx the build does not recognise", async () => {
    // `POST /coord/tenant-members` proxies coord's body through, so a 200 with
    // an arm this build does not know reports coord's `status` string. It is
    // body-controlled and used to face only `typeof === "string"`, so an HTML
    // or oversized value rendered whole into BOTH a paragraph and a toast.
    responses["POST /coord/tenant-members"] = {
      status: 200,
      body: { status: "<html><center>nginx</center></html>" },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.type(
      await screen.findByTestId("add-member-email"),
      "colleague@example.com"
    );
    await user_.click(screen.getByTestId("add-member-submit"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).not.toContain("<html");
    expect(text).not.toContain("nginx");
    // `unreadable`, not `missing`: a value that was SENT and could not be
    // shown is a different fact from one that never arrived, and an operator
    // grepping coord's logs for a dropped field should not be sent after one
    // that was there.
    expect(text).toContain("status: unreadable");
  });

  it("says `missing` only when coord really sent no status", async () => {
    // The other half of the distinction above.
    responses["POST /coord/tenant-members"] = { status: 200, body: {} };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.type(
      await screen.findByTestId("add-member-email"),
      "colleague@example.com"
    );
    await user_.click(screen.getByTestId("add-member-submit"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(lastErrorToast()).toContain("status: missing");
  });

  it("prefers the COMPOSED message over a coord `detail` beside it", async () => {
    // `http_exception_handler` splices every key except `error` and `message`
    // to the top level, and `detail` is NOT reserved among them: it is one of
    // the three keys `_readable_coord_refusal` reads from coord
    // (`for key in ("hint", "reason", "detail")`). So a composed envelope can
    // carry a sibling `detail` that is coord's metadata rather than FastAPI's
    // detail, and ranking it first returned the least useful of the three
    // strings and dropped the error code with it.
    responses["POST /coord/members/op-1/roles"] = {
      status: 409,
      body: {
        error: "role_not_grantable",
        message:
          "coord refused this (409): role_not_grantable — grant admin first",
        hint: "grant admin first",
        detail: "tenant_id=7f3a1c20-0000-4000-8000-000000000000",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("role_not_grantable");
    expect(text).toContain("grant admin first");
    expect(text).not.toContain("tenant_id=7f3a1c20");
  });

  it("still reads a bare `detail` when there is no composed envelope", async () => {
    // The control: FastAPI's own default handler sends `detail` and nothing
    // else, and that is still rung 1. The envelope test above must not be
    // read as "a `detail` is never a sentence".
    responses["POST /coord/members/op-1/roles"] = {
      status: 409,
      body: { detail: "A tenant must keep one administrator." },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(lastErrorToast()).toContain("A tenant must keep one administrator.");
  });

  it("composes coord's `hint` under `detail` as it does when spliced", async () => {
    // One body, two backends: a deployed one splices `hint` beside `error` at
    // the top level and rung 5 composes `<code> — <hint>`; a middleware-less
    // one (a test app, a local dev server) leaves it under `detail`. That arm
    // read only `message`/`error` and dropped the actionable half, so the same
    // refusal answered two different ways depending on which backend ran.
    responses["POST /coord/members/op-1/roles"] = {
      status: 409,
      body: {
        detail: { error: "repo_has_no_remote", hint: "add a remote first" },
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    expect(lastErrorToast()).toContain(
      `repo_has_no_remote — add a remote first`
    );
  });

  it("shows prose that opens AND closes with a bracket but is not JSON", async () => {
    // The control that pins the PARSE rather than the `startsWith`/`endsWith`
    // pre-filter. Both other bracket controls end in a word or a full stop, so
    // they never reach `JSON.parse` — a pure pattern match would pass them and
    // the whole suite with them, which is exactly the spelling this guard was
    // changed away from twice.
    responses["GET /coord/members"] = {
      status: 502,
      body: {
        error: "BAD_GATEWAY",
        message:
          "[error] connection refused by upstream [dial tcp 10.0.0.1:443]",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(
      await screen.findByText(
        "[error] connection refused by upstream [dial tcp 10.0.0.1:443]"
      )
    ).toBeTruthy();
  });

  it("does not cut a surrogate pair in half when it truncates", async () => {
    // `slice` counts UTF-16 code units, so a cut landing between the halves of
    // an astral character leaves an orphan that renders as a replacement
    // glyph, and `trimEnd()` will not remove it because it is not whitespace.
    // 1999 ASCII characters put the boundary exactly inside the emoji.
    responses["GET /coord/members"] = {
      status: 500,
      body: {
        error: "INTERNAL_SERVER_ERROR",
        message: "a".repeat(1999) + "\u{1F600}" + "b".repeat(100),
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    const shown = await screen.findByText(/a{50}/);
    const text = (shown.textContent ?? "").trim();
    // No unpaired surrogate, in either direction, survived the cut.
    expect(text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(text).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("bounds a SENTENCE and a FIELD composed together, not just each half", async () => {
    // Each half is capped at the ceiling independently, so their composition
    // reaches twice it unless the composed return is bounded too. Pins the
    // `bounded(...)` on rung 4 specifically: with the halves at 1500 each,
    // every per-half guard is satisfied and only the outer one can cut it.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        error: "VALIDATION_ERROR",
        message: "p".repeat(1500),
        details: [{ field: "f".repeat(700), message: "m".repeat(700) }],
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members/op-1/roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    // "Grant failed: " is the call site's own prefix; the VALUE is what this
    // bounds, so strip it before measuring.
    const value = lastErrorToast().replace(/^Grant failed: /, "");
    expect(value.length).toBeLessThanOrEqual(2001);
  });

  it("bounds the validation field when it answers ALONE", async () => {
    // Rung 6, reached because this body carries no `error` and no `message`.
    // `firstValidationDetail` composes `${name} — ${reason}` from two halves
    // that are each already capped, so it bounds its own composition rather
    // than leaving three call sites to remember.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        detail: [{ loc: ["b".repeat(1500)], msg: "m".repeat(1500) }],
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const value = lastErrorToast().replace(/^Grant failed: /, "");
    expect(value.length).toBeLessThanOrEqual(2001);
    expect(value.startsWith("b".repeat(100))).toBe(true);
  });

  it("names the orphaned group BEFORE the reason, not after it", async () => {
    // A create-then-map partial failure leaves a pool-wide Cognito group a
    // non-superuser cannot even see. While an over-long reason collapsed to
    // `HTTP 500` the ordering did not matter; now that a long one is truncated
    // rather than refused, a trailing clean-up instruction would sit behind up
    // to 2000 characters in a toast.
    responses["POST /coord/cognito/groups"] = {
      status: 200,
      body: { ok: true },
    };
    responses["POST /coord/group-tenant-roles"] = {
      status: 500,
      body: {
        error: "INTERNAL_SERVER_ERROR",
        message: "z".repeat(1800),
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/group-tenant-roles",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(user_);
    await user_.click(
      await screen.findByRole("button", {
        name: /group . tenant . role mappings/i,
      })
    );

    await user_.type(await screen.findByTestId("map-group-id"), "acme-devs");
    await user_.type(screen.getByTestId("map-tenant-slug"), "acme");
    const alsoCreate = screen.getByTestId("map-also-create-group");
    if (alsoCreate.getAttribute("data-state") !== "checked") {
      await user_.click(alsoCreate);
    }
    await user_.click(screen.getByTestId("map-submit"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    const orphan = text.indexOf("WAS created and is now unmapped");
    const reason = text.indexOf("zzzzzzzzzz");
    expect(orphan).toBeGreaterThan(-1);
    expect(reason).toBeGreaterThan(-1);
    expect(orphan).toBeLessThan(reason);
  });

  it("names the field on FastAPI's OWN 422, which a dev backend answers", async () => {
    // `validation_exception_handler` composes `{field, message}` into a
    // top-level `details`; FastAPI's default handler — what a test app and a
    // local dev backend run — puts `{loc, msg}` straight into `detail`. #1378
    // read only the first, so the second rendered as a bare `HTTP 422` on the
    // arm the reader had just been extended to cover.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        detail: [
          { loc: ["body", "role"], msg: "field required", type: "missing" },
        ],
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).toContain("body.role — field required");
    expect(text).not.toContain("HTTP 422");
  });

  it("refuses an empty or scalar JSON array, not only an array of objects", async () => {
    // The first spelling of this guard matched a bracket followed by `{`, a
    // quote or another bracket, so `[]` and `[1,2,3]` walked through it — the
    // blob one shape further along again, which is the whole argument the
    // guard was added on.
    for (const body of ["[]", "[1,2,3]", '["a","b"]']) {
      vi.clearAllMocks();
      installRouter();
      responses["POST /coord/members/op-1/roles"] = {
        status: 502,
        body: { detail: body },
      };
      const user_ = userEvent.setup();
      const view = render(<MembersPage />);

      await user_.click(await screen.findByTestId("grant-op-1"));

      await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
      const text = lastErrorToast();
      expect(text, `body ${body}`).not.toContain(body);
      expect(text, `body ${body}`).toContain("HTTP 502");
      view.unmount();
    }
  });

  it("shows prose that a pattern-matching array guard wrongly refused", async () => {
    // A Cognito group name may legally begin with `[`:
    // `invalid_group_name_reason` bars whitespace, control characters and
    // >128 length, and nothing else. So Guard 2's refusal for a group named
    // `[acme]-home` opens with a bracket and is ordinary prose. The
    // "closing bracket then whitespace" spelling of this guard refused it and
    // left the operator without the instruction that unblocks them.
    responses["GET /coord/members"] = {
      status: 409,
      body: {
        error: "home_group_requires_override",
        message:
          "[acme]-home pins its members' home tenant to '[acme]'. Pass " +
          "allow_home_group=true to proceed anyway.",
        timestamp: 1758055642.1234,
        path: "https://app.qontinui.io/api/v1/operations/coord/members",
      },
    };
    render(<MembersPage />);

    expect(
      await screen.findByText(/^\[acme\]-home pins its members/)
    ).toBeTruthy();
  });

  it("guards the validation FIELD, the one path out that was never guarded", async () => {
    // `field` is composed from values this file does not control — a `msg`
    // from pydantic, a `message` from `validation_exception_handler` — and it
    // leaves `sentenceFromErrorText` by three separate routes. It was the only
    // returned value that never faced `plainSentence`, and the `loc`/`msg` arm
    // added in this change widened that surface rather than narrowing it.
    responses["POST /coord/members/op-1/roles"] = {
      status: 422,
      body: {
        detail: [
          {
            loc: ["body", "role"],
            msg: "<html><center>nginx</center></html>",
            type: "value_error",
          },
        ],
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(await screen.findByTestId("grant-op-1"));

    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    const text = lastErrorToast();
    expect(text).not.toContain("<html");
    expect(text).not.toContain("nginx");
    // The halves are guarded SEPARATELY, so the refused reason is dropped and
    // the field name — which is safe, and is the specific thing the body knows
    // — still answers. Guarding only the composed string would have passed
    // `body.role — <html>…</html>` whole, because it starts with `body.role`.
    expect(text).toContain("body.role");
  });
});
