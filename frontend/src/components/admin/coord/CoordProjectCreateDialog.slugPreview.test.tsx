/**
 * The create-project dialog shows the derived short id AS THE USER TYPES.
 *
 * Plan `2026-08-27-tenant-creation-fix-and-members-page-ux` Phase 1 #7. Coord's
 * contract is reject-don't-mangle (`My Pizzeria!` → `my-pizzeria`, `...` →
 * `400 invalid_name`), and until now this dialog revealed the slug only in the
 * success state — so the contract was legible only to someone who had already
 * succeeded, and surprising to everyone else.
 *
 * ## What each test pins, and how it goes red
 *
 * 1. **The id appears before submit.** Asserted against the derived value, not
 *    merely that some element exists — a preview that renders the raw name
 *    back at the user would satisfy "shows a preview" and teach nothing.
 * 2. **A name that cannot make an id says so, in a sentence.** The assertion
 *    also checks the rule is ABSENT, because the members page one surface over
 *    prints `Must match ^[a-z0-9][a-z0-9-]{0,63}$` and copying that treatment
 *    would otherwise pass as "shows an error".
 * 3. **The preview never claims the name is available.** Coord's reserved-list
 *    and group-mapping rejections cannot be mirrored in a browser, so a bare
 *    id would be read as a promise the client is in no position to make.
 * 4. **Submit is NOT gated on the preview.** This is the load-bearing one. The
 *    mirror is a second implementation of a rule that lives in coord; giving it
 *    a veto would mean a drift makes a legitimate name unusable with no way
 *    through. The dialog must still post a name the preview dislikes and let
 *    coord answer — which is also this file's documented honesty rule 1.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createTenantMock = vi.fn();

vi.mock("@/components/sessions/api", async () => {
  const actual =
    await vi.importActual<typeof import("@/components/sessions/api")>(
      "@/components/sessions/api"
    );
  return {
    ...actual,
    createTenant: (...args: unknown[]) => createTenantMock(...args),
  };
});

vi.mock("@/contexts/tenant-context", () => ({
  useTenant: () => ({ setActiveTenantId: vi.fn() }),
}));

import { CoordProjectCreateDialog } from "./CoordProjectCreateDialog";

/** The machine constraint that must never reach the operator's eyes. */
const RAW_CONSTRAINT = "[a-z0-9]";

function renderDialog() {
  return render(
    <CoordProjectCreateDialog open onOpenChange={() => undefined} />
  );
}

const nameInput = () => screen.getByTestId("coord-project-create-name");
const submitButton = () => screen.getByTestId("coord-project-create-submit");

beforeEach(() => {
  vi.clearAllMocks();
  createTenantMock.mockResolvedValue({
    tenant_id: "11111111-1111-1111-1111-111111111111",
    slug: "my-pizzeria",
    display_name: "My Pizzeria!",
  });
});

describe("live slug preview", () => {
  it("shows nothing until something is typed", () => {
    renderDialog();
    expect(
      screen.queryByTestId("coord-project-create-preview")
    ).not.toBeTruthy();
  });

  it("derives the id coord would derive, before any request", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "My Pizzeria!");

    expect(
      screen.getByTestId("coord-project-create-preview-slug").textContent
    ).toBe("my-pizzeria");
    // The whole point is that this costs no round-trip.
    expect(createTenantMock).not.toHaveBeenCalled();
  });

  it("updates as the name changes rather than freezing on first render", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "Joe");
    expect(
      screen.getByTestId("coord-project-create-preview-slug").textContent
    ).toBe("joe");

    await user.type(nameInput(), "s Diner");
    expect(
      screen.getByTestId("coord-project-create-preview-slug").textContent
    ).toBe("joes-diner");
  });

  it("does not promise the id is available", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "My Pizzeria!");

    // Coord still owns `reserved_slug_reason` (its own deployment config) and
    // `slug_is_group_mapped` (a read inside the create transaction), so the
    // preview has to say it is only a derivation.
    expect(
      screen.getByTestId("coord-project-create-preview").textContent
    ).toContain("checked when you create it");
  });
});

describe("a name that cannot produce an id", () => {
  it("says so in a sentence, without printing the rule", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "...");

    const problem = screen.getByTestId("coord-project-create-preview-problem");
    expect(problem.textContent).toContain("no letters or digits");
    expect(problem.textContent).not.toContain(RAW_CONSTRAINT);
    expect(
      screen.queryByTestId("coord-project-create-preview-slug")
    ).not.toBeTruthy();
  });

  it("names the minimum length rather than the bound alone", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "ab");

    expect(
      screen.getByTestId("coord-project-create-preview-problem").textContent
    ).toContain("at least 3");
  });

  it("STILL submits it — the preview has no veto", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(nameInput(), "ab");

    // The mirror lives in the browser; the rule lives in coord. If this button
    // were disabled, a drift in the mirror would make a name coord accepts
    // unreachable — and there would be no way for the user to find that out.
    expect(submitButton()).not.toBeDisabled();

    await user.click(submitButton());
    expect(createTenantMock).toHaveBeenCalledWith({ display_name: "ab" });
  });

  it("still refuses an empty name, which is the ONE client-side gate", async () => {
    renderDialog();
    expect(submitButton()).toBeDisabled();
  });
});
