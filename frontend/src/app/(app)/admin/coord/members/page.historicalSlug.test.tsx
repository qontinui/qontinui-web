/**
 * /admin/coord/members — group mappings stored under a renamed tenant's
 * HISTORICAL slug (qontinui-coord#2473, plan `2026-09-17-tenant-rename`).
 *
 * coord now LISTS a group → tenant mapping whose stored `tenant_slug` is a slug
 * the tenant was renamed away from, and marks it with two additive fields:
 * `current_slug` (the slug today) and `historical_slug` (stored ≠ current).
 * Such a row still grants at every login, so it must not look identical to a
 * current one. Pinned here:
 *
 * - a historical row carries a "renamed → <current_slug>" hint, in both the
 *   mappings table and the Cognito group's mapping chips;
 * - a non-historical row, and a row from an older coord that omits both
 *   fields, carry no hint — and each gate is pinned on its own: `historical_slug`
 *   must be exactly `true`, and a usable `current_slug` must be present;
 * - deleting the historical row still sends the STORED `tenant_slug` — the
 *   DELETE key is what coord stored, not what the tenant is called today;
 * - the collapsed panel header counts the historical rows, so they are
 *   noticeable without opening the table that carries their hint;
 * - "Move to <current_slug>" POSTs under the current slug FIRST and deletes
 *   the stored row only after that landed, so a failed create never drops
 *   the grant, and a failed delete is reported as leaving the old row behind.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    // Superuser, so the Cognito groups panel (whose chips carry slugs) loads.
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

import { toast } from "sonner";
import MembersPage from "./page";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const BASE = {
  auto_create_tenant: true,
  created_at: "2026-08-01T00:00:00Z",
  tenant_id: "11111111-1111-1111-1111-111111111111",
};

/** Stored under `acme`; the tenant is now `acme-renamed`. */
const HISTORICAL = {
  ...BASE,
  group_id: "acme-devs",
  tenant_slug: "acme",
  role: "operator",
  current_slug: "acme-renamed",
  historical_slug: true,
};

/** Stored under the current slug — coord says so explicitly. */
const CURRENT = {
  ...BASE,
  group_id: "acme-devs",
  tenant_slug: "acme-renamed",
  role: "admin",
  current_slug: "acme-renamed",
  historical_slug: false,
};

/** From a coord build predating #2473: neither field present. */
const LEGACY = {
  ...BASE,
  group_id: "ops",
  tenant_slug: "opsco",
  role: "operator",
};

/** Flagged historical, but no `current_slug` to name: no hint. */
const HISTORICAL_NO_CURRENT = {
  ...BASE,
  group_id: "g-missing",
  tenant_slug: "old-missing",
  role: "operator",
  historical_slug: true,
};

/** Flagged historical, `current_slug` empty: no hint. */
const HISTORICAL_EMPTY_CURRENT = {
  ...BASE,
  group_id: "g-empty",
  tenant_slug: "old-empty",
  role: "operator",
  current_slug: "",
  historical_slug: true,
};

/**
 * `historical_slug: false` with a DIFFERING `current_slug`: coord's flag is the
 * authority, so the page must not infer "historical" from the slug mismatch.
 */
const NOT_FLAGGED_DIFFERING = {
  ...BASE,
  group_id: "g-false",
  tenant_slug: "stored-slug",
  role: "operator",
  current_slug: "other-slug",
  historical_slug: false,
};

const deleteBodies: Array<Record<string, unknown>> = [];
const postBodies: Array<Record<string, unknown>> = [];
/** Order of mutating calls, to pin create-before-delete. */
const mutations: string[] = [];
let postStatus = 200;
let deleteStatus = 200;
/** Rows appended to the listing for one test. */
let extraRows: Array<Record<string, unknown>> = [];
/** When set, REPLACES the listing's fixture rows for one test. */
let listRows: Array<Record<string, unknown>> | null = null;
/** Status of the listing GET; non-200 makes the read fail. */
let listStatus = 200;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  deleteBodies.length = 0;
  postBodies.length = 0;
  mutations.length = 0;
  postStatus = 200;
  deleteStatus = 200;
  extraRows = [];
  listRows = null;
  listStatus = 200;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.endsWith("/coord/group-tenant-roles")) {
      if (method === "DELETE") {
        deleteBodies.push(JSON.parse(String(init?.body)));
        mutations.push("DELETE");
        return jsonResponse(deleteStatus, deleteStatus === 200 ? {} : { detail: "delete boom" });
      }
      if (method === "POST") {
        postBodies.push(JSON.parse(String(init?.body)));
        mutations.push("POST");
        return jsonResponse(postStatus, postStatus === 200 ? {} : { detail: "create boom" });
      }
      if (listStatus !== 200) {
        return jsonResponse(listStatus, { detail: "list boom" });
      }
      return jsonResponse(200, {
        group_tenant_roles: listRows ?? [
          HISTORICAL,
          CURRENT,
          LEGACY,
          HISTORICAL_NO_CURRENT,
          HISTORICAL_EMPTY_CURRENT,
          NOT_FLAGGED_DIFFERING,
          ...extraRows,
        ],
      });
    }
    if (path.endsWith("/coord/cognito/groups")) {
      return jsonResponse(200, {
        groups: [
          {
            group_name: "acme-devs",
            description: null,
            creation_date: "2026-08-01T00:00:00Z",
            last_modified_date: null,
            precedence: null,
          },
        ],
      });
    }
    if (/\/coord\/cognito\/groups\/[^/]+\/users(\?|$)/.test(path)) {
      return jsonResponse(200, { users: [] });
    }
    if (path.endsWith("/coord/my-tenants")) {
      return jsonResponse(200, { home_tenant_id: null, tenants: [] });
    }
    if (path.endsWith("/coord/members")) {
      return jsonResponse(200, { operators: [] });
    }
    return jsonResponse(200, {});
  });
});

