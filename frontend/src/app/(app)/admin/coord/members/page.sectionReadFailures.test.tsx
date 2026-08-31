/**
 * /admin/coord/members — a failed section read is UNKNOWN, never "none".
 *
 * Post-merge follow-up to web #1111, which closed exactly this defect for the
 * **blast-radius** read of `/coord/group-tenant-roles` and left every other
 * read on the page open. This file pins all of them.
 *
 * All seven GET sites on the page are now guarded, and every other
 * `httpClient.fetch` here is a mutation that checks `res.ok` and toasts —
 * none consumes a body into state. So there is no eighth site waiting for a
 * third wave.
 *
 * ## The shape, and why the panels make it worse
 *
 * Each section follows the same three-arm render: `loading` → `error` →
 * `rows.length === 0` → the table. That ordering is correct, and it is *not*
 * what these tests pin. The gap is one layer up:
 *
 * 1. **The read accepted any 200.** `setRows(json.group_tenant_roles ?? [])`,
 *    `setGroups(json.groups ?? [])`, `setOperators(json.operators ?? [])` and
 *    `setUsers(json.users ?? [])` treat a body that never carried the list as a
 *    successful, empty read — so `error` is null, the error arm is skipped, and
 *    the page prints "No mappings yet." / "No Cognito groups yet." / "No
 *    members yet." / "No users in this group yet." for a table it never saw. A
 *    `?? []` is dead per the types (every one of those fields is declared
 *    non-optional) and live at runtime, which is precisely why they survived
 *    review. A non-array value is worse than a missing one: `.length` succeeds
 *    on a string, so the empty check passes it through to `.map()` and the
 *    panel throws.
 *
 * 2. **A count was asserted where the error text could not be seen.** Two
 *    different versions of the same mistake:
 *
 *    - The COLLAPSED panel headers. `summary` renders inside
 *      `CollapsibleTrigger` (`CollapsiblePanel.tsx:138`), so the badge is on
 *      screen while the body — including the error text — is unmounted by
 *      Radix, and all three panels are `defaultOpen={false}`.
 *      `{loading ? "–" : rows.length}` therefore published `mappings 0` /
 *      `groups 0` from a read that failed, with nothing visible to contradict
 *      it.
 *
 *      The third panel, "Your tenant & roles", broke the same rule in its
 *      quietest form, and the first pass over this class fixed the other two
 *      and left it. `summary={data ? <Badge/> : undefined}` published no wrong
 *      value — it removed the badge, leaving a folded header indistinguishable
 *      from one still loading, and carrying no claim an operator could
 *      disbelieve. All three now answer in one vocabulary: `–` and `unknown`.
 *    - The per-group `N members` badge, whose probe recorded a count from a
 *      malformed 200 and so never set the `memberErrors` flag that exists to
 *      say "members unknown". Its unknown arm is now amber like the
 *      `tenant mappings unknown` badge it renders beside: the two halves of
 *      one blast radius are read in a single glance, and two tones for one
 *      meaning reads as one caveat and one fact.
 *
 *    Both sit on the section carrying the pool-wide Cognito **Delete**, so
 *    "there is nothing here" is the last claim they should make on an answer
 *    that never arrived.
 *
 *    The members `<StatCluster>` is the same rule at a section that is NEVER
 *    collapsed: its error text IS on screen, which made four confident zeroes
 *    beside it a contradiction rather than a silence. `no access 0` reads as
 *    "nobody is locked out" — the most reassuring answer the page can give.
 *
 * 3. **"Your tenant & roles" had no check at all**, being a `-> Any`
 *    passthrough with every field optional. A `null` body left `data` null with
 *    `loading` and `error` both false, and the render's trailing `: null` then
 *    drew NOTHING — not a wrong claim an operator could disbelieve, but no
 *    claim at all.
 *
 * ## Reading these tests
 *
 * Each negative test asserts in BOTH directions — the unknown marker is
 * present AND the absence claim is gone. A build that rendered both would
 * still be telling the operator there is nothing to break, so asserting only
 * the marker would let the regression back in.
 *
 * The `still reports…` / `still renders…` / `still says…` tests are the
 * positive controls. Without them the fix could degrade into a blanket
 * "unknown", which destroys the signal instead of qualifying it — the same
 * failure in the other direction. A genuinely empty read must still say
 * "empty", and `{}` from `/coord/my-tenants` must still say "No roles found.":
 * that body is indistinguishable from an operator who really holds nothing, so
 * it is deliberately NOT refused.
 *
 * **What the controls do and do not prove.** Five of them —
 * `still reports a genuinely empty member list`, `still says 'No roles
 * found.'`, `still reports a member count the probe actually delivered`,
 * `still renders a tenant card the read actually delivered` and `still says
 * 'No users in this group yet.'` — assert against markup that already existed,
 * so reverting the guards leaves them green and they are true controls.
 *
 * Three are NOT, and each names the commit it is a control against, because a
 * control that reds for the wrong reason is worse than none: it looks like
 * coverage.
 *
 * - The two panel-badge controls (`still reports a genuinely empty mapping
 *   table` / `…group list as zero`) read
 *   `data-testid="coord-group-roles-summary"` and
 *   `"coord-cognito-groups-summary"`, which this file's first commit ADDED.
 *   Reverted past it they red on a missing testid rather than on behaviour, so
 *   they cannot demonstrate the `error ? "unknown"` arm avoids over-reporting.
 * - `still shows the home tenant on the collapsed header` reads
 *   `"coord-members-my-tenants-summary"`, added by the follow-up commit that
 *   stopped that badge vanishing. Before it there was no testid — and, on a
 *   failed read, no badge — so it is a control only against that commit.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

/**
 * How a list read answers.
 *
 * `"malformed"` and `"notArray"` are separate on purpose. The first is the
 * body that lost the key (`?? []` fabricates an empty read); the second is the
 * body that kept it and put something else there — the arm that reaches
 * `.map()` and throws, because `"nope".length` is 4 and so the `=== 0` guard
 * above it does not fire.
 */
