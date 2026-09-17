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
    user: { is_superuser: false },
    loading: false,
  }),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ refresh: vi.fn().mockResolvedValue(undefined) }),
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

beforeEach(() => {
  // `CollapsiblePanel` persists open/closed under its `storageKey`, so a
  // panel one test opened would start open in the next and the click close it.
  localStorage.clear();
  vi.clearAllMocks();
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
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
    expect(open).toHaveAttribute(
      "data-ui-bridge-id",
      "coord.tenant-rename.open"
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
