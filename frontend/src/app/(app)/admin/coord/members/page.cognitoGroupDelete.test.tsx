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
 * 6. **An unreadable TENANT-MAPPING table is UNKNOWN, never "none".** Same
 *    class as 5, other half of the blast radius, and the one that shipped
 *    broken: the effect's `catch` collapsed the failure to `[]`, and
 *    `mappings.length === 0` is what prints "no tenant mappings" on the row
 *    and "No coord tenant mappings reference this group." in the dialog. The
 *    four `unknown / not yet landed` tests below go red the moment a failed,
 *    in-flight or since-invalidated read is allowed to render as an empty one
 *    again.
 *
 * **Every test opens the "Cognito Groups" panel first.** Wave 4
 * (`feat(console): bring /members onto the console primitives`) folded all four
 * secondary sections into `CollapsiblePanel`s with `defaultOpen={false}`, and
 * Radix `CollapsibleContent` UNMOUNTS its children while closed — so none of
 * this section's rows, badges or buttons exist in the document until someone
 * opens it. That is the real behaviour, so the tests start where an operator
 * does rather than reaching past it: `openGroupsPanel` is a click on the
 * section header, not a test-only escape hatch.
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
  /**
   * How `/coord/group-tenant-roles` behaves.
   *
   * `"error"` and `"pending"` exist because the two states this panel is most
   * likely to get WRONG are the ones where it has no answer: a failed read and
   * an in-flight one both used to leave `mappings` as `[]`, which is the same
   * array a successful read of an unmapped group produces. Without a knob for
   * them the suite could only ever exercise the arm that happens to be right.
   */
  mappingsMode: "ok" | "error" | "pending";
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
        if (state.mappingsMode === "error") {
          return jsonResponse(502, { detail: "coord unreachable" });
        }
        if (state.mappingsMode === "pending") {
          // Never settles — the read is still in flight, which is a DIFFERENT
          // state from "read, and there are none".
          return new Promise<Response>(() => {});
        }
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

/**
 * Open the folded "Cognito Groups" section and wait for its table to mount.
 *
 * The panel persists its open/closed choice to `localStorage`, so `beforeEach`
 * clears it: without that the FIRST test's click would leave every later test
 * pre-opened, and the day the fold changes only one test would notice.
 */
async function openGroupsPanel(
  user_: ReturnType<typeof userEvent.setup>
): Promise<void> {
  await user_.click(
    await screen.findByRole("button", { name: /cognito groups/i })
  );
}

