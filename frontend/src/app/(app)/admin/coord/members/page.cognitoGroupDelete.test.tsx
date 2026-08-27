/**
 * /admin/coord/members — Cognito group delete: blast radius + confirmation.
 *
 * Phase 2 of plan
 * `2026-08-27-members-page-delete-paths-authorization-and-blast-radius`.
 *
 * ## What is pinned, and why each would go red
 *
 * 1. **Blast radius is on the COLLAPSED row.** `CognitoGroupMembers` mounts
 *    only inside `{expanded && …}`, so before this phase a collapsed row
 *    carried name/description/created and nothing about what Delete would
 *    take with it. `shows the member count and mapped tenants without
 *    expanding` goes red the moment that information moves back behind the
 *    toggle.
 * 2. **Delete is confirmed, and the confirmation is typed.** `Delete` used to
 *    call the endpoint directly on one click. `opens a confirmation instead
 *    of deleting` and `requires the group name` both fail if the button is
 *    rewired straight to the request.
 * 3. **A `<slug>-home` override is explicit.** The backend refuses without
 *    `allow_home_group`; a confirm button that is enabled anyway would ship a
 *    guaranteed 409, so the acknowledgement gates the button AND puts the
 *    parameter on the wire.
 * 4. **A structured 409 renders its sentence.** The guards answer with
 *    `{error, tenants, message}`; a naive `res.text()` renders the JSON blob
 *    (or `[object Object]`) at the one moment the operator most needs to read
 *    a reason.
 * 5. **An unreadable member count is UNKNOWN, never 0.** A confident "0
 *    members" derived from a failed probe is the argument FOR deleting.
 *
 * `DestructiveButton` is stubbed to a plain button here. Its real behaviour —
 * refusing clicks whose `event.isTrusted` is false — is covered by
 * `components/ui/destructive-button.test.tsx`, and jsdom cannot produce a
 * trusted click at all (`isTrusted` is non-configurable on real events), so
 * leaving the gate in place would make every flow below untestable rather
 * than more faithful.
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

interface RouteState {
  groups: Array<Record<string, unknown>>;
  mappings: Array<Record<string, unknown>>;
  usersByGroup: Record<string, Array<Record<string, unknown>> | "error">;
  deleteResponse: { status: number; body: unknown };
}

let state: RouteState;
const deleteCalls: string[] = [];

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

      if (
        method === "DELETE" &&
        /\/coord\/cognito\/groups\/[^/]+$/.test(path)
      ) {
        deleteCalls.push(path);
        return jsonResponse(
          state.deleteResponse.status,
          state.deleteResponse.body
        );
      }
      if (path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(200, { groups: state.groups });
      }
      const users = path.match(
        /\/coord\/cognito\/groups\/([^/]+)\/users(\?|$)/
      );
      if (users) {
        const name = decodeURIComponent(users[1]);
        const rows = state.usersByGroup[name];
        if (rows === "error") return jsonResponse(502, { detail: "boom" });
        return jsonResponse(200, { users: rows ?? [] });
      }
      if (path.endsWith("/coord/group-tenant-roles")) {
        return jsonResponse(200, { group_tenant_roles: state.mappings });
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

function group(name: string, extra: Record<string, unknown> = {}) {
  return {
    group_name: name,
    description: null,
    creation_date: "2026-08-01T00:00:00Z",
    last_modified_date: null,
    precedence: null,
    ...extra,
  };
}

function mapping(group_id: string, tenant_slug: string, role: string) {
  return {
    group_id,
    tenant_slug,
    role,
    auto_create_tenant: true,
    created_at: "2026-08-01T00:00:00Z",
    tenant_id: null,
  };
}

function user(username: string) {
  return {
    username,
    email: `${username}@example.com`,
    status: "CONFIRMED",
    enabled: true,
  };
}

describe("/admin/coord/members — Cognito group delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCalls.length = 0;
    state = {
      groups: [group("acme-devs")],
      mappings: [mapping("acme-devs", "acme", "operator")],
      usersByGroup: { "acme-devs": [user("ann"), user("bob")] },
      deleteResponse: { status: 200, body: { ok: true } },
    };
    installRouter();
  });

  it("shows the member count and mapped tenants without expanding the row", async () => {
    render(<MembersPage />);

    const blast = await screen.findByTestId("cognito-group-blast-acme-devs");
    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-members-count-acme-devs")
      ).toHaveTextContent("2 members")
    );
    expect(
      within(blast).getByTestId("cognito-group-mapping-acme-devs-acme-operator")
    ).toHaveTextContent("acme");
    // The detail row — where the member LIST lives — must still be closed:
    // this information is on the collapsed row, not behind the toggle.
    expect(screen.queryByTestId("cognito-group-detail-acme-devs")).toBeNull();
  });

  it("reports an unreadable member count as unknown, never as zero", async () => {
    state.usersByGroup = { "acme-devs": "error" };
    render(<MembersPage />);

    const badge = await screen.findByTestId(
      "cognito-group-members-count-acme-devs"
    );
    await waitFor(() => expect(badge).toHaveTextContent("members unknown"));
    expect(badge).not.toHaveTextContent("0 members");
  });

  it("opens a confirmation instead of deleting on the first click", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );

    expect(
      await screen.findByTestId("cognito-delete-confirm-acme-devs")
    ).toBeInTheDocument();
    expect(deleteCalls).toEqual([]);
  });

  it("requires the group name to be typed before it will delete", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    const confirm = await screen.findByTestId(
      "cognito-delete-confirm-acme-devs-confirm"
    );
    expect(confirm).toBeDisabled();

    await user_.type(
      screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
      "acme-devs"
    );
    expect(confirm).toBeEnabled();

    await user_.click(confirm);
    await waitFor(() => expect(deleteCalls).toHaveLength(1));
    expect(deleteCalls[0]).toMatch(/\/coord\/cognito\/groups\/acme-devs$/);
    // No override is sent for a plain group — `allow_mapped` is not offered
    // by the dashboard at all.
    expect(deleteCalls[0]).not.toContain("allow_");
  });

  it("shows the mapped tenants inside the confirmation too", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    const blast = await screen.findByTestId(
      "cognito-delete-confirm-acme-devs-blast-radius"
    );
    expect(blast).toHaveTextContent("acme");
    await waitFor(() => expect(blast).toHaveTextContent("2 members"));
  });

  it("renders a structured 409 as its own sentence, not as JSON", async () => {
    const user_ = userEvent.setup();
    state.deleteResponse = {
      status: 409,
      body: {
        detail: {
          error: "group_is_mapped",
          group_name: "acme-devs",
          tenants: ["acme"],
          message: "acme-devs is mapped to acme; remove the mapping first.",
        },
      },
    };
    render(<MembersPage />);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    await user_.type(
      await screen.findByTestId(
        "cognito-delete-confirm-acme-devs-phrase-input"
      ),
      "acme-devs"
    );
    await user_.click(
      screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls[0][0]);
    expect(message).toContain("remove the mapping first");
    expect(message).not.toContain("[object Object]");
    expect(message).not.toContain('{"detail"');
  });

  describe("a <slug>-home group", () => {
    beforeEach(() => {
      state.groups = [group("acme-home")];
      state.mappings = [];
      state.usersByGroup = { "acme-home": [user("ann")] };
      installRouter();
    });

    it("is flagged on the collapsed row as a home pin", async () => {
      render(<MembersPage />);
      expect(
        await screen.findByTestId("cognito-group-home-pin-acme-home")
      ).toHaveTextContent("acme");
    });

    it("will not confirm until the un-pin is acknowledged, then sends the override", async () => {
      const user_ = userEvent.setup();
      render(<MembersPage />);

      await user_.click(
        await screen.findByTestId("cognito-delete-group-acme-home")
      );
      await user_.type(
        await screen.findByTestId(
          "cognito-delete-confirm-acme-home-phrase-input"
        ),
        "acme-home"
      );
      const confirm = screen.getByTestId(
        "cognito-delete-confirm-acme-home-confirm"
      );
      // The name is typed and it is STILL disabled — the acknowledgement is
      // a separate, explicit act.
      expect(confirm).toBeDisabled();

      await user_.click(screen.getByTestId("cognito-allow-home-acme-home"));
      expect(confirm).toBeEnabled();

      await user_.click(confirm);
      await waitFor(() => expect(deleteCalls).toHaveLength(1));
      expect(deleteCalls[0]).toContain("allow_home_group=true");
    });

    it("says the effect lands at next login rather than promising a sweep", async () => {
      const user_ = userEvent.setup();
      render(<MembersPage />);

      await user_.click(
        await screen.findByTestId("cognito-delete-group-acme-home")
      );
      const dialog = await screen.findByTestId(
        "cognito-delete-confirm-acme-home"
      );
      expect(dialog).toHaveTextContent(/next login/i);
      expect(dialog.textContent ?? "").not.toMatch(/sweep/i);
    });
  });
});
