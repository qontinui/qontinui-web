/**
 * /admin/coord/members — the per-tenant Rename action (plan
 * `2026-09-17-tenant-rename` D6).
 *
 * The action is offered on a "Your tenant & roles" row only where the caller
 * holds `admin` IN THAT tenant — the single role coord's `is_tenant_admin`
 * accepts. Pinned in both directions: an admin row HAS it, and a developer
 * (`operator`) row and an `owner`-only row do NOT, because a control coord
 * would refuse is a control that lies.
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
    // Superuser, so the Cognito groups panel (whose mapping chips carry
    // slugs) loads too.
    user: { is_superuser: true },
    loading: false,
  }),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ refresh: vi.fn().mockResolvedValue(true) }),
}));

vi.mock("@qontinui/ui-bridge", () => ({
  useUIComponent: () => undefined,
}));

vi.mock("@/components/ui/destructive-button", () => ({
  isSyntheticClick: () => false,
  DestructiveButton: (props: Record<string, unknown>) => (
    <button type="button" {...props} />
  ),
}));

import MembersPage from "./page";

const ADMIN_TENANT = "11111111-1111-1111-1111-111111111111";
const DEV_TENANT = "22222222-2222-2222-2222-222222222222";
const OWNER_TENANT = "33333333-3333-3333-3333-333333333333";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

let renameAnswer: Record<string, unknown>;

beforeEach(() => {
  // `CollapsiblePanel` persists open/closed under its `storageKey`, so a
  // panel one test opened would start open in the next and the click close it.
  localStorage.clear();
  vi.clearAllMocks();
  renameAnswer = {
    tenant_id: ADMIN_TENANT,
    slug: "acme-renamed",
    display_name: "Acme Corp",
    previous: { slug: "acme", display_name: "Acme Corp" },
    changed: true,
    group_mappings_moved: 0,
    home_group_to_migrate: "acme-home",
  };
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (init?.method === "PATCH" && path.endsWith(`/tenants/${ADMIN_TENANT}`)) {
      return jsonResponse(200, renameAnswer);
    }
    if (path.endsWith("/coord/my-tenants")) {
      return jsonResponse(200, {
        home_tenant_id: ADMIN_TENANT,
        tenants: [
          {
            tenant_id: ADMIN_TENANT,
            slug: "acme",
            display_name: "Acme Corp",
            roles: ["admin"],
          },
          { tenant_id: DEV_TENANT, slug: "devshop", roles: ["operator"] },
          { tenant_id: OWNER_TENANT, slug: "ownerco", roles: ["owner"] },
        ],
      });
    }
    if (path.endsWith("/coord/members"))
      return jsonResponse(200, { operators: [] });
    if (path.endsWith("/coord/group-tenant-roles")) {
      return jsonResponse(200, { group_tenant_roles: [] });
    }
    if (path.endsWith("/coord/cognito/groups"))
      return jsonResponse(200, { groups: [] });
    return jsonResponse(200, {});
  });
});

async function openTenantPanel() {
  const user = userEvent.setup();
  render(<MembersPage />);
  await user.click(
    await screen.findByRole("button", { name: /your tenant & roles/i })
  );
  const card = await screen.findByTestId("coord-members-my-tenants");
  await waitFor(() => expect(card.textContent ?? "").toMatch(/ownerco/));
  return { user, card };
}

describe("Rename action on 'Your tenant & roles'", () => {
  it("is offered on the row where the caller is admin", async () => {
    const { card } = await openTenantPanel();
    const open = within(card).getByTestId(
      `coord-tenant-rename-open-${ADMIN_TENANT}`
    );
    // Suffixed with the tenant id: one page can offer several.
    expect(open).toHaveAttribute(
      "data-ui-bridge-id",
      `coord.tenant-rename.open.${ADMIN_TENANT}`
    );
  });

  it("is NOT offered on a developer row or an owner-only row", async () => {
    const { card } = await openTenantPanel();
    expect(
      within(card).queryByTestId(`coord-tenant-rename-open-${DEV_TENANT}`)
    ).toBeNull();
    expect(
      within(card).queryByTestId(`coord-tenant-rename-open-${OWNER_TENANT}`)
    ).toBeNull();
    // Exactly one Rename across the three rows.
    expect(
      within(card).getAllByRole("button", { name: "Rename" })
    ).toHaveLength(1);
  });

  it("opens the dialog pre-filled with that tenant's name and short id", async () => {
    const { user, card } = await openTenantPanel();
    await user.click(
      within(card).getByTestId(`coord-tenant-rename-open-${ADMIN_TENANT}`)
    );
    const name = (await screen.findByTestId(
      "coord-tenant-rename-display-name"
    )) as HTMLInputElement;
    const slug = screen.getByTestId(
      "coord-tenant-rename-slug"
    ) as HTMLInputElement;
    expect(name.value).toBe("Acme Corp");
    expect(slug.value).toBe("acme");
  });
});

describe("a slug change re-reads every slug-bearing panel", () => {
  /** How many times `/coord/group-tenant-roles` has been read so far. */
  function mappingReads(): number {
    return fetchMock.mock.calls.filter(([url, init]) => {
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      return (
        method === "GET" && String(url).endsWith("/coord/group-tenant-roles")
      );
    }).length;
  }

  async function renameVia(
    edit: (user: ReturnType<typeof userEvent.setup>) => Promise<void>
  ) {
    const { user, card } = await openTenantPanel();
    // Mount both readers of the mappings: the mapping list itself, and the
    // Cognito groups panel whose per-group chips name tenants by slug.
    await user.click(
      await screen.findByRole("button", {
        name: /advanced: auto-provision by sso group/i,
      })
    );
    await user.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await waitFor(() => expect(mappingReads()).toBe(2));

    await user.click(
      within(card).getByTestId(`coord-tenant-rename-open-${ADMIN_TENANT}`)
    );
    await edit(user);
    await user.click(screen.getByTestId("coord-tenant-rename-submit"));
    await screen.findByTestId("coord-tenant-rename-success");
  }

  it("a renamed slug re-reads the mapping list and the Cognito mapping chips", async () => {
    await renameVia(async (user) => {
      const slug = screen.getByTestId("coord-tenant-rename-slug");
      await user.clear(slug);
      await user.type(slug, "acme-renamed");
    });
    await waitFor(() => expect(mappingReads()).toBe(4));
  });

  it("a name-only rename re-reads neither", async () => {
    renameAnswer = {
      ...renameAnswer,
      slug: "acme",
      display_name: "Acme Inc",
      previous: { slug: "acme", display_name: "Acme Corp" },
      home_group_to_migrate: null,
    };
    await renameVia(async (user) => {
      const name = screen.getByTestId("coord-tenant-rename-display-name");
      await user.clear(name);
      await user.type(name, "Acme Inc");
    });
    // Give any (wrong) refetch the chance to fire before asserting its absence.
    await new Promise((r) => setTimeout(r, 50));
    expect(mappingReads()).toBe(2);
  });
});
