/**
 * The Rename project dialog (plan `2026-09-17-tenant-rename`, Phase D).
 *
 * What each block pins:
 *
 * 1. **Pre-fill.** The fields open on the tenant's CURRENT name and short id,
 *    so "Rename" means "edit", not "retype everything".
 * 2. **The short id check.** A short id that is not canonical says why — and,
 *    where it can, which id was meant — before the round-trip, and holds
 *    submit, because the web proxy would refuse it with a 422 anyway.
 * 3. **Only changed fields are sent.** An unchanged field on the wire is not
 *    harmless: a `slug` equal to the current one still runs coord's slug
 *    checks, and the historical/pinned arms can refuse a rename the operator
 *    never asked for.
 * 4. **Every coord refusal has its own sentence**, checked against literal
 *    copy, and an unknown one is shown verbatim.
 * 5. **Success refreshes the tenant list and says what happened to the home
 *    group** — including when it was NOT moved.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const renameTenantMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("@/components/sessions/api", async () => {
  const actual = await vi.importActual<
    typeof import("@/components/sessions/api")
  >("@/components/sessions/api");
  return {
    ...actual,
    renameTenant: (...args: unknown[]) => renameTenantMock(...args),
  };
});

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ refresh: refreshMock }),
}));

vi.mock("@qontinui/ui-bridge", () => ({
  useUIComponent: () => undefined,
}));

import {
  CoordProjectRenameDialog,
  renameErrorMessage,
  renameSlugProblem,
} from "./CoordProjectRenameDialog";
import {
  parseTenantRenameError,
  TenantRenameError,
} from "@/components/sessions/api";

const TENANT = {
  id: "22222222-2222-2222-2222-222222222222",
  slug: "my-pizzeria",
  name: "My Pizzeria",
};

function renderDialog(onRenamed = vi.fn()) {
  render(
    <CoordProjectRenameDialog
      open
      onOpenChange={() => undefined}
      tenant={TENANT}
      onRenamed={onRenamed}
    />
  );
  return { onRenamed };
}

const nameInput = () =>
  screen.getByTestId("coord-tenant-rename-display-name") as HTMLInputElement;
const slugInput = () =>
  screen.getByTestId("coord-tenant-rename-slug") as HTMLInputElement;
const submitButton = () => screen.getByTestId("coord-tenant-rename-submit");

function renameResult(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: TENANT.id,
    slug: "new-pizzeria",
    display_name: "New Pizzeria",
    previous: { slug: "my-pizzeria", display_name: "My Pizzeria" },
    changed: true,
    group_mappings_moved: 0,
    home_group_to_migrate: "my-pizzeria-home",
    ...overrides,
  };
}

/** A `TenantRenameError` built from the exact body the web proxy returns. */
function proxiedError(status: number, coordBody: Record<string, unknown>) {
  const raw = JSON.stringify({ detail: JSON.stringify(coordBody) });
  const { code, reason, detail, slug } = parseTenantRenameError(raw);
  return new TenantRenameError(status, code, reason, detail, slug);
}

beforeEach(() => {
  vi.clearAllMocks();
  refreshMock.mockResolvedValue(undefined);
  renameTenantMock.mockResolvedValue(renameResult());
});

describe("pre-fill", () => {
  it("opens on the tenant's current name and short id, with submit held", () => {
    renderDialog();
    expect(nameInput().value).toBe("My Pizzeria");
    expect(slugInput().value).toBe("my-pizzeria");
    // Nothing changed yet — nothing to send.
    expect(submitButton()).toBeDisabled();
  });
});

describe("short id check", () => {
  it("shows the home-group id the short id implies while it is valid", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    expect(
      screen.getByTestId("coord-tenant-rename-slug-preview").textContent
    ).toBe("new-pizzeria-home");
    expect(screen.queryByTestId("coord-tenant-rename-slug-problem")).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it("says why a too-short id cannot be used and holds submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "ab");
    expect(
      screen.getByTestId("coord-tenant-rename-slug-problem").textContent
    ).toBe("A short id needs at least 3 letters or digits.");
    expect(submitButton()).toBeDisabled();
  });

  it("names the canonical id when the typed one is merely not canonical", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "New Pizzeria");
    expect(
      screen.getByTestId("coord-tenant-rename-slug-problem").textContent
    ).toBe(
      "A short id uses only lowercase letters, digits and single hyphens — did you mean “new-pizzeria”?"
    );
    expect(submitButton()).toBeDisabled();
  });

  it("pure: canonical ids have no problem, double hyphens do", () => {
    expect(renameSlugProblem("qontinui")).toBeNull();
    expect(renameSlugProblem("a-b-c")).toBeNull();
    expect(renameSlugProblem("a--b")).toContain("did you mean “a-b”");
  });
});

describe("only changed fields are sent", () => {
  it("a name-only edit sends only display_name", async () => {
    const user = userEvent.setup();
    renameTenantMock.mockResolvedValue(
      renameResult({ slug: "my-pizzeria", home_group_to_migrate: null })
    );
    renderDialog();
    await user.clear(nameInput());
    await user.type(nameInput(), "  Pizza Place  ");
    await user.click(submitButton());
    await waitFor(() => expect(renameTenantMock).toHaveBeenCalledTimes(1));
    expect(renameTenantMock).toHaveBeenCalledWith(TENANT.id, {
      display_name: "Pizza Place",
    });
  });

  it("a slug-only edit sends only slug", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
    await waitFor(() => expect(renameTenantMock).toHaveBeenCalledTimes(1));
    expect(renameTenantMock).toHaveBeenCalledWith(TENANT.id, {
      slug: "new-pizzeria",
    });
  });

  it("both edits send both", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(nameInput());
    await user.type(nameInput(), "New Pizzeria");
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
    await waitFor(() => expect(renameTenantMock).toHaveBeenCalledTimes(1));
    expect(renameTenantMock).toHaveBeenCalledWith(TENANT.id, {
      display_name: "New Pizzeria",
      slug: "new-pizzeria",
    });
  });
});

