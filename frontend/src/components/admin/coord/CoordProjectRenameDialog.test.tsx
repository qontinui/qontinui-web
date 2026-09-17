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
import { act, render, screen, waitFor } from "@testing-library/react";
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

const warnMock = vi.fn();

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({
    warn: (...args: unknown[]) => warnMock(...args),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ refresh: refreshMock }),
}));

/** The options of the most recent `useUIComponent` registration. */
let lastUIComponent: {
  actions: Array<{
    id: string;
    effect?: string;
    handler: () => Promise<unknown>;
  }>;
} | null = null;

vi.mock("@qontinui/ui-bridge", () => ({
  useUIComponent: (options: typeof lastUIComponent) => {
    lastUIComponent = options;
  },
}));

import {
  CoordProjectRenameDialog,
  homeGroupHeadline,
  isRenameOutcomeUnknown,
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

function renderDialog(onRenamed = vi.fn(), onOutcomeUnknown = vi.fn()) {
  render(
    <CoordProjectRenameDialog
      open
      onOpenChange={() => undefined}
      tenant={TENANT}
      onRenamed={onRenamed}
      onOutcomeUnknown={onOutcomeUnknown}
    />
  );
  return { onRenamed, onOutcomeUnknown };
}

function renameAction() {
  const action = lastUIComponent?.actions.find((a) => a.id === "rename-tenant");
  if (!action) throw new Error("rename-tenant action was not registered");
  return action;
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
  refreshMock.mockResolvedValue(true);
  lastUIComponent = null;
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
      400,
      { error: "something_new", message: "boom" },
      "Could not rename the project (400): boom",
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

describe("unknown outcome (504) vs not applied (502)", () => {
  async function submitSlugChange() {
    const user = userEvent.setup();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
  }

  it("a 504 re-reads the tenant list and tells the caller the outcome is unknown", async () => {
    renameTenantMock.mockRejectedValue(
      new TenantRenameError(504, null, null, "timeout waiting for coord")
    );
    const { onRenamed, onOutcomeUnknown } = renderDialog();
    await submitSlugChange();

    const alert = await screen.findByTestId("coord-tenant-rename-error");
    expect(alert.textContent).toContain("may have been applied");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(onOutcomeUnknown).toHaveBeenCalledTimes(1);
    expect(onRenamed).not.toHaveBeenCalled();
  });

  it("a 502 says not applied and re-reads nothing", async () => {
    renameTenantMock.mockRejectedValue(
      new TenantRenameError(502, null, null, "coord is not reachable")
    );
    const { onOutcomeUnknown } = renderDialog();
    await submitSlugChange();

    const alert = await screen.findByTestId("coord-tenant-rename-error");
    expect(alert.textContent).toBe(
      "Coord could not be reached, so the rename was not applied. Try again."
    );
    expect(refreshMock).not.toHaveBeenCalled();
    expect(onOutcomeUnknown).not.toHaveBeenCalled();
  });
});

describe("UI Bridge rename-tenant action", () => {
  it("is declared a write", () => {
    renderDialog();
    expect(renameAction().effect).toBe("write");
  });

  it("rejects when nothing is submittable, and sends nothing", async () => {
    renderDialog();
    await expect(renameAction().handler()).rejects.toThrow(/nothing changed/);
    expect(renameTenantMock).not.toHaveBeenCalled();
  });

  it("resolves with coord's rename result so an agent can observe the effect", async () => {
    const user = userEvent.setup();
    const result = renameResult();
    renameTenantMock.mockResolvedValue(result);
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");

    let resolved: unknown;
    await act(async () => {
      resolved = await renameAction().handler();
    });
    expect(resolved).toEqual(result);
  });

  it("rejects with coord's refusal", async () => {
    const user = userEvent.setup();
    const refusal = new TenantRenameError(
      409,
      "slug_taken",
      null,
      "slug_taken"
    );
    renameTenantMock.mockRejectedValue(refusal);
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");

    let caught: unknown;
    await act(async () => {
      caught = await renameAction()
        .handler()
        .catch((e: unknown) => e);
    });
    expect(caught).toBe(refusal);
  });
});

describe("smaller contracts", () => {
  it("a blank name says so and holds submit", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.clear(nameInput());
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByTestId("coord-tenant-rename-name-problem").textContent
    ).toBe("The name can't be blank.");
    expect(submitButton()).toBeDisabled();
  });

  it("a failed list refresh after a successful rename is a note, not an error", async () => {
    const user = userEvent.setup();
    refreshMock.mockResolvedValue(false);
    renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());

    expect(
      await screen.findByTestId("coord-tenant-rename-list-stale")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("coord-tenant-rename-success")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("coord-tenant-rename-error")).toBeNull();
  });

  it("target_mapped has its own headline", () => {
    expect(homeGroupHeadline({ status: "target_mapped", detail: "" })).toBe(
      "Home group not moved \u2014 its new name is already mapped"
    );
  });
});

