/**
 * /admin/coord/members — adding a colleague is ONE form, by email.
 *
 * Plan `2026-09-15-simplify-tenant-member-add-by-email` Phase 2. This file
 * replaces the (absent) coverage of `InviteForm`, the raw-Cognito-`sub` panel
 * it deletes, and pins the four properties that make the replacement an
 * improvement rather than a re-skin:
 *
 * 1. **The wire carries an email and a role — nothing else.** The old form
 *    posted `sso_subject` + `sso_provider`; a regression that re-introduced
 *    either would be invisible in a screenshot and fatal to the whole point
 *    (console style guide R8, "no internal vocabulary on a primary surface").
 *    The assertion is on the ABSENCE of those keys, not only on the presence
 *    of the two wanted ones — a body carrying all four would otherwise pass.
 *
 * 2. **The three response arms render distinctly.** `added` says access
 *    exists; `invite_required` says — in words — that NOTHING happened and no
 *    email was sent, because Phase 3 has not shipped and every other product's
 *    "invite by email" does send one; `409` says the email is ambiguous, in the
 *    wording the Cognito group member-add already uses for the same condition.
 *
 * 3. **The `invite_required` arm does not lie.** Asserting that its copy
 *    *contains* an honest sentence is not enough — a panel that said "no
 *    invitation email was sent yet, we'll email them shortly" would pass that.
 *    The test also asserts the reassuring vocabulary is ABSENT and that no
 *    success toast fired.
 *
 * 4. **The primary form is not inside the Advanced panel**, and that panel is
 *    folded on arrival. The whole change is worthless if the one form an
 *    administrator needs is one click further away than the SSO-group
 *    machinery it was promoted over.
 *
 * Stub conventions follow the sibling files in this directory.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchMock = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: vi.fn(),
  },
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

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

let calls: Call[] = [];
/** How `POST /coord/tenant-members` answers. */
let addResponse: { status: number; body: unknown };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function operator(email: string) {
  return {
    operator_id: `op-${email}`,
    email,
    display_name: null,
    sso_provider: null,
    last_login_at: null,
    created_at: "2026-08-01T00:00:00Z",
    roles: ["admin"],
  };
}

function installRouter() {
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      let body: Record<string, unknown> | null = null;
      if (typeof init?.body === "string") {
        body = JSON.parse(init.body) as Record<string, unknown>;
      }
      calls.push({ method, path, body });

      if (path.endsWith("/coord/tenant-members")) {
        return jsonResponse(addResponse.status, addResponse.body);
      }
      if (path.endsWith("/coord/members")) {
        return jsonResponse(200, { operators: [operator("ops@example.com")] });
      }
      if (path.endsWith("/coord/my-tenants")) {
        return jsonResponse(200, { home_tenant_id: null, tenants: [] });
      }
      if (path.endsWith("/coord/group-tenant-roles")) {
        return jsonResponse(200, { group_tenant_roles: [] });
      }
      if (path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(200, { groups: [] });
      }
      return jsonResponse(200, {});
    }
  );
}

const addCalls = () =>
  calls.filter(
    (c) => c.method === "POST" && c.path.endsWith("/coord/tenant-members")
  );

const memberReads = () =>
  calls.filter((c) => c.method === "GET" && c.path.endsWith("/coord/members"));

/** Type an email into the primary form and submit it. */
async function submitEmail(
  user_: ReturnType<typeof userEvent.setup>,
  email: string
): Promise<void> {
  await user_.type(await screen.findByTestId("add-member-email"), email);
  await user_.click(screen.getByTestId("add-member-submit"));
}

beforeEach(() => {
  vi.clearAllMocks();
  // `CollapsiblePanel` persists open/closed to localStorage; without this the
  // Advanced-panel test would inherit an earlier test's click.
  window.localStorage.clear();
  calls = [];
  addResponse = { status: 200, body: { status: "added", operator_id: "op-1" } };
  installRouter();
});

// ---------------------------------------------------------------------------
// The wire contract
// ---------------------------------------------------------------------------

describe("Add a member by email — the request", () => {
  it("posts only an email and a role, never an IdP subject or provider", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    await waitFor(() => expect(addCalls()).toHaveLength(1));
    const body = addCalls()[0].body ?? {};
    expect(body).toEqual({ email: "colleague@example.com", role: "operator" });
    // Belt and braces: `toEqual` above already forbids extra keys, but naming
    // the two the old form sent makes a re-introduction fail by NAME.
    expect(body).not.toHaveProperty("sso_subject");
    expect(body).not.toHaveProperty("sso_provider");
  });

  it("refuses an empty email without calling the backend", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await user_.click(await screen.findByTestId("add-member-submit"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(addCalls()).toHaveLength(0);
  });

  it("trims the typed email before sending it", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "  spaced@example.com  ");

    await waitFor(() => expect(addCalls()).toHaveLength(1));
    expect(addCalls()[0].body?.email).toBe("spaced@example.com");
  });
});