type ReadMode = "ok" | "error" | "malformed" | "notArray";

interface RouteState {
  groups: Array<Record<string, unknown>>;
  groupsMode: ReadMode;
  mappings: Array<Record<string, unknown>>;
  mappingsMode: ReadMode;
  operators: Array<Record<string, unknown>>;
  operatorsMode: ReadMode;
  users: Array<Record<string, unknown>>;
  usersMode: ReadMode;
  /**
   * The raw `/coord/my-tenants` body.
   *
   * Raw rather than a `ReadMode`, because this read is not a list read: the
   * endpoint is a `-> Any` passthrough of coord's `/admin/coord/me` and every
   * field is optional, so the interesting bodies are `null` and a scalar where
   * a list belongs — neither of which `listResponse` can express.
   */
  myTenants: unknown;
  myTenantsOk: boolean;
}

let state: RouteState;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Build the response for a list read under `mode`. */
function listResponse(
  mode: ReadMode,
  key: string,
  rows: Array<Record<string, unknown>>
): Response {
  if (mode === "error") return jsonResponse(502, { detail: "coord unreachable" });
  // 200 with `res.ok === true` in both malformed arms: the status says the read
  // worked, the body says we have no answer.
  if (mode === "malformed") return jsonResponse(200, { unexpected: "shape" });
  if (mode === "notArray") return jsonResponse(200, { [key]: "nope" });
  return jsonResponse(200, { [key]: rows });
}

function installRouter() {
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");

    if (path.endsWith("/coord/cognito/groups")) {
      return listResponse(state.groupsMode, "groups", state.groups);
    }
    if (/\/coord\/cognito\/groups\/[^/]+\/users(\?|$)/.test(path)) {
      return listResponse(state.usersMode, "users", state.users);
    }
    if (path.endsWith("/coord/group-tenant-roles")) {
      return listResponse(
        state.mappingsMode,
        "group_tenant_roles",
        state.mappings
      );
    }
    if (path.endsWith("/coord/my-tenants")) {
      return state.myTenantsOk
        ? jsonResponse(200, state.myTenants)
        : jsonResponse(502, { detail: "coord unreachable" });
    }
    if (path.endsWith("/coord/members")) {
      return listResponse(state.operatorsMode, "operators", state.operators);
    }
    return jsonResponse(200, {});
  });
}

