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
 *    `mappings.length === 0` is what prints "no mappings in your tenant" on
 *    the row. The `unknown / not yet landed` tests below go red the moment a
 *    failed, in-flight or since-invalidated read is allowed to render as an
 *    empty one again.
 * 7. **The confirmation shows the delete's OWN verdict, pool-wide.** Post-merge
 *    follow-up to qontinui-web#1114 (plan
 *    `2026-08-28-pool-wide-blast-radius-read-for-group-delete`, open question
 *    2). The dialog used to derive its preview from the section's
 *    `group-tenant-roles` read — coord's TENANT-SCOPED list — and so said
 *    "No coord tenant mappings reference this group" about a group mapped
 *    into another tenant, which the backend then 409'd. It now reads
 *    `GET /coord/cognito/groups/{name}/blast-radius`, the same verdict the
 *    guards run on, ONCE per open. The `pool-wide verdict` block pins: the
 *    route and the moment it is read; the "none" sentence appearing only on a
 *    zero verdict coord actually returned; a mapped or stranding verdict
 *    naming what it may name, counting the rest, and DISABLING the confirm
 *    (a guaranteed 409 is the `-home` rule again); a failed or malformed
 *    read rendering as unknown with the confirm left ENABLED, because the
 *    backend is the guard and refuses on its own.
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
   *
   * `"malformed"` covers the third way to have no answer, and the sneakiest:
   * a 200 whose body is not the shape we asked for. `res.ok` is true, so a
   * status-only check calls it a success and `?? []` would publish it as a
   * confident "none".
   */
  mappingsMode: "ok" | "error" | "pending" | "malformed";
  usersByGroup: Record<string, Array<Record<string, unknown>> | "error">;
  deleteResponse: { status: number; body: unknown };
  /**
   * How `GET /coord/cognito/groups/{name}/blast-radius` answers — the
   * dialog's ONE read of the delete's own verdict. A verdict object is served
   * as a 200; the three no-answer modes mirror `mappingsMode`'s, because the
   * arm most likely to be wrong is again the one with no answer.
   */
  blastRadius:
    | { mode: "ok"; body: Record<string, unknown> }
    | { mode: "error"; status: number; body: unknown }
    | { mode: "pending" }
    | { mode: "malformed" };
}