describe("5xx outcome honesty", () => {
  /** The body the web proxy sends for a string detail, bare or enveloped. */
  function proxyStringError(status: number, detail: string, envelope = false) {
    const raw = envelope
      ? JSON.stringify({
          error: "BAD_GATEWAY",
          message: detail,
          timestamp: 1,
          path: "http://x/api/v1/operations/tenants/t",
        })
      : JSON.stringify({ detail });
    const parsed = parseTenantRenameError(raw);
    return new TenantRenameError(
      status,
      parsed.code,
      parsed.reason,
      parsed.detail,
      parsed.slug
    );
  }

  const UNKNOWN = "__UNKNOWN__";

  it.each([
    [500, "coord blew up", UNKNOWN],
    [503, "service unavailable", UNKNOWN],
    [504, "timeout waiting for coord", UNKNOWN],
    [
      504,
      "coord's answer was lost in transit (ReadError); the change may have been applied",
      UNKNOWN,
    ],
    [502, "Bad Gateway", UNKNOWN],
    [520, "Web server returned an unknown error", UNKNOWN],
    [524, "A timeout occurred", UNKNOWN],
    [
      502,
      "coord is not reachable",
      "Coord could not be reached, so the rename was not applied. Try again.",
    ],
  ])("%i %s", (status, detail, expected) => {
    const err = proxyStringError(status, detail);
    const want =
      expected === UNKNOWN
        ? "Coord didn't answer cleanly, so the rename may have been applied. The project list is being reloaded to check \u2014 look for the new name before trying again. No home-group move was attempted; check the Cognito groups panel if the short id did change."
        : expected;
    expect(renameErrorMessage(err)).toBe(want);
    expect(isRenameOutcomeUnknown(err)).toBe(expected === UNKNOWN);
  });

  it("reads the proxy detail out of the PRODUCTION envelope too", () => {
    const raw = JSON.stringify({
      error: "BAD_GATEWAY",
      message: "coord is not reachable",
      timestamp: 1,
      path: "http://x/api/v1/operations/tenants/t",
    });
    const parsed = parseTenantRenameError(raw);
    // The envelope's status token is NOT coord's code: coord sent none. A
    // parser that reads the envelope as coord's body reports `BAD_GATEWAY`.
    expect(parsed.code).toBeNull();
    expect(parsed.detail).toBe("coord is not reachable");
    const err = proxyStringError(502, "coord is not reachable", true);
    expect(isRenameOutcomeUnknown(err)).toBe(false);
  });

  it("keeps the envelope's status token as a separate fallback label", () => {
    const parsed = parseTenantRenameError(
      JSON.stringify({
        error: "SERVICE_UNAVAILABLE",
        message: "upstream is down",
        timestamp: 1,
        path: "http://x/api/v1/operations/tenants/t",
      })
    );
    expect(parsed.code).toBeNull();
    expect(parsed.envelopeCode).toBe("SERVICE_UNAVAILABLE");
    // And a bare FastAPI body has no envelope token at all.
    expect(
      parseTenantRenameError(JSON.stringify({ detail: "x" })).envelopeCode
    ).toBeNull();
  });

  it("reads coord's code and reason out of the production envelope", () => {
    const raw = JSON.stringify({
      error: "CONFLICT",
      message: JSON.stringify({
        error: "slug_pinned",
        reason: "configured_default_tenant",
      }),
      timestamp: 1,
      path: "http://x/api/v1/operations/tenants/t",
    });
    const parsed = parseTenantRenameError(raw);
    expect(parsed.code).toBe("slug_pinned");
    expect(parsed.reason).toBe("configured_default_tenant");
  });

  it("a 500 re-reads the tenant list like a 504", async () => {
    const user = userEvent.setup();
    renameTenantMock.mockRejectedValue(proxyStringError(500, "boom"));
    const { onOutcomeUnknown } = renderDialog();
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());
    await screen.findByTestId("coord-tenant-rename-error");
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(onOutcomeUnknown).toHaveBeenCalledTimes(1);
  });
});

