/**
 * /admin/coord/members — a Cognito group name is validated NEXT TO THE INPUT.
 *
 * Plan `2026-08-27-tenant-creation-fix-and-members-page-ux`, Phase 0 item 3,
 * layer (a). Web #1099 shipped layers (b) and (c) — the server-side 400 and
 * the retry that stopped being a retry — and deferred this one behind #1062,
 * which has since landed and rewrote the page these inputs live on.
 *
 * ## The behaviour, and how each test would go red
 *
 * 1. **A space is caught before the network.** The production report was
 *    `Add failed: Create group failed: HTTP 502 {"detail":"Could not create
 *    Cognito group."}` for the name `test admins` — three retries and ~7s to
 *    say what the page could have said as the operator typed. `fetchMock` is
 *    asserted to carry no create POST at all, not merely that a toast
 *    appeared: a client-side message that still spends the round-trip is the
 *    thing this layer exists to remove.
 * 2. **The message is a sentence, not the regex.** The tenant-slug field one
 *    card up prints `Must match ^[a-z0-9][a-z0-9-]{0,63}$`, and copying that
 *    treatment here would have been the easy thing to do. Each assertion
 *    checks the constraint pattern is ABSENT as well as that the sentence is
 *    present — otherwise "shows an error" would pass on the regex.
 * 3. **The fix is one click.** `test admins` → `test-admins` is unambiguous,
 *    so the page offers it rather than describing it.
 * 4. **Submit is disabled while invalid**, so the error is not reachable by
 *    clicking through.
 * 5. **A valid name still submits.** Without this the whole feature could be
 *    "achieved" by disabling the button permanently.
 *
 * The panels are `defaultOpen={false}` `CollapsiblePanel`s and Radix unmounts
 * closed content, so every test opens its panel first — the same starting
 * point an operator has, not a test-only escape hatch (see
 * `page.cognitoGroupDelete.test.tsx`, which established the pattern).
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

/** The machine constraint that must never reach the operator's eyes. */
const RAW_CONSTRAINT = "p{L}";

interface Call {
  path: string;
  method: string;
  body: unknown;
}

let calls: Call[] = [];
/** Status for `POST /coord/cognito/groups`; 200 unless a test says otherwise. */
let createStatus = 200;
/** Status for `POST /coord/group-tenant-roles`. */
let mappingStatus = 200;

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
    async (url: string, init?: { method?: string; body?: string }) => {
      const method = init?.method ?? "GET";
      const path = url.replace(/^https?:\/\/[^/]+/, "");
      calls.push({
        path,
        method,
        body: init?.body ? JSON.parse(init.body) : undefined,
      });

      if (method === "POST" && path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(
          createStatus,
          createStatus === 400
            ? { detail: "group_name must not contain spaces or control characters" }
            : { group_name: "ok" }
        );
      }
      if (method === "POST" && path.endsWith("/coord/group-tenant-roles")) {
        return jsonResponse(
          mappingStatus,
          mappingStatus === 200
            ? { ok: true }
            : { detail: "coord refused the mapping" }
        );
      }
      if (path.endsWith("/coord/cognito/groups")) {
        return jsonResponse(200, { groups: [] });
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

const createCalls = () =>
  calls.filter(
    (c) => c.method === "POST" && c.path.endsWith("/coord/cognito/groups")
  );

async function openPanel(
  user_: ReturnType<typeof userEvent.setup>,
  name: RegExp
): Promise<void> {
  await user_.click(await screen.findByRole("button", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  calls = [];
  createStatus = 200;
  mappingStatus = 200;
  installRouter();
});

// ---------------------------------------------------------------------------
// The "Create group" form (Cognito Groups panel)
// ---------------------------------------------------------------------------

describe("Cognito Groups — create-group name validation", () => {
  it("names the problem in a sentence, without printing the regex", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    await user_.type(
      await screen.findByTestId("cognito-new-name"),
      "test admins"
    );

    const hint = await screen.findByTestId("cognito-new-name-problem");
    expect(hint).toHaveTextContent(/can't contain spaces/i);
    expect(hint.textContent).not.toContain(RAW_CONSTRAINT);
  });

  it("marks the field invalid and disables submit", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    const input = await screen.findByTestId("cognito-new-name");
    await user_.type(input, "test admins");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("cognito-create-submit")).toBeDisabled();
  });

  it("never reaches the network for a name Cognito could not hold", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    await user_.type(
      await screen.findByTestId("cognito-new-name"),
      "test admins"
    );
    await user_.click(screen.getByTestId("cognito-create-submit"));

    expect(createCalls()).toHaveLength(0);
  });

  it("guards in the HANDLER too, not only by disabling the button", async () => {
    // The disabled button and the handler's own guard are two layers, and a
    // test that clicks a DISABLED button proves only the first — jsdom will
    // not dispatch the click at all, so removing the handler guard leaves such
    // a test green. An EMPTY field is the case that reaches the handler with
    // the button enabled (there is nothing to complain about until you
    // submit), so it is the one that pins the second layer.
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    const submit = await screen.findByTestId("cognito-create-submit");
    expect(submit).toBeEnabled();
    await user_.click(submit);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls.at(-1)?.[0])).toMatch(/required/i);
    expect(createCalls()).toHaveLength(0);
  });

  it("offers the corrected name as a one-click fix", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    const input = await screen.findByTestId("cognito-new-name");
    await user_.type(input, "test admins");
    await user_.click(await screen.findByTestId("cognito-new-name-problem-fix"));

    await waitFor(() => expect(input).toHaveValue("test-admins"));
    expect(screen.queryByTestId("cognito-new-name-problem")).toBeNull();
    expect(screen.getByTestId("cognito-create-submit")).toBeEnabled();
  });

  it("still submits a valid name", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    await user_.type(
      await screen.findByTestId("cognito-new-name"),
      "test-admins"
    );
    await user_.click(screen.getByTestId("cognito-create-submit"));

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0].body).toMatchObject({ group_name: "test-admins" });
  });

  it("surfaces a server 400 as one sentence, not a nested HTTP blob", async () => {
    createStatus = 400;
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openPanel(user_, /cognito groups/i);

    await user_.type(
      await screen.findByTestId("cognito-new-name"),
      "test-admins"
    );
    await user_.click(screen.getByTestId("cognito-create-submit"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls.at(-1)?.[0]);
    expect(message).toContain("must not contain spaces");
    // The old line read `Create failed: HTTP 400 {"detail":"…"}` — two prefixes
    // and a JSON blob wrapped around the one sentence worth reading.
    expect(message).not.toContain("HTTP 400");
    expect(message).not.toContain("detail");
  });
});

