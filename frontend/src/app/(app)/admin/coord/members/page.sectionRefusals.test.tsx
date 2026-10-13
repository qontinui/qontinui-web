/**
 * /admin/coord/members — each section read that fails with a `Refusal`
 * envelope renders it through `BackendErrorMessage`, structured.
 *
 * Plan `2026-09-20-the-published-product-works-without-knowing-a-development-environment-exists`
 * D3 adopted the refusal reader on this page's five section-level reads. Since
 * web#1701 moved those reads onto the typed `/operations` client, a rejection
 * reaches each section as a `readJson` status error, and
 * `operationsErrorReading` is what recovers the envelope from it. Nothing else
 * pins that path end to end: a section that went back to
 * `operationsErrorMessage` would still show the same SENTENCE, so each test
 * also asserts `data-refusal="structured"` — the half a regression would drop.
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

const REFUSAL = {
  code: "workspace_root_unresolved",
  next_action: { kind: "set_setting", target: "workspace_root" },
  glossary_terms: ["tenant"],
  observed_at: "2026-09-29T00:00:00Z",
  source: "web_backend",
};

/** `Refusal::render()` for {@link REFUSAL} — the Rust test
 * `render_is_the_table_projection`. */
const RENDERED =
  'No workspace folder could be found for this operation. Set the "workspace_root" setting, then try again.';

type Section = "groups" | "users" | "mappings" | "myTenants" | "operators";

let refused: Section | null = null;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function answer(section: Section, okBody: unknown): Response {
  return refused === section
    ? jsonResponse(409, {
        error: "workspace_root_unresolved",
        refusal: REFUSAL,
      })
    : jsonResponse(200, okBody);
}

function installRouter() {
  fetchMock.mockImplementation(async (url: string) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    if (path.endsWith("/coord/cognito/groups")) {
      return answer("groups", {
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
      return answer("users", { users: [] });
    }
    if (path.endsWith("/coord/group-tenant-roles")) {
      return answer("mappings", { group_tenant_roles: [] });
    }
    if (path.endsWith("/coord/my-tenants")) {
      return answer("myTenants", { home_tenant_id: null, tenants: [] });
    }
    if (path.endsWith("/coord/members")) {
      return answer("operators", { operators: [] });
    }
    return jsonResponse(200, {});
  });
}

/** The section's structured refusal: stamped, and carrying the sentence. */
async function expectStructuredRefusal(within: () => HTMLElement) {
  await waitFor(() =>
    expect(within().querySelector('[data-refusal="structured"]')).not.toBeNull()
  );
  const root = within().querySelector('[data-refusal="structured"]')!;
  expect(root.getAttribute("data-refusal-code")).toBe(
    "workspace_root_unresolved"
  );
  expect(root.querySelector("[data-refusal-sentence]")!.textContent).toBe(
    RENDERED
  );
}

async function openAdvanced(u: ReturnType<typeof userEvent.setup>) {
  const outer = await screen.findByRole("button", {
    name: /advanced: auto-provision by sso group/i,
  });
  if (outer.getAttribute("data-state") !== "open") await u.click(outer);
}

describe("/admin/coord/members — a section read's refusal renders structured", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    refused = null;
    installRouter();
  });

  it("MembersTable", async () => {
    refused = "operators";
    render(<MembersPage />);
    await expectStructuredRefusal(() => document.body);
    // Only this section refused, so exactly one structured refusal is up.
    expect(
      document.body.querySelectorAll('[data-refusal="structured"]')
    ).toHaveLength(1);
  });

  it("MyTenantsCard", async () => {
    refused = "myTenants";
    const u = userEvent.setup();
    render(<MembersPage />);
    await u.click(
      await screen.findByRole("button", { name: /your tenant & roles/i })
    );
    const card = await screen.findByTestId("coord-members-my-tenants");
    await expectStructuredRefusal(() => card);
  });

  it("GroupTenantRolesSection", async () => {
    refused = "mappings";
    const u = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(u);
    await u.click(
      await screen.findByRole("button", { name: /role mappings/i })
    );
    const panel = await screen.findByTestId("coord-members-group-roles");
    await expectStructuredRefusal(() => panel);
  });

  it("CognitoGroupsSection", async () => {
    refused = "groups";
    const u = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(u);
    await u.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await expectStructuredRefusal(() => document.body);
  });

  it("CognitoGroupMembers", async () => {
    refused = "users";
    const u = userEvent.setup();
    render(<MembersPage />);
    await openAdvanced(u);
    await u.click(
      await screen.findByRole("button", { name: /cognito groups/i })
    );
    await u.click(await screen.findByTestId("cognito-group-toggle-acme-devs"));
    const detail = await screen.findByTestId("cognito-group-detail-acme-devs");
    await expectStructuredRefusal(() => detail);
  });
});