describe("/admin/coord/members — Cognito group delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    deleteCalls.length = 0;
    state = {
      groups: [group("acme-devs")],
      mappings: [mapping("acme-devs", "acme", "operator")],
      mappingsMode: "ok",
      usersByGroup: { "acme-devs": [user("ann"), user("bob")] },
      deleteResponse: { status: 200, body: { ok: true } },
    };
    installRouter();
  });

  it("shows the member count and mapped tenants without expanding the row", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

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
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    const badge = await screen.findByTestId(
      "cognito-group-members-count-acme-devs"
    );
    await waitFor(() => expect(badge).toHaveTextContent("members unknown"));
    expect(badge).not.toHaveTextContent("0 members");
  });

  // ---------------------------------------------------------------------
  // An unreadable tenant-mapping table is UNKNOWN, never "no mappings".
  //
  // These are the negative-path twins of `shows the member count and mapped
  // tenants without expanding the row`. They exist because the failure they
  // pin is INVISIBLE to the positive tests: a `catch` that ends in
  // `setMappings([])` makes every one of those pass while the row quietly
  // publishes a suppressed error as "nothing references this group" — the
  // single most reassuring sentence the dialog can show, beside a Delete
  // button, derived from an answer the page never received.
  //
  // Each asserts the LITERAL absent-claim copy is gone, not merely that some
  // unknown marker is present: a build that renders both would still be
  // telling the operator there is nothing to break.
  // ---------------------------------------------------------------------

  it("reports an unreadable tenant-mapping read as unknown, never as 'no tenant mappings'", async () => {
    state.mappingsMode = "error";
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    const blast = await screen.findByTestId("cognito-group-blast-acme-devs");
    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-mappings-unknown-acme-devs")
      ).toHaveTextContent("tenant mappings unknown")
    );
    // The all-clear badge must not be rendered at all — not even alongside.
    expect(
      within(blast).queryByTestId("cognito-group-unmapped-acme-devs")
    ).toBeNull();
    expect(blast.textContent ?? "").not.toMatch(/no tenant mappings/i);
  });

  it("does not claim an empty blast radius in the confirmation when the mapping read failed", async () => {
    state.mappingsMode = "error";
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    const bullet = await screen.findByTestId(
      "cognito-delete-confirm-mappings-acme-devs"
    );
    await waitFor(() => expect(bullet).toHaveTextContent(/could not be read/i));
    expect(bullet).toHaveTextContent(/unknown/i);

    const dialog = screen.getByTestId("cognito-delete-confirm-acme-devs");
    expect(dialog.textContent ?? "").not.toMatch(
      /No coord tenant mappings reference this group/i
    );
    // "Unknown" must not read as "unguarded": the sentence names the check
    // that still runs server-side, so the operator knows what stops them.
    expect(bullet).toHaveTextContent(/server-side/i);
  });

  it("says nothing about mappings until the read has landed", async () => {
    state.mappingsMode = "pending";
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    const blast = await screen.findByTestId("cognito-group-blast-acme-devs");
    // The member count arrives independently, so the row is genuinely
    // rendered — this is not an assertion about an unmounted tree.
    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-members-count-acme-devs")
      ).toHaveTextContent("2 members")
    );
    expect(
      within(blast).getByTestId("cognito-group-mappings-loading-acme-devs")
    ).toBeInTheDocument();
    expect(
      within(blast).queryByTestId("cognito-group-unmapped-acme-devs")
    ).toBeNull();
    expect(blast.textContent ?? "").not.toMatch(/no tenant mappings/i);
  });

  it("degrades a previously-known mapping to unknown when a REFRESH fails", async () => {
    // The `ok → error` transition, which the three tests above cannot reach:
    // the first read succeeds and the row shows a real mapping, then adding a
    // member bumps `countsToken` and the refetch 502s. The rows we can no
    // longer vouch for must not keep standing as current — "unknown" is never
    // a weaker warning than the truth, and the alternative is a badge that
    // silently outlives the read behind it.
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    const blast = await screen.findByTestId("cognito-group-blast-acme-devs");
    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-mapping-acme-devs-acme-operator")
      ).toBeInTheDocument()
    );

    // Coord goes dark only NOW — `installRouter` reads `state` per request,
    // so flipping it here is what makes the REFETCH the failing read rather
    // than counting calls (the effect can legitimately run more than once).
    state.mappingsMode = "error";

    // Expand, add a member — that is what calls `refreshBlastRadius`.
    await user_.click(await screen.findByTestId("cognito-group-toggle-acme-devs"));
    await user_.type(
      await screen.findByTestId("cognito-add-email-acme-devs"),
      "cara@example.com"
    );
    await user_.click(screen.getByTestId("cognito-add-submit-acme-devs"));

    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-mappings-unknown-acme-devs")
      ).toBeInTheDocument()
    );
    expect(
      within(blast).queryByTestId("cognito-group-mapping-acme-devs-acme-operator")
    ).toBeNull();
    expect(blast.textContent ?? "").not.toMatch(/no tenant mappings/i);
  });

  it("spends no member probes on a panel nobody opened", async () => {
    // Wave 4 folded this section as "the least-often-read on the page". The
    // blast radius costs one coord read plus one AWS `list_users_in_group`
    // PER GROUP, so firing them for a panel that is closed by default would
    // bill every members-page load for a section nobody looked at.
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const urls = () =>
      fetchMock.mock.calls.map((c) =>
        String(c[0]).replace(/^https?:\/\/[^/]+/, "")
      );
    expect(urls().some((u) => /\/cognito\/groups\/[^/]+\/users/.test(u))).toBe(
      false
    );

    // Opening it is what buys them — and the count still lands.
    await openGroupsPanel(user_);
    await waitFor(() =>
      expect(
        urls().some((u) => /\/cognito\/groups\/[^/]+\/users/.test(u))
      ).toBe(true)
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("cognito-group-members-count-acme-devs")
      ).toHaveTextContent("2 members")
    );
  });

  it("opens a confirmation instead of deleting on the first click", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

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
    await openGroupsPanel(user_);

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
    await openGroupsPanel(user_);

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
    await openGroupsPanel(user_);

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
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openGroupsPanel(user_);
      expect(
        await screen.findByTestId("cognito-group-home-pin-acme-home")
      ).toHaveTextContent("acme");
    });

    it("will not confirm until the un-pin is acknowledged, then sends the override", async () => {
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openGroupsPanel(user_);

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
      await openGroupsPanel(user_);

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