let state: RouteState;
const deleteCalls: string[] = [];
const blastRadiusCalls: string[] = [];

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
      const radius = path.match(
        /\/coord\/cognito\/groups\/([^/]+)\/blast-radius$/
      );
      if (radius) {
        blastRadiusCalls.push(decodeURIComponent(radius[1]));
        const br = state.blastRadius;
        if (br.mode === "error") return jsonResponse(br.status, br.body);
        if (br.mode === "pending") return new Promise<Response>(() => {});
        // 200, `res.ok`, and not a verdict.
        if (br.mode === "malformed") {
          return jsonResponse(200, { unexpected: "shape" });
        }
        return jsonResponse(200, br.body);
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
        if (state.mappingsMode === "malformed") {
          // 200, `res.ok === true`, and no `group_tenant_roles` at all. The
          // status says the read worked; the body says we have no answer.
          return jsonResponse(200, { unexpected: "shape" });
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

/**
 * The backend's blast-radius body, as the `ok` router state. Zero everywhere unless told otherwise —
 * "deleting this group breaks nothing", the only verdict the confirm is
 * enabled on. `mapped_total` defaults to the SUM of the three buckets, the
 * invariant the backend itself enforces.
 */
function verdict(
  overrides: Partial<{
    group_name: string;
    mapped_own_tenant: string[];
    mapped_other_tenant_rows: number;
    mapped_unmaterialized_rows: number;
    mapped_total: number;
    strands_own_tenant: string[];
    strands_other_tenant_count: number;
    strands_total: number;
  }> = {}
): { mode: "ok"; body: Record<string, unknown> } {
  const own = overrides.mapped_own_tenant ?? [];
  const other = overrides.mapped_other_tenant_rows ?? 0;
  const unmaterialized = overrides.mapped_unmaterialized_rows ?? 0;
  const strandsOwn = overrides.strands_own_tenant ?? [];
  const strandsOther = overrides.strands_other_tenant_count ?? 0;
  return {
    mode: "ok",
    body: {
      group_name: overrides.group_name ?? "acme-devs",
      mapped_total:
        overrides.mapped_total ?? own.length + other + unmaterialized,
      mapped_own_tenant: own,
      mapped_other_tenant_rows: other,
      mapped_unmaterialized_rows: unmaterialized,
      strands_total:
        overrides.strands_total ?? strandsOwn.length + strandsOther,
      strands_own_tenant: strandsOwn,
      strands_other_tenant_count: strandsOther,
    },
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
    blastRadiusCalls.length = 0;
    state = {
      groups: [group("acme-devs")],
      mappings: [mapping("acme-devs", "acme", "operator")],
      mappingsMode: "ok",
      usersByGroup: { "acme-devs": [user("ann"), user("bob")] },
      deleteResponse: { status: 200, body: { ok: true } },
      // The section's list above says `acme` maps this group; the verdict
      // says nothing does. The two are DIFFERENT reads and the tests below
      // that reach the confirm need the confirm enabled, which only the
      // verdict decides. Tests about the verdict set it explicitly.
      blastRadius: verdict(),
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

  it("reports an unreadable tenant-mapping read as unknown, never as 'no mappings in your tenant'", async () => {
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
    expect(blast.textContent ?? "").not.toMatch(/no mappings in your tenant/i);
  });

  it("does not claim an empty blast radius in the confirmation when the verdict read failed", async () => {
    // Item 7: the dialog's bullet is the VERDICT read, not the section's
    // list. A failed list read leaves the dialog able to answer (below, the
    // `pool-wide verdict` block); a failed verdict read is what this pins.
    state.blastRadius = {
      mode: "error",
      status: 502,
      body: {
        detail: {
          error: "mapping_check_unavailable",
          coord_status: 404,
          message:
            "Refused: coord could not tell us what deleting this group would break.",
        },
      },
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    // Re-query INSIDE the waitFor: `findByTestId` can resolve on the loading
    // arm, and asserting against that captured node only works while both
    // arms happen to render the same un-keyed element in the same slot. Hold
    // the node and a future change of either arm's element type turns this
    // into a timeout instead of a clear failure.
    await waitFor(() =>
      expect(
        screen.getByTestId("cognito-delete-confirm-mappings-acme-devs")
      ).toHaveTextContent(/could not be read/i)
    );
    const bullet = screen.getByTestId(
      "cognito-delete-confirm-mappings-acme-devs"
    );
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
    // Assert the LITERAL copy, not just the testid — a testid-only assertion
    // lets the operator-visible sentence change without any test noticing.
    expect(
      within(blast).getByTestId("cognito-group-mappings-loading-acme-devs")
    ).toHaveTextContent("reading tenant mappings");
    expect(
      within(blast).queryByTestId("cognito-group-unmapped-acme-devs")
    ).toBeNull();
    expect(blast.textContent ?? "").not.toMatch(/no mappings in your tenant/i);
  });

  it("treats a 200 with a malformed body as unknown, never as 'no mappings in your tenant'", async () => {
    // The status-only trap: `res.ok` is true, so a check that stops at the
    // status calls this a successful read. What the body actually carries is
    // no answer at all — and a `?? []` fallback would render that as the
    // confident all-clear, which is the same fabrication a 502 used to make.
    state.mappingsMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    const blast = await screen.findByTestId("cognito-group-blast-acme-devs");
    await waitFor(() =>
      expect(
        within(blast).getByTestId("cognito-group-mappings-unknown-acme-devs")
      ).toHaveTextContent("tenant mappings unknown")
    );
    expect(
      within(blast).queryByTestId("cognito-group-unmapped-acme-devs")
    ).toBeNull();
    expect(blast.textContent ?? "").not.toMatch(/no mappings in your tenant/i);

    // …and the confirmation is NOT derived from that list any more: it reads
    // the pool-wide verdict itself, so a malformed list read leaves it able
    // to answer from a read that did land.
    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("cognito-delete-confirm-mappings-acme-devs")
      ).toHaveTextContent(/No coord tenant mappings reference this group/i)
    );
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
    expect(blast.textContent ?? "").not.toMatch(/no mappings in your tenant/i);
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
    state.blastRadius = verdict({ mapped_own_tenant: ["acme"] });
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openGroupsPanel(user_);

    await user_.click(
      await screen.findByTestId("cognito-delete-group-acme-devs")
    );
    const blast = await screen.findByTestId(
      "cognito-delete-confirm-acme-devs-blast-radius"
    );
    await waitFor(() => expect(blast).toHaveTextContent("acme"));
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

  // ---------------------------------------------------------------------
  // Item 7 — the confirmation reads the delete's OWN verdict, pool-wide.
  // ---------------------------------------------------------------------

  describe("pool-wide verdict in the confirmation", () => {
    async function openConfirm(
      user_: ReturnType<typeof userEvent.setup>
    ): Promise<HTMLElement> {
      await openGroupsPanel(user_);
      await user_.click(
        await screen.findByTestId("cognito-delete-group-acme-devs")
      );
      return screen.findByTestId("cognito-delete-confirm-acme-devs");
    }

    it("reads the blast-radius route for THIS group when the dialog opens, and not before", async () => {
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openGroupsPanel(user_);
      // The row is up, the section's list has landed, and the verdict has
      // not been asked for: it is per-group and only the dialog needs it.
      await screen.findByTestId("cognito-group-mapping-acme-devs-acme-operator");
      expect(blastRadiusCalls).toEqual([]);

      await user_.click(
        await screen.findByTestId("cognito-delete-group-acme-devs")
      );
      await waitFor(() => expect(blastRadiusCalls).toEqual(["acme-devs"]));
    });

    it("says 'none' only when coord's pool-wide verdict is zero — and says it is pool-wide", async () => {
      // The section's list says `acme` maps this group (the default state);
      // the verdict says nothing does. The dialog must follow the VERDICT:
      // that is the whole point of reading it.
      state.blastRadius = verdict();
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() =>
        expect(bullet).toHaveTextContent(
          /No coord tenant mappings reference this group/i
        )
      );
      // The old sentence was the same words about a tenant-scoped read. The
      // qualifier is what makes it TRUE now, so it is asserted, not implied.
      expect(bullet).toHaveTextContent(/pool-wide/i);
      expect(
        screen.queryByTestId("cognito-delete-confirm-strands-acme-devs")
      ).toBeNull();

      // …and the confirm is reachable: a verdict that breaks nothing must
      // not become a blanket denial.
      await user_.type(
        screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
        "acme-devs"
      );
      expect(
        screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
      ).toBeEnabled();
    });

    it("a mapping in ANOTHER tenant is reported and disables the confirm, even though the section's list shows none", async () => {
      // THE regression this follow-up exists for. On the section's list
      // (tenant-scoped) this group maps nowhere; the pool-wide verdict says
      // one row in a tenant the caller does not administer. Before: "No
      // coord tenant mappings reference this group." beside an enabled
      // confirm, then a 409.
      state.mappings = [];
      state.blastRadius = verdict({ mapped_other_tenant_rows: 1 });
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() =>
        expect(bullet).toHaveTextContent(
          /1 mapping in tenants you do not administer/i
        )
      );
      expect(bullet).toHaveTextContent(/1 mapping in all/i);
      expect(bullet).not.toHaveTextContent(
        /No coord tenant mappings reference this group/i
      );
      // Nothing of the caller's is listed, so "the ones in your tenant,
      // above" would point at nothing; the tail names who CAN clear it.
      expect(bullet).toHaveTextContent(
        /by an administrator of the tenants they are in/i
      );
      expect(bullet).not.toHaveTextContent(/above/i);

      await user_.type(
        screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
        "acme-devs"
      );
      // Typing the name is not enough: the backend is certain to 409 and the
      // dialog knows it, so the confirm is gated the way the `-home` one is.
      expect(
        screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
      ).toBeDisabled();
      expect(deleteCalls).toEqual([]);
    });

    it("names what it may name and COUNTS the rest, with the honest total beside it", async () => {
      state.blastRadius = verdict({
        mapped_own_tenant: ["acme", "beta-corp"],
        mapped_other_tenant_rows: 2,
        mapped_unmaterialized_rows: 1,
      });
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() => expect(bullet).toHaveTextContent("acme, beta-corp"));
      expect(bullet).toHaveTextContent(/the ones in your tenant, above/i);
      expect(bullet).toHaveTextContent(
        /2 further mappings in tenants you do not administer/i
      );
      expect(bullet).toHaveTextContent(
        /1 mapping into tenants that do not exist yet/i
      );
      // 2 named + 2 + 1: the total is the ROW count, not the names.
      expect(bullet).toHaveTextContent(/5 mappings in all/i);
    });

    it("a stranding verdict gets its own amber bullet and disables the confirm — there is no override", async () => {
      state.blastRadius = verdict({
        mapped_own_tenant: ["acme"],
        strands_own_tenant: ["acme"],
        strands_other_tenant_count: 2,
      });
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const strands = await screen.findByTestId(
        "cognito-delete-confirm-strands-acme-devs"
      );
      expect(strands).toHaveTextContent(/only thing conferring admin on/i);
      expect(strands).toHaveTextContent(/acme/);
      expect(strands).toHaveTextContent(
        /2 further tenants you do not administer/i
      );
      expect(strands).toHaveTextContent(/3 tenants in all/i);
      expect(strands).toHaveTextContent(/no override/i);

      await user_.type(
        screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
        "acme-devs"
      );
      expect(
        screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
      ).toBeDisabled();
    });

    it("a stranding verdict alone (nothing mapped in the caller's view) still disables", async () => {
      // Guard 3 can fire for a tenant the caller cannot see at all. The
      // mapping bullet then reads mapped-elsewhere and the strand bullet
      // carries the no-override reason; neither is "none".
      state.mappings = [];
      state.blastRadius = verdict({
        mapped_other_tenant_rows: 1,
        strands_other_tenant_count: 1,
      });
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const strands = await screen.findByTestId(
        "cognito-delete-confirm-strands-acme-devs"
      );
      expect(strands).toHaveTextContent(/1 tenant you do not administer/i);
      await user_.type(
        screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
        "acme-devs"
      );
      expect(
        screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
      ).toBeDisabled();
    });

    it("renders the backend's own 502 sentence as unknown and leaves the confirm ENABLED", async () => {
      // Unknown is not a refusal the dialog may impose: the backend re-runs
      // the read and refuses on its own. Disabling here would make a coord
      // blip a dead end while implying the dashboard is the guard.
      state.blastRadius = {
        mode: "error",
        status: 502,
        body: {
          detail: {
            error: "mapping_check_unavailable",
            coord_status: 404,
            message: "Refused: coord has not yet deployed the blast-radius read.",
          },
        },
      };
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() => expect(bullet).toHaveTextContent(/could not be read/i));
      expect(bullet).toHaveTextContent(/unknown/i);
      // The CAUSE — code + coord's status — and NOT the delete's refusal
      // prose: "Nothing was deleted" is about a click nobody made yet.
      expect(bullet).toHaveTextContent(
        /mapping_check_unavailable, coord answered 404/
      );
      expect(bullet).not.toHaveTextContent(/not yet deployed the blast-radius read/i);
      expect(bullet).not.toHaveTextContent(/Nothing was deleted/i);
      expect(bullet).toHaveTextContent(/server-side/i);
      expect(bullet).not.toHaveTextContent(/No coord tenant mappings/i);

      await user_.type(
        screen.getByTestId("cognito-delete-confirm-acme-devs-phrase-input"),
        "acme-devs"
      );
      expect(
        screen.getByTestId("cognito-delete-confirm-acme-devs-confirm")
      ).toBeEnabled();
    });

    it("renders an UNREADABLE verdict's reason, and does not claim coord never answered", async () => {
      // `mapping_check_unreadable` carries NO `coord_status` — coord did
      // answer, with a body that is not the verdict — and a `reason`. The
      // absent key must not be read as `null` ("never completed an answer"):
      // that would send the operator to check transport when the thing to
      // check is coord's body, or a proxy in front of it.
      state.blastRadius = {
        mode: "error",
        status: 502,
        body: {
          detail: {
            error: "mapping_check_unreadable",
            reason: "the body carries no mapped_total",
            message: "Refused: coord's answer could not be read. Nothing was deleted.",
          },
        },
      };
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() => expect(bullet).toHaveTextContent(/could not be read/i));
      expect(bullet).toHaveTextContent(
        /mapping_check_unreadable: the body carries no mapped_total/
      );
      expect(bullet).not.toHaveTextContent(/never completed/i);
      expect(bullet).not.toHaveTextContent(/Nothing was deleted/i);
    });

    it("treats a 200 that is not a verdict as unknown, never as 'none'", async () => {
      // The status-only trap again: `res.ok`, and no counts. `?? 0` on a
      // missing `mapped_total` would print the all-clear this whole change
      // exists to stop fabricating.
      state.blastRadius = { mode: "malformed" };
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      await waitFor(() => expect(bullet).toHaveTextContent(/could not be read/i));
      expect(bullet).toHaveTextContent(/unknown/i);
      expect(bullet).not.toHaveTextContent(/No coord tenant mappings/i);
    });

    it("says it is still reading until the verdict lands", async () => {
      state.blastRadius = { mode: "pending" };
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);

      const bullet = await screen.findByTestId(
        "cognito-delete-confirm-mappings-acme-devs"
      );
      expect(bullet).toHaveTextContent(/reading coord/i);
      expect(bullet).not.toHaveTextContent(/No coord tenant mappings/i);
      expect(bullet).not.toHaveTextContent(/could not be read/i);
    });

    it("re-reads on every open, so a mapping removed in between is not shown as still refusing", async () => {
      state.blastRadius = verdict({ mapped_own_tenant: ["acme"] });
      const user_ = userEvent.setup();
      render(<MembersPage />);
      await openConfirm(user_);
      await waitFor(() =>
        expect(
          screen.getByTestId("cognito-delete-confirm-mappings-acme-devs")
        ).toHaveTextContent(/Mapped to/i)
      );
      await user_.click(
        screen.getByTestId("cognito-delete-confirm-acme-devs-cancel")
      );
      await waitFor(() =>
        expect(
          screen.queryByTestId("cognito-delete-confirm-acme-devs")
        ).toBeNull()
      );

      // The operator removed the mapping elsewhere; coord's verdict is now
      // zero. Re-opening must ask again rather than replay the old refusal.
      state.blastRadius = verdict();
      await user_.click(screen.getByTestId("cognito-delete-group-acme-devs"));
      await waitFor(() =>
        expect(
          screen.getByTestId("cognito-delete-confirm-mappings-acme-devs")
        ).toHaveTextContent(/No coord tenant mappings reference this group/i)
      );
      expect(blastRadiusCalls).toEqual(["acme-devs", "acme-devs"]);
    });
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