async function openAdvanced(user_: ReturnType<typeof userEvent.setup>) {
  const outer = await screen.findByRole("button", {
    name: /advanced: auto-provision by sso group/i,
  });
  if (outer.getAttribute("data-state") !== "open") await user_.click(outer);
}

async function openMappingsTable() {
  const user_ = userEvent.setup();
  render(<MembersPage />);
  await openAdvanced(user_);
  await user_.click(
    await screen.findByRole("button", {
      name: /group → tenant → role mappings/i,
    })
  );
  const table = await screen.findByTestId("coord-group-roles-table");
  return { user_, table };
}

describe("historical-slug group mappings", () => {
  it("flags a historical row with a hint naming current_slug", async () => {
    await openMappingsTable();
    const hint = await screen.findByTestId(
      "group-tenant-role-historical-acme-devs-acme-operator"
    );
    expect(hint).toHaveTextContent("renamed → acme-renamed");
    expect(hint.getAttribute("title")).toContain(
      "Re-create it under acme-renamed, then delete this row."
    );
    expect(hint.getAttribute("title")).toContain(
      "It still grants at every login."
    );
  });

  it("shows no hint on a current row or a row with the fields absent", async () => {
    const { table } = await openMappingsTable();
    await screen.findByTestId(
      "group-tenant-role-historical-acme-devs-acme-operator"
    );
    expect(
      screen.queryByTestId(
        "group-tenant-role-historical-acme-devs-acme-renamed-admin"
      )
    ).toBeNull();
    expect(
      screen.queryByTestId("group-tenant-role-historical-ops-opsco-operator")
    ).toBeNull();
    // Exactly one hint in the TABLE (scoped, so a Cognito chip rendering
    // elsewhere cannot change the count): the historical row's.
    expect(within(table).getAllByText(/renamed →/)).toHaveLength(1);
  });

  it("gates the hint on historical_slug === true AND a usable current_slug", async () => {
    const { table } = await openMappingsTable();
    await within(table).findByTestId(
      "group-tenant-role-historical-acme-devs-acme-operator"
    );
    // The rows themselves rendered — otherwise the absences below are vacuous.
    for (const key of [
      "g-missing:old-missing:operator",
      "g-empty:old-empty:operator",
      "g-false:stored-slug:operator",
    ]) {
      expect(within(table).getByTestId(`delete-mapping-${key}`)).toBeTruthy();
    }
    for (const id of [
      // historical_slug true, current_slug missing
      "group-tenant-role-historical-g-missing-old-missing-operator",
      // historical_slug true, current_slug ""
      "group-tenant-role-historical-g-empty-old-empty-operator",
      // historical_slug false, current_slug differs from tenant_slug
      "group-tenant-role-historical-g-false-stored-slug-operator",
    ]) {
      expect(within(table).queryByTestId(id)).toBeNull();
    }
    expect(within(table).queryByText(/renamed → other-slug/)).toBeNull();
  });

  it("deletes the historical row by its STORED tenant_slug", async () => {
    const { user_ } = await openMappingsTable();
    await user_.click(
      await screen.findByTestId("delete-mapping-acme-devs:acme:operator")
    );
    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    expect(deleteBodies[0]).toEqual({
      group_id: "acme-devs",
      tenant_slug: "acme",
      role: "operator",
    });
  });

  it("appends the hint to the Cognito group's mapping chip", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(user_);
    await user_.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    const historical = await screen.findByTestId(
      "cognito-group-mapping-acme-devs-acme-operator"
    );
    expect(historical).toHaveTextContent("renamed → acme-renamed");
    // The chip has no per-mapping delete — the destructive action beside it
    // is the POOL-WIDE group delete — so it must not say "delete this row".
    const chipTitle = historical.getAttribute("title") ?? "";
    expect(chipTitle).toContain(
      "Re-create it under acme-renamed, then delete the old mapping in the group → tenant mappings table."
    );
    expect(chipTitle).not.toContain("this row");
    const current = screen.getByTestId(
      "cognito-group-mapping-acme-devs-acme-renamed-admin"
    );
    expect(current).not.toHaveTextContent(/renamed →/);
    expect(current).not.toHaveAttribute("title");
  });

  it("offers Move only on a historical row", async () => {
    const { table } = await openMappingsTable();
    const move = await within(table).findByTestId(
      "move-mapping-acme-devs:acme:operator"
    );
    expect(move).toHaveTextContent("Move to acme-renamed");
    for (const key of [
      "acme-devs:acme-renamed:admin",
      "ops:opsco:operator",
      "g-missing:old-missing:operator",
      "g-empty:old-empty:operator",
      "g-false:stored-slug:operator",
    ]) {
      expect(within(table).queryByTestId(`move-mapping-${key}`)).toBeNull();
    }
  });

  it("Move creates under current_slug, then deletes the stored row", async () => {
    const { user_ } = await openMappingsTable();
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() => expect(deleteBodies).toHaveLength(1));
    expect(mutations).toEqual(["POST", "DELETE"]);
    expect(postBodies[0]).toEqual({
      group_id: "acme-devs",
      tenant_slug: "acme-renamed",
      role: "operator",
      auto_create_tenant: true,
    });
    expect(deleteBodies[0]).toEqual({
      group_id: "acme-devs",
      tenant_slug: "acme",
      role: "operator",
    });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Mapping moved to acme-renamed")
    );
  });

  it("Move does not delete when the create fails", async () => {
    postStatus = 500;
    const { user_ } = await openMappingsTable();
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mutations).toEqual(["POST"]);
    expect(deleteBodies).toHaveLength(0);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(
      /Move failed: .*The mapping under acme is unchanged\./
    );
  });

  it("Move reports the old row left behind when the delete fails", async () => {
    deleteStatus = 500;
    const { user_ } = await openMappingsTable();
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(mutations).toEqual(["POST", "DELETE"]);
    expect(toast.success).not.toHaveBeenCalled();
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toMatch(
      /re-created under acme-renamed, but the old row under acme was NOT deleted/
    );
  });

  it("Move keeps auto_create_tenant of a row already under current_slug", async () => {
    // Same group + role already mapped under the current slug, auto-create
    // off; the historical row has it on. The upsert must not flip it.
    extraRows = [
      {
        ...BASE,
        auto_create_tenant: false,
        group_id: "acme-devs",
        tenant_slug: "acme-renamed",
        role: "operator",
        current_slug: "acme-renamed",
        historical_slug: false,
      },
    ];
    const { user_ } = await openMappingsTable();
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() => expect(postBodies).toHaveLength(1));
    expect(postBodies[0]).toMatchObject({
      tenant_slug: "acme-renamed",
      auto_create_tenant: false,
    });
  });

  it("counts historical rows on the collapsed panel header", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(user_);
    // Only HISTORICAL qualifies: the flag without a usable current_slug, and
    // a differing current_slug without the flag, are not counted.
    const badge = await screen.findByTestId(
      "coord-group-roles-historical-summary"
    );
    expect(badge).toHaveTextContent("1 on a renamed slug");
    expect(screen.queryByTestId("coord-group-roles-table")).toBeNull();
  });

  it("shows no historical count when no row is historical", async () => {
    listRows = [CURRENT, LEGACY, NOT_FLAGGED_DIFFERING];
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(user_);
    await waitFor(() =>
      expect(screen.getByTestId("coord-group-roles-summary")).toHaveTextContent(
        "3"
      )
    );
    expect(
      screen.queryByTestId("coord-group-roles-historical-summary")
    ).toBeNull();
  });

  it("clears the historical count once Move re-points the row", async () => {
    const { user_ } = await openMappingsTable();
    expect(
      screen.getByTestId("coord-group-roles-historical-summary")
    ).toHaveTextContent("1 on a renamed slug");
    // What the reload after a successful move lists: the row now lives under
    // the current slug.
    listRows = [
      { ...HISTORICAL, tenant_slug: "acme-renamed", historical_slug: false },
      CURRENT,
    ];
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-group-roles-summary")).toHaveTextContent(
        "2"
      )
    );
    expect(
      screen.queryByTestId("coord-group-roles-historical-summary")
    ).toBeNull();
  });

  it("hides the historical count when a reload fails", async () => {
    // A failed read leaves the previous rows in state; the count must not
    // keep asserting them beside a summary that now says "unknown".
    const { user_ } = await openMappingsTable();
    expect(
      screen.getByTestId("coord-group-roles-historical-summary")
    ).toBeInTheDocument();
    listStatus = 500;
    await user_.click(
      await screen.findByTestId("move-mapping-acme-devs:acme:operator")
    );
    await waitFor(() =>
      expect(screen.getByTestId("coord-group-roles-summary")).toHaveTextContent(
        "unknown"
      )
    );
    expect(
      screen.queryByTestId("coord-group-roles-historical-summary")
    ).toBeNull();
  });
});