// ---------------------------------------------------------------------------
// Arm 1 — added
// ---------------------------------------------------------------------------

describe("Add a member by email — the `added` arm", () => {
  it("names the grant and the tier, and reloads the members table", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await waitFor(() => expect(memberReads().length).toBeGreaterThan(0));
    const readsBefore = memberReads().length;

    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() => expect(outcome.textContent ?? "").toMatch(/granted/i));
    expect(outcome.textContent ?? "").toMatch(/colleague@example\.com/);
    // The tier is part of the sentence: "granted access" without it does not
    // say WHAT they can do.
    expect(outcome.textContent ?? "").toMatch(/developer/i);
    expect(toastSuccess).toHaveBeenCalled();
    // The refetch stays — for a colleague homed in this tenant the row does
    // appear, and needing a manual reload would be its own defect.
    await waitFor(() =>
      expect(memberReads().length).toBeGreaterThan(readsBefore)
    );
    // The field is cleared: the task is done, and a left-over address invites
    // a second, duplicate submit.
    expect(
      (screen.getByTestId("add-member-email") as HTMLInputElement).value
    ).toBe("");
  });

  it("does not promise a row in a table that lists by HOME tenant", async () => {
    // `GET /coord/members` proxies coord's operator list, which is
    // `WHERE o.tenant_id = $1` — the operator's HOME tenant, not their role
    // memberships — and the upsert behind this form never moves `tenant_id`
    // on conflict. So a colleague already homed in another tenant IS granted
    // the role and does NOT appear below. Copy that says otherwise sends the
    // administrator hunting for a row that will never render, and the honest
    // arm is the one that survives that case.
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() => expect(outcome.textContent ?? "").toMatch(/granted/i));
    const text = outcome.textContent ?? "";
    // The caveat is present and says which way the list is scoped.
    expect(text).toMatch(/home tenant/i);
    expect(text).toMatch(/may not appear/i);
    // And it is not alarming: the grant worked, and the copy says so.
    expect(text).toMatch(/granted either way/i);
    // The wording it must never go back to — a flat claim of presence.
    expect(text).not.toMatch(/they are (now )?in the (list|table)/i);
    expect(text).not.toMatch(/appears? below/i);
  });
});

// ---------------------------------------------------------------------------
// Arm 2 — invite_required (honest placeholder; Phase 3 is not in this pass)
// ---------------------------------------------------------------------------

describe("Add a member by email — the `invite_required` arm", () => {
  beforeEach(() => {
    addResponse = { status: 200, body: { status: "invite_required" } };
  });

  it("says nothing happened and no email was sent", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "newbie@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/no invitation email was sent/i)
    );
    const text = outcome.textContent ?? "";
    expect(text).toMatch(/newbie@example\.com/);
    expect(text).toMatch(/nothing was added/i);
    expect(text).toMatch(/not built yet/i);
    // It must not read as a success.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not imply an invitation is on its way", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "newbie@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/no invitation email was sent/i)
    );
    const text = outcome.textContent ?? "";
    // The vocabulary of a flow that DID send something. "no invitation email
    // was sent" passes a naive contains-check for honesty; these do not.
    expect(text).not.toMatch(/check (their|your) inbox/i);
    expect(text).not.toMatch(/we('ve| have)? (just )?emailed/i);
    expect(text).not.toMatch(/invitation sent/i);
    expect(text).not.toMatch(/shortly/i);
  });

  it("points the administrator at what does work today", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "newbie@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/sign up/i)
    );
    // And names the other door, by the label it actually carries on the page.
    expect(outcome.textContent ?? "").toMatch(
      /advanced: auto-provision by sso group/i
    );
  });

  it("keeps the typed address, because nothing was created", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "newbie@example.com");

    await screen.findByTestId("add-member-outcome");
    expect(
      (screen.getByTestId("add-member-email") as HTMLInputElement).value
    ).toBe("newbie@example.com");
  });
});

// ---------------------------------------------------------------------------
// Arm 3 — 409 ambiguous email
// ---------------------------------------------------------------------------

