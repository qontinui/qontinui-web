/**
 * /admin/coord/members — an operator with no email renders the placeholder.
 *
 * coord's `get_operators_list` includes operators who hold a role in the
 * viewed tenant but are homed elsewhere (qontinui-coord#2409), and types
 * `email` as nullable (defensively — the column is NOT NULL) for the rows it
 * now reads from other tenants. qontinui-web#1474
 * widened `OperatorRow.email` to `string | null` and gave both render sites
 * the page's "—" fallback; this file pins them, so a row never renders as a
 * blank cell or a literal "null".
 *
 * Stub conventions follow the sibling files in this directory.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const FOREIGN_OPERATOR = {
  operator_id: "op-foreign",
  email: null,
  display_name: null,
  sso_provider: null,
  last_login_at: null,
  created_at: "2026-08-01T00:00:00Z",
  roles: ["operator"],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.endsWith("/coord/members")) {
      return jsonResponse(200, { operators: [FOREIGN_OPERATOR] });
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
  });
});

describe("/admin/coord/members — operator with a null email", () => {
  it("renders the placeholder in the table row, never blank or 'null'", async () => {
    render(<MembersPage />);
    const row = await screen.findByTestId("member-row-op-foreign");
    // Locate the cell by its column header, not by position: the fixture's
    // display_name is null too and renders the same placeholder.
    const headers = within(screen.getByTestId("coord-members-table"))
      .getAllByRole("columnheader")
      .map((h) => h.textContent?.trim());
    const emailCell =
      within(row).getAllByRole("cell")[headers.indexOf("Email")];
    expect(emailCell).toBeDefined();
    expect(emailCell.textContent?.trim()).toBe("—");
    expect(row.textContent ?? "").not.toMatch(/null|undefined/);
  });

  it("names the operator with the placeholder in the expanded detail", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await user_.click(await screen.findByTestId("member-row-op-foreign"));
    const detail = await screen.findByTestId("member-row-detail");
    const sentence = within(detail).getByText(/holds 1 role in this tenant/);
    expect(sentence.textContent?.trim()).toBe("— holds 1 role in this tenant.");
    expect(detail.textContent ?? "").not.toMatch(/null|undefined/);
  });
});