function group(name: string) {
  return {
    group_name: name,
    description: null,
    creation_date: "2026-08-01T00:00:00Z",
    last_modified_date: null,
    precedence: null,
  };
}

function mapping(group_id: string, tenant_slug: string) {
  return {
    group_id,
    tenant_slug,
    role: "operator",
    auto_create_tenant: true,
    created_at: "2026-08-01T00:00:00Z",
    tenant_id: null,
  };
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

function cognitoUser(username: string) {
  return { username, email: `${username}@example.com`, status: null, enabled: true };
}

/** The badge text, with the `&nbsp;` the markup uses folded to a plain space. */
function badgeText(el: HTMLElement): string {
  return (el.textContent ?? "").replace(/ /g, " ").trim();
}

describe("/admin/coord/members — an unreadable section is unknown, not empty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `CollapsiblePanel` persists open/closed to localStorage; without this the
    // first test's click would leave every later test pre-opened.
    window.localStorage.clear();
    state = {
      groups: [group("acme-devs")],
      groupsMode: "ok",
      mappings: [mapping("acme-devs", "acme")],
      mappingsMode: "ok",
      operators: [operator("ops@example.com")],
      operatorsMode: "ok",
      users: [],
      usersMode: "ok",
      myTenants: { home_tenant_id: null, tenants: [] },
      myTenantsOk: true,
    };
    installRouter();
  });

  // -----------------------------------------------------------------------
  // Section d — Group → tenant → role mappings
  // -----------------------------------------------------------------------

  it("does not print a mapping count on the collapsed header when the read failed", async () => {
    state.mappingsMode = "error";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    // The whole point: no digit may stand in for an answer we never got.
    expect(badgeText(badge)).not.toMatch(/\d/);
  });

  it("treats a malformed 200 as unknown rather than 'No mappings yet.'", async () => {
    state.mappingsMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));

    // Open the panel: the absence copy inside must be gone too, not merely
    // out of sight behind the fold.
    await user_.click(
      await screen.findByRole("button", { name: /role mappings/i })
    );
    const panel = await screen.findByTestId("coord-members-group-roles");
    await waitFor(() =>
      expect(panel.textContent ?? "").toMatch(/malformed group-tenant-roles/i)
    );
    expect(panel.textContent ?? "").not.toMatch(/no mappings yet/i);
  });

  it("survives a 200 whose mapping list is not a list", async () => {
    // `"nope".length === 4`, so the `rows.length === 0` arm does NOT fire and
    // the value reaches `rows.map()`. Before the guard this threw and took the
    // panel down; the read must be refused before the render sees it.
    state.mappingsMode = "notArray";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(screen.queryByTestId("coord-group-roles-table")).toBeNull();
  });

  it("still reports a genuinely empty mapping table as zero", async () => {
    state.mappings = [];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-group-roles-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/mappings 0$/));
    expect(badgeText(badge)).not.toMatch(/unknown/i);

    await user_.click(
      await screen.findByRole("button", { name: /role mappings/i })
    );
    expect(
      await screen.findByText(/no mappings yet/i)
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Cognito Groups — the section that carries the pool-wide Delete
  // -----------------------------------------------------------------------

  it("does not print a group count on the collapsed header when the read failed", async () => {
    state.groupsMode = "error";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(badgeText(badge)).not.toMatch(/\d/);
  });

  it("treats a malformed 200 as unknown rather than 'No Cognito groups yet.'", async () => {
    state.groupsMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await waitFor(() =>
      expect(
        screen.getByText(/malformed cognito groups payload/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByText(/no cognito groups yet/i)).toBeNull();
  });

  it("survives a 200 whose group list is not a list", async () => {
    state.groupsMode = "notArray";
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(screen.queryByTestId("coord-cognito-groups-table")).toBeNull();
  });

  it("still reports a genuinely empty group list as zero", async () => {
    state.groups = [];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-cognito-groups-summary");
    await waitFor(() => expect(badgeText(badge)).toMatch(/groups 0$/));
    expect(badgeText(badge)).not.toMatch(/unknown/i);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    expect(
      await screen.findByText(/no cognito groups yet/i)
    ).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Section b — the Members table, and the four-count headline above it
  //
  // The third sibling the fix above named and did not close. This section is
  // never collapsed, so unlike the two panels its error text IS on screen —
  // which made the count strip a CONTRADICTION rather than a silence, not a
  // reason to leave it. `StatCluster` already renders `null` as `–`
  // (`StatCluster.tsx:95`); only the in-flight half of R6's rule was spelled
  // at the call site, so a FAILED read still published four confident zeroes.
  // -----------------------------------------------------------------------

  it("does not publish four zero counts when the members read failed", async () => {
    state.operatorsMode = "error";
    render(<MembersPage />);

    // "no access 0" is the sharpest of the four: it reads as "nobody is locked
    // out", the most reassuring answer the page can give, from a read that
    // never landed.
    for (const id of [
      "coord-members-count",
      "coord-members-count-admins",
      "coord-members-count-developers",
      "coord-members-count-no-access",
    ]) {
      const badge = await screen.findByTestId(id);
      await waitFor(() => expect(badgeText(badge)).toMatch(/–$/));
      expect(badgeText(badge)).not.toMatch(/\d/);
    }
  });

  it("treats a malformed 200 as unknown rather than 'No members yet.'", async () => {
    state.operatorsMode = "malformed";
    render(<MembersPage />);

    await waitFor(() =>
      expect(screen.getByText(/malformed members payload/i)).toBeInTheDocument()
    );
    expect(screen.queryByText(/no members yet/i)).toBeNull();
    expect(badgeText(screen.getByTestId("coord-members-count"))).not.toMatch(
      /\d/
    );
  });

  it("survives a 200 whose operator list is not a list", async () => {
    // `"nope".length === 4`, so `operators.length === 0` does not fire and the
    // string reaches `operators.map()`. Before the guard this threw and took
    // the page's main table down.
    state.operatorsMode = "notArray";
    render(<MembersPage />);

    await waitFor(() =>
      expect(screen.getByText(/malformed members payload/i)).toBeInTheDocument()
    );
    expect(screen.queryByTestId("coord-members-table")).toBeNull();
  });

  it("refuses a member ROW whose roles are not a list", async () => {
    // The quiet one. `deriveMemberStatus` does NOT throw on a string —
    // `"operator".includes("admin")` is false and `.length > 0` is true — so
    // the row renders as Developer and the strip counts `developers 1`.
    // Nothing looks wrong until someone clicks the row, at which point
    // `op.roles.map()` in the expansion throws and unmounts the tree.
    //
    // So this asserts the read is refused BEFORE any of that: no row, and no
    // count standing behind it.
    state.operators = [{ ...operator("ops@example.com"), roles: "operator" }];
    render(<MembersPage />);

    await waitFor(() =>
      expect(
        screen.getByText(/malformed members row `roles` payload/i)
      ).toBeInTheDocument()
    );
    expect(screen.queryByTestId("coord-members-table")).toBeNull();
    expect(badgeText(screen.getByTestId("coord-members-count-developers")))
      .not.toMatch(/\d/);
  });

  it("still reports a genuinely empty member list as zero", async () => {
    state.operators = [];
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-members-count");
    await waitFor(() => expect(badgeText(badge)).toMatch(/members 0$/));
    expect(await screen.findByText(/no members yet/i)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Section a — "Your tenant & roles"
  //
  // Not a list read: the endpoint is a `-> Any` passthrough of coord's
  // `/admin/coord/me` (`operations.py:8570`) whose every field is optional, so
  // the body was cast into state with no check at all.
  // -----------------------------------------------------------------------

  it("does not render a blank tenant card when the body is null", async () => {
    // The worst outcome on this page. `null` is legal JSON, and it left `data`
    // null with `loading` AND `error` both false — so the render's trailing
    // `: null` drew NOTHING. Not a wrong claim an operator could disbelieve;
    // no claim at all.
    state.myTenants = null;
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/malformed my-tenants payload/i)
    );
    expect(card.textContent ?? "").not.toMatch(/no roles found/i);
  });

  it("survives a 200 whose tenant list is not a list", async () => {
    // `data.tenants && data.tenants.length > 0` waves a string through, and
    // `data.tenants.map()` then throws.
    state.myTenants = { home_tenant_id: "t-1", tenants: "nope" };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/malformed my-tenants/i)
    );
  });

  it("still says 'No roles found.' for an empty object body", async () => {
    // The control for the ONE body this guard deliberately lets through. Every
    // field on `MyTenantsResponse` is optional and the endpoint has no response
    // model, so `{}` cannot be told apart from coord answering "you hold
    // nothing" — and an operator who really holds nothing must still be told
    // so. Without this test the docstring's promise is unenforced, and
    // tightening the guard later would silently break the honest case.
    state.myTenants = {};
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/no roles found/i)
    );
    expect(card.textContent ?? "").not.toMatch(/malformed/i);
  });

  it("refuses a top-level array where the tenant object belongs", async () => {
    // An array passes `typeof x === "object"`, so it needs its own arm.
    state.myTenants = [{ tenant_id: "t-1" }];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/malformed my-tenants payload/i)
    );
  });

  it("refuses a tenant ENTRY whose roles are not a list", async () => {
    // Per-entry, not just top level: `(t.roles ?? []).map()` throws on a
    // string, and one bad entry would take the whole card down.
    state.myTenants = {
      home_tenant_slug: "acme",
      tenants: [{ tenant_id: "t-1", slug: "acme", roles: "admin" }],
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/malformed my-tenants tenant/i)
    );
  });

  it("refuses a top-level roles field that is not a list", async () => {
    // The `tenants`-less shape: the card falls back to `data.roles`, which
    // reaches `.map()` at the render site just the same.
    state.myTenants = { home_tenant_slug: "acme", roles: "admin" };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() =>
      expect(card.textContent ?? "").toMatch(/malformed my-tenants `roles`/i)
    );
  });

  it("still renders a tenant card the read actually delivered", async () => {
    // Positive control: the guard must not turn a good body into "unknown".
    state.myTenants = {
      home_tenant_slug: "acme",
      tenants: [{ tenant_id: "t-1", slug: "acme", roles: ["admin"] }],
    };
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await waitFor(() => expect(card.textContent ?? "").toMatch(/acme/));
    expect(card.textContent ?? "").not.toMatch(/malformed/i);
  });

  // -----------------------------------------------------------------------
  // The per-group member count — the badge beside the pool-wide Delete
  //
  // `memberErrors` is the mechanism #1111 held up as its model, but it is
  // reachable only from the probe's `catch`. A malformed 200 walked straight
  // past it and recorded a confident `0` instead.
  // -----------------------------------------------------------------------

  it("reports an unreadable member count as unknown, not as 0 members", async () => {
    state.usersMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    const panel = await screen.findByTestId("coord-members-cognito-groups");
    await waitFor(() =>
      expect(panel.textContent ?? "").toMatch(/members unknown/i)
    );
    expect(panel.textContent ?? "").not.toMatch(/\b0 members\b/);
  });

  it("does not report a string's length as a member count", async () => {
    // `"nope".length` is 4. Before the guard the badge showed `4 members` for
    // a group whose membership was never read — a number with no relationship
    // to anything, beside a pool-wide Delete.
    state.usersMode = "notArray";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    const panel = await screen.findByTestId("coord-members-cognito-groups");
    await waitFor(() =>
      expect(panel.textContent ?? "").toMatch(/members unknown/i)
    );
    expect(panel.textContent ?? "").not.toMatch(/\b4 members\b/);
  });

  it("still reports a member count the probe actually delivered", async () => {
    state.users = [cognitoUser("ada"), cognitoUser("grace")];
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    const panel = await screen.findByTestId("coord-members-cognito-groups");
    await waitFor(() => expect(panel.textContent ?? "").toMatch(/2 members/));
    expect(panel.textContent ?? "").not.toMatch(/members unknown/i);
  });

  // -----------------------------------------------------------------------
  // The EXPANDED per-group user list — `CognitoGroupMembers`
  //
  // The fourth `?? []` named in this file's own docstring
  // (`setUsers(json.users ?? [])`) is guarded, and until now nothing
  // exercised it. The three tests above look like they cover it and do not:
  // they never expand a row, so `CognitoGroupMembers` never mounts. What they
  // pin is the section-level blast-radius PROBE — a different call site
  // against the same route, whose failure is recorded in `memberErrors`.
  //
  // This is the site that renders "No users in this group yet." — an
  // assertion about a group an operator is deciding whether to empty or
  // delete, and one made where the error text IS on screen only because the
  // row is open.
  // -----------------------------------------------------------------------

  it("treats a malformed 200 as unknown rather than 'No users in this group yet.'", async () => {
    state.usersMode = "malformed";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await user_.click(
      await screen.findByTestId("cognito-group-toggle-acme-devs")
    );
    const detail = await screen.findByTestId("cognito-group-detail-acme-devs");
    await waitFor(() =>
      expect(detail.textContent ?? "").toMatch(/malformed cognito group users/i)
    );
    expect(detail.textContent ?? "").not.toMatch(/no users in this group yet/i);
  });

  it("survives a 200 whose user list is not a list", async () => {
    // `users.length === 0` is false for `"nope"`, so the value reached
    // `users.map()` and took the expanded row down with it.
    state.usersMode = "notArray";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await user_.click(
      await screen.findByTestId("cognito-group-toggle-acme-devs")
    );
    const detail = await screen.findByTestId("cognito-group-detail-acme-devs");
    await waitFor(() =>
      expect(detail.textContent ?? "").toMatch(/malformed cognito group users/i)
    );
    expect(detail.textContent ?? "").not.toMatch(/no users in this group yet/i);
  });

  it("still says 'No users in this group yet.' for a genuinely empty group", async () => {
    // The control. `users: []` is already the `beforeEach` default, spelled
    // here anyway so the test states its own premise.
    state.users = [];
    state.usersMode = "ok";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await user_.click(
      await screen.findByTestId("cognito-group-toggle-acme-devs")
    );
    const detail = await screen.findByTestId("cognito-group-detail-acme-devs");
    await waitFor(() =>
      expect(detail.textContent ?? "").toMatch(/no users in this group yet/i)
    );
    expect(detail.textContent ?? "").not.toMatch(/malformed/i);
  });

  // -----------------------------------------------------------------------
  // Section a's COLLAPSED header — the third panel
  //
  // The mappings and groups badges were taught to say "unknown". This one was
  // not, and its failure mode is quieter than theirs: `summary={data ? <Badge/>
  // : undefined}` removed the badge entirely, so a failed read left the folded
  // header bare — identical to a header still loading, and carrying no claim an
  // operator could disbelieve.
  // -----------------------------------------------------------------------

  it("says 'unknown' on the collapsed tenant header instead of dropping the badge", async () => {
    state.myTenantsOk = false;
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-members-my-tenants-summary");
    // Both directions: the marker is present AND the header is not silent.
    // The silence is the regression — the badge used to be absent here, which
    // is why `findByTestId` resolving at all is half the assertion.
    await waitFor(() => expect(badgeText(badge)).toMatch(/unknown/i));
    expect(badgeText(badge)).not.toBe("");
  });

  it("still shows the home tenant on the collapsed header when the read landed", async () => {
    // The control: qualifying the signal must not destroy it.
    state.myTenants = { home_tenant_slug: "acme", tenants: [] };
    render(<MembersPage />);

    const badge = await screen.findByTestId("coord-members-my-tenants-summary");
    await waitFor(() => expect(badgeText(badge)).toBe("acme"));
    expect(badgeText(badge)).not.toMatch(/unknown/i);
  });

  // -----------------------------------------------------------------------
  // One tone for one meaning
  //
  // Both halves of a group row's blast radius fail the same way and are read
  // in one glance. `members unknown` in the default foreground beside an amber
  // `tenant mappings unknown` reads as one caveat and one fact.
  // -----------------------------------------------------------------------

  it("marks both halves of an unreadable blast radius in the same tone", async () => {
    state.usersMode = "error";
    state.mappingsMode = "error";
    const user_ = userEvent.setup();
    render(<MembersPage />);

    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    const members = await screen.findByTestId(
      "cognito-group-members-count-acme-devs"
    );
    const mappings = await screen.findByTestId(
      "cognito-group-mappings-unknown-acme-devs"
    );
    await waitFor(() =>
      expect(members.textContent ?? "").toMatch(/members unknown/i)
    );
    expect(members.className).toMatch(/text-amber-600/);
    // Asserted against the sibling rather than against a literal, so the two
    // cannot drift apart without this failing.
    expect(mappings.className).toMatch(/text-amber-600/);
  });
});