describe("Add a member by email — the ambiguous-email 409", () => {
  it("mirrors the wording the Cognito group member-add already uses", async () => {
    addResponse = {
      status: 409,
      body: { detail: "ambiguous_email" },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "shared@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(
        /ambiguous email — more than one cognito user matches\. resolve in cognito first\./i
      )
    );
    expect(toastError).toHaveBeenCalledWith(
      "Ambiguous email — more than one Cognito user matches. Resolve in Cognito first."
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Anything else the backend can answer
// ---------------------------------------------------------------------------

describe("Add a member by email — responses that are neither arm", () => {
  it("renders the backend's sentence on a failure, not a bare status", async () => {
    addResponse = {
      status: 403,
      body: { detail: "You do not administer that tenant." },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(
        /you do not administer that tenant/i
      )
    );
    expect(outcome.textContent ?? "").not.toMatch(/HTTP 403/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("reads the PRODUCTION error envelope, which has no `detail` key", async () => {
    // What a browser actually receives. `app/main.py` registers
    // `middleware/error_handler.http_exception_handler` for every
    // `StarletteHTTPException`, and it rewrites the body into
    // `{error, message, timestamp, path}` — there is NO `detail`. A reader
    // that only knows `detail` rendered `HTTP 403` here, which is precisely
    // the reason this route opted into `structured_errors=True` in the first
    // place: to get `not_admin_in_target_tenant` in front of the operator.
    addResponse = {
      status: 403,
      body: {
        error: "not_admin_in_target_tenant",
        message: "coord refused this (403): not_admin_in_target_tenant",
        timestamp: 1_760_000_000,
        path: "http://localhost/api/v1/operations/coord/tenant-members",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/not_admin_in_target_tenant/i)
    );
    expect(outcome.textContent ?? "").not.toMatch(/HTTP 403/);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("falls back to the envelope's `error` code when it carries no message", async () => {
    // A code is a poor sentence and a far better answer than a bare status:
    // it is the string an operator searches for.
    addResponse = { status: 502, body: { error: "coord_unreachable" } };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/coord_unreachable/)
    );
    expect(outcome.textContent ?? "").not.toMatch(/HTTP 502/);
  });

  it("refuses to render a 2xx with no known status as a success", async () => {
    addResponse = { status: 200, body: { ok: true } };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await submitEmail(user_, "colleague@example.com");

    const outcome = await screen.findByTestId("add-member-outcome");
    await waitFor(() =>
      expect(outcome.textContent ?? "").toMatch(/unexpected response/i)
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Layout — the primary form is primary, and the old one is gone
// ---------------------------------------------------------------------------

describe("/admin/coord/members — section layout", () => {
  it("shows the add form immediately and keeps the Advanced panel folded", async () => {
    render(<MembersPage />);

    // The primary form needs no click at all.
    await screen.findByTestId("add-member-email");
    expect(screen.getByTestId("add-member-role")).toBeInTheDocument();
    expect(screen.getByTestId("add-member-submit")).toBeInTheDocument();

    const advanced = await screen.findByRole("button", {
      name: /advanced: auto-provision by sso group/i,
    });
    expect(advanced.getAttribute("data-state")).toBe("closed");
    // Radix unmounts a closed panel's content, so this is also the assertion
    // that both SSO-group sections start out of the way.
    expect(screen.queryByTestId("coord-members-group-roles")).toBeNull();
    expect(screen.queryByTestId("coord-members-cognito-groups")).toBeNull();
  });

  it("does not nest the primary form inside the Advanced panel", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", {
        name: /advanced: auto-provision by sso group/i,
      })
    );
    const panel = await screen.findByTestId("coord-members-advanced");
    // Both SSO-group sections ARE in there …
    await waitFor(() =>
      expect(
        within(panel).getByTestId("coord-members-group-roles")
      ).toBeInTheDocument()
    );
    expect(
      within(panel).getByTestId("coord-members-cognito-groups")
    ).toBeInTheDocument();
    // … and the add form is NOT.
    expect(within(panel).queryByTestId("add-member-email")).toBeNull();
    expect(screen.getByTestId("add-member-email")).toBeInTheDocument();
  });

  it("no longer offers a Cognito subject or SSO provider field anywhere", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await screen.findByTestId("add-member-email");

    // Before opening anything …
    expect(screen.queryByTestId("invite-sso-subject")).toBeNull();
    expect(screen.queryByTestId("invite-sso-provider")).toBeNull();
    expect(screen.queryByTestId("coord-members-invite")).toBeNull();

    // … and with the Advanced panel open, where the IdP machinery now lives.
    await user_.click(
      screen.getByRole("button", {
        name: /advanced: auto-provision by sso group/i,
      })
    );
    await screen.findByTestId("coord-members-advanced");
    expect(screen.queryByTestId("invite-sso-subject")).toBeNull();
    expect(screen.queryByTestId("invite-sso-provider")).toBeNull();
    expect(screen.queryByText(/cognito subject/i)).toBeNull();
  });
});