describe("coord refusals — one sentence each", () => {
  const cases: Array<[string, number, Record<string, unknown>, string]> = [
    [
      "empty_patch",
      400,
      { error: "empty_patch" },
      "Nothing changed — edit the name or the short id first.",
    ],
    [
      "invalid_name / empty",
      400,
      { error: "invalid_name", reason: "empty" },
      "The name can't be blank.",
    ],
    [
      "invalid_slug / too_short",
      400,
      { error: "invalid_slug", reason: "too_short" },
      "A short id needs at least 3 letters or digits.",
    ],
    [
      "invalid_slug / unknown reason",
      400,
      { error: "invalid_slug", reason: "not_canonical" },
      "That short id can't be used (not_canonical).",
    ],
    [
      "reserved_name / historical_slug",
      400,
      { error: "reserved_name", reason: "historical_slug" },
      "That short id used to belong to another project and stays reserved for it. Pick a different one.",
    ],
    [
      "reserved_name / fleet_reserved",
      400,
      { error: "reserved_name", reason: "fleet_reserved" },
      "That short id is reserved. Pick a different one.",
    ],
    [
      "reserved_name / group_mapped",
      400,
      { error: "reserved_name", reason: "group_mapped" },
      "That short id is already used by an SSO group mapping. Pick a different one.",
    ],
    [
      "reserved_name / personal_namespace",
      400,
      { error: "reserved_name", reason: "personal_namespace" },
      "Short ids starting with “personal” are reserved. Pick a different one.",
    ],
    [
      "tenant_mismatch",
      403,
      { error: "tenant_mismatch" },
      "The rename was checked against a different project than this one. Reload the page and try again.",
    ],
    [
      "not_admin_in_target_tenant",
      403,
      { error: "not_admin_in_target_tenant" },
      "Only an administrator of this project can rename it.",
    ],
    [
      "tenant_not_found",
      404,
      { error: "tenant_not_found" },
      "This project no longer exists.",
    ],
    [
      "slug_taken",
      409,
      { error: "slug_taken", slug: "new-pizzeria" },
      "The short id “new-pizzeria” is already taken. Pick a different one.",
    ],
    [
      "slug_pinned / configured_default_tenant",
      409,
      { error: "slug_pinned", reason: "configured_default_tenant" },
      "This project's short id can't be changed: it is the deployment's default project. You can still change its name.",
    ],
    [
      "slug_pinned / bootstrap_group_mapping",
      409,
      { error: "slug_pinned", reason: "bootstrap_group_mapping" },
      "This project's short id can't be changed: coord's deployment configuration maps an SSO group to it by that id. You can still change its name.",
    ],
    [
      "slug_pinned / bootstrap_group_mapping_target",
      409,
      { error: "slug_pinned", reason: "bootstrap_group_mapping_target" },
      "That short id is named in coord's deployment SSO group mappings, so it can't be given to this project. Pick a different one.",
    ],
    [
      "slug_pinned / bootstrap_mappings_unreadable",
      409,
      { error: "slug_pinned", reason: "bootstrap_mappings_unreadable" },
      "The short id can't be changed right now: coord could not read its deployment SSO group mappings, so it cannot tell whether the change is safe. You can still change the name.",
    ],
    [
      "concurrent_group_mapping",
      409,
      { error: "concurrent_group_mapping" },
      "An SSO group mapping for this project changed at the same moment, so nothing was renamed. Try again.",
    ],
    [
      "an unknown code is verbatim",
      500,
      { error: "something_new", message: "boom" },
      "Could not rename the project (500): boom",
    ],
  ];

  it.each(cases)("%s", (_label, status, body, expected) => {
    expect(renameErrorMessage(proxiedError(status, body))).toBe(expected);
  });

  it("renders coord's refusal in the alert box after submit", async () => {
    const user = userEvent.setup();
    renameTenantMock.mockRejectedValue(
      proxiedError(409, { error: "slug_taken", slug: "new-pizzeria" })
    );
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
    const alert = await screen.findByTestId("coord-tenant-rename-error");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toBe(
      "The short id “new-pizzeria” is already taken. Pick a different one."
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe("success", () => {
  it("refreshes the tenant list, reports back, and shows the home-group outcome", async () => {
    const user = userEvent.setup();
    renameTenantMock.mockResolvedValue(
      renameResult({
        home_group_migration: {
          status: "requires_superuser",
          detail:
            "Cognito group “my-pizzeria-home” was not moved: moving a home group needs a platform superuser.",
        },
      })
    );
    const { onRenamed } = renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());

    const outcome = await screen.findByTestId("coord-tenant-rename-home-group");
    expect(outcome).toHaveAttribute("data-status", "requires_superuser");
    expect(outcome.textContent).toContain("Home group not moved");
    expect(outcome.textContent).toContain("needs a platform superuser");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("coord-tenant-rename-result-slug").textContent
    ).toBe("new-pizzeria · was my-pizzeria");
  });

  it("a migrated home group says so", async () => {
    const user = userEvent.setup();
    renameTenantMock.mockResolvedValue(
      renameResult({
        home_group_migration: {
          status: "migrated",
          detail: "Created “new-pizzeria-home” and copied 2 member(s).",
        },
      })
    );
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
    const outcome = await screen.findByTestId("coord-tenant-rename-home-group");
    expect(outcome).toHaveAttribute("data-status", "migrated");
    expect(outcome.textContent).toContain("Home group moved");
  });
});