// ---------------------------------------------------------------------------
// The "Add mapping" form (Group → tenant → role mappings panel)
// ---------------------------------------------------------------------------

describe("Group → tenant → role mappings — Group ID validation", () => {
  const openMappings = (user_: ReturnType<typeof userEvent.setup>) =>
    openPanel(user_, /group . tenant . role mappings/i);

  it("validates the Group ID with the same sentence as the create form", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openMappings(user_);

    const input = await screen.findByTestId("map-group-id");
    await user_.type(input, "test admins");

    const hint = await screen.findByTestId("map-group-id-problem");
    expect(hint).toHaveTextContent(/can't contain spaces/i);
    expect(hint.textContent).not.toContain(RAW_CONSTRAINT);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("map-submit")).toBeDisabled();
  });

  it("creates no Cognito group for a name Cognito could not hold", async () => {
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openMappings(user_);

    await user_.type(await screen.findByTestId("map-group-id"), "test admins");
    await user_.type(screen.getByTestId("map-tenant-slug"), "acme");
    await user_.click(screen.getByTestId("map-submit"));

    expect(createCalls()).toHaveLength(0);
  });

  it("says a pre-existing group was REUSED rather than created", async () => {
    createStatus = 409;
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openMappings(user_);

    await user_.type(await screen.findByTestId("map-group-id"), "acme-devs");
    await user_.type(screen.getByTestId("map-tenant-slug"), "acme");
    await user_.click(screen.getByTestId("map-submit"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const message = String(toastSuccess.mock.calls.at(-1)?.[0]);
    // It used to read "Mapping added" — silent about which of the two
    // happened, which is the one thing the operator cannot see for themselves.
    expect(message).toMatch(/already existed/i);
  });

  it("names the orphaned group when the mapping half fails", async () => {
    mappingStatus = 502;
    const user_ = userEvent.setup();
    render(<MembersPage />);
    await openMappings(user_);

    await user_.type(await screen.findByTestId("map-group-id"), "acme-devs");
    await user_.type(screen.getByTestId("map-tenant-slug"), "acme");
    await user_.click(screen.getByTestId("map-submit"));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    const message = String(toastError.mock.calls.at(-1)?.[0]);
    expect(message).toContain("coord refused the mapping");
    // A pool-wide group is now sitting there unmapped, and a non-superuser
    // cannot even see it. Reporting only the mapping failure hides that.
    expect(message).toMatch(/acme-devs/);
    expect(message).toMatch(/unmapped/i);
  });
});
