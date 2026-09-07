/**
 * /admin/coord/members — the Cognito MEMBER routes' reason reaches the operator.
 *
 * Follow-up to web #1130, which finished the backend half of plan
 * `2026-08-27-tenant-creation-fix-and-members-page-ux` Phase 0 item 3: all five
 * Cognito group routes now answer **400 naming the reason** for a `group_name`
 * or member email Cognito rejects as malformed, instead of collapsing it into
 * `502 {"detail":"Could not remove user from group."}`.
 *
 * That is only half a fix. A backend sentence the page throws away, or buries
 * inside `HTTP 400 {"detail":…}`, is not readable by the operator it was
 * written for — and the two member-list call sites were the ones #1130 left on
 * the raw path while converting three others to `backendErrorMessage`.
 *
 * ## What is pinned, and how each would go red
 *
 * 1. **The member READ renders the reason, not the status.** `load` threw
 *    `HTTP ${res.status}`, which discards the body entirely — the section
 *    error rendered as literally `HTTP 400`, the status the backend stopped
 *    relying on precisely because it says nothing. Restoring the bare throw
 *    turns `renders the backend's sentence` red.
 * 2. **The member REMOVE carries ONE prefix, not two.** `removeUser` threw
 *    `HTTP ${res.status} ${text}`, and the `catch` prepends `Remove failed:`,
 *    so the operator read
 *    `Remove failed: HTTP 404 {"detail":"No such Cognito user: …"}`. The
 *    assertions check the reason is present AND that the nested envelope is
 *    absent — otherwise "shows an error" passes on the blob.
 * 3. **A structured detail still resolves to its sentence.** `removeUser` now
 *    shares `backendErrorMessage` with the delete path, so the `{error,
 *    tenants, message}` shape cannot render as `[object Object]` here either.
 *
 * Both behaviours are checked through the toast/section text an operator
 * actually sees, not through the helper — a call site rewired back to
 * `res.text()` would still pass a test that asserted on `backendErrorMessage`.
 *
 * Panel and stub conventions follow `page.cognitoGroupDelete.test.tsx`: the
 * section is a `defaultOpen={false}` `CollapsiblePanel` whose content Radix
 * unmounts while closed, so every test opens it the way an operator does, and
 * `DestructiveButton` is stubbed to a plain button because jsdom cannot
 * produce the trusted click the real one requires.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const GROUP = "qontinui-admins";
const MEMBER = { username: "u-1", email: "ops@example.com", status: "CONFIRMED", enabled: true };

/** How `GET .../users` answers. */
let listResponse: { status: number; body: unknown } = {
  status: 200,
  body: { users: [MEMBER] },
};
/** How `DELETE .../users` answers. */
let removeResponse: { status: number; body: unknown } = {
  status: 200,
  body: { ok: true },
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installRouter() {
  fetchMock.mockImplementation(
    async (url: string, init?: { method?: string }) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^https?:\/\/[^/]+/, "");

      if (/\/coord\/cognito\/groups\/[^/]+\/users(\?|$)/.test(path)) {
        const r = method === "DELETE" ? removeResponse : listResponse;
        return jsonResponse(r.status, r.body);
      }
      if (path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(200, {
          groups: [
            {
              group_name: GROUP,
              description: null,
              creation_date: "2026-08-01T00:00:00Z",
              last_modified_date: null,
              precedence: null,
            },
          ],
        });
      }
      if (path.endsWith("/coord/group-tenant-roles")) {
        return jsonResponse(200, { group_tenant_roles: [] });
      }
      if (path.endsWith("/coord/my-tenants")) {
        return jsonResponse(200, { home_tenant_id: null, tenants: [] });
      }
      if (path.endsWith("/coord/members")) {
        return jsonResponse(200, { operators: [] });
      }
      return jsonResponse(200, {});
    }
  );
}

/** Open the Cognito Groups panel and expand the one group's member list. */
async function expandMembers(
  user_: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user_.click(await screen.findByRole("button", { name: /cognito groups/i }));
  await user_.click(await screen.findByTestId(`cognito-group-toggle-${GROUP}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  listResponse = { status: 200, body: { users: [MEMBER] } };
  removeResponse = { status: 200, body: { ok: true } };
  installRouter();
});

describe("Cognito group members — the READ's failure names its reason", () => {
  it("renders the backend's sentence, not the bare status", async () => {
    listResponse = {
      status: 400,
      body: {
        detail: "group_name must not contain spaces or control characters",
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await expandMembers(user_);

    const message = await screen.findByText(/must not contain spaces/i);
    expect(message).toBeInTheDocument();
    // The status alone was the whole message before this change.
    expect(message.textContent).not.toMatch(/^\s*HTTP 400\s*$/);
  });

  it("falls back to the STATUS when the body carries no sentence", async () => {
    // Routing this site through `backendErrorMessage` must not make an opaque
    // failure LESS informative than the bare throw it replaced. The helper used
    // to return the raw body when it found no `detail`, so a `{}` from a
    // gateway rendered as `{}` — strictly worse than the `HTTP 502` this site
    // showed before. The helper now prefers the status for a JSON body it
    // cannot read a sentence out of.
    listResponse = { status: 502, body: {} };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await expandMembers(user_);

    const message = await screen.findByText(/HTTP 502/);
    expect(message).toBeInTheDocument();
    expect(message.textContent).not.toContain("{}");
  });
});

describe("Cognito group members — the REMOVE's failure names its reason", () => {
  it("carries one prefix, with no nested HTTP envelope", async () => {
    removeResponse = {
      status: 404,
      body: { detail: "No such Cognito user: ops@example.com" },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await expandMembers(user_);

    await user_.click(
      await screen.findByTestId(`cognito-remove-user-${GROUP}-${MEMBER.username}`)
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls.at(-1)?.[0]);
    expect(message).toContain("No such Cognito user: ops@example.com");
    expect(message).toMatch(/^Remove failed:/);
    // The defect: `HTTP 404 {"detail":…}` between the prefix and the reason.
    expect(message).not.toContain("HTTP 404");
    expect(message).not.toContain("detail");
  });

  it("resolves a STRUCTURED detail to its message", async () => {
    removeResponse = {
      status: 409,
      body: {
        detail: {
          error: "ambiguous_email",
          message: "Multiple users match email: ops@example.com",
        },
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await expandMembers(user_);

    await user_.click(
      await screen.findByTestId(`cognito-remove-user-${GROUP}-${MEMBER.username}`)
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls.at(-1)?.[0]);
    expect(message).toContain("Multiple users match email: ops@example.com");
    expect(message).not.toContain("[object Object]");
  });

  it("still reports success on the happy path", async () => {
    // Without this, every assertion above could be satisfied by a handler that
    // failed unconditionally.
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await expandMembers(user_);

    await user_.click(
      await screen.findByTestId(`cognito-remove-user-${GROUP}-${MEMBER.username}`)
    );

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(String(toastSuccess.mock.calls.at(-1)?.[0])).toContain(
      `Removed ${MEMBER.email} from ${GROUP}`
    );
    expect(toastError).not.toHaveBeenCalled();
  });
});