describe("a throwing onRenamed cannot turn a rename into a failure", () => {
  it("still shows success in the dialog", async () => {
    const user = userEvent.setup();
    const onRenamed = vi.fn(() => {
      throw new Error("caller bug");
    });
    renderDialog(onRenamed);
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    await user.click(submitButton());

    expect(
      await screen.findByTestId("coord-tenant-rename-success")
    ).toBeInTheDocument();
    expect(onRenamed).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("coord-tenant-rename-error")).toBeNull();
    // The throw was caught and logged — not swallowed silently, and not
    // rendered as a failure.
    expect(warnMock).toHaveBeenCalledWith(
      "onRenamed threw after a successful rename",
      expect.any(Error)
    );
  });

  it("still resolves the bridge action with the result", async () => {
    const user = userEvent.setup();
    const result = renameResult();
    renameTenantMock.mockResolvedValue(result);
    renderDialog(
      vi.fn(() => {
        throw new Error("caller bug");
      })
    );
    await user.clear(slugInput());
    await user.type(slugInput(), "new-pizzeria");
    let resolved: unknown;
    await act(async () => {
      resolved = await renameAction().handler();
    });
    expect(resolved).toEqual(result);
  });
});

describe("live regions are mounted before their messages", () => {
  it("both problem regions exist, empty, while there is no problem", () => {
    renderDialog();
    const nameLive = screen.getByTestId("coord-tenant-rename-name-live");
    const slugLive = screen.getByTestId("coord-tenant-rename-slug-live");
    expect(nameLive).toHaveAttribute("aria-live", "polite");
    expect(slugLive).toHaveAttribute("aria-live", "polite");
    expect(nameLive.textContent).toBe("");
    expect(slugLive.textContent).toBe("");
  });

  it("a problem renders INSIDE the pre-mounted region", async () => {
    const user = userEvent.setup();
    renderDialog();
    const slugLive = screen.getByTestId("coord-tenant-rename-slug-live");
    await user.clear(slugInput());
    await user.type(slugInput(), "ab");
    expect(slugLive).toContainElement(
      screen.getByTestId("coord-tenant-rename-slug-problem")
    );
  });
});

describe("a non-HTTP failure after the request may have gone", () => {
  it.each([
    ["TypeError", new TypeError("Failed to fetch")],
    ["AbortError", Object.assign(new Error("aborted"), { name: "AbortError" })],
  ])(
    "%s is outcome-unknown: re-read and the unknown message",
    async (_l, err) => {
      const user = userEvent.setup();
      renameTenantMock.mockRejectedValue(err);
      const { onOutcomeUnknown } = renderDialog();
      await user.clear(slugInput());
      await user.type(slugInput(), "new-pizzeria");
      await user.click(submitButton());

      const alert = await screen.findByTestId("coord-tenant-rename-error");
      expect(alert.textContent).toContain("may have been applied");
      expect(isRenameOutcomeUnknown(err)).toBe(true);
      expect(refreshMock).toHaveBeenCalledTimes(1);
      expect(onOutcomeUnknown).toHaveBeenCalledTimes(1);
    }
  );

  it("a rejecting refresh on that path is caught, not an unhandled rejection", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const user = userEvent.setup();
      renameTenantMock.mockRejectedValue(
        new TenantRenameError(504, null, null, "timeout waiting for coord")
      );
      refreshMock.mockRejectedValue(new Error("list read blew up"));
      renderDialog();
      await user.clear(slugInput());
      await user.type(slugInput(), "new-pizzeria");
      await user.click(submitButton());
      await screen.findByTestId("coord-tenant-rename-error");
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
