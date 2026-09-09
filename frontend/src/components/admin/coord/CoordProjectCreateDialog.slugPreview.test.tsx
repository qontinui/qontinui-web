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
import {
  parseTenantCreateError,
  TenantCreateError,
} from "@/components/sessions/api";

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

/**
 * The preview and coord's answer are two renderings of ONE rejection.
 *
 * #1183 made them agree — `projectCreateErrorMessage`'s `invalid_name` arm now
 * renders coord's reason through `projectSlugProblemMessage`, the preview's own
 * function. It asserted that agreement as a PURE FUNCTION, and both surfaces
 * are rendered by this component at the same time, so the agreement was never
 * looked at on screen. Rendered, it printed the identical sentence twice, both
 * in `text-destructive`, stacked.
 *
 * The second half is worse and is the same defect displaced in time: the error
 * box was cleared only on open and on the next submit, never when the name
 * changed. Coord's answer is about the name that was SUBMITTED, so editing
 * `ab` into `abc` left "A short id needs at least 3 letters or digits." sitting
 * under a preview reading `Short id: abc` — a precise claim about a name the
 * field no longer held, which is exactly the contradiction #1183 existed to
 * remove.
 */
describe("the preview and coord's answer, on one surface", () => {
  /** Reject the way `createTenant` really does — through both envelopes. */
  function rejectWith(status: number, coordBody: Record<string, unknown>) {
    const wire = JSON.stringify({ detail: JSON.stringify(coordBody) });
    const { code, detail } = parseTenantCreateError(wire);
    createTenantMock.mockRejectedValue(
      new TenantCreateError(status, code, detail)
    );
  }

  const TOO_SHORT = "A short id needs at least 3 letters or digits.";

  it("says one rejection ONCE, not twice", async () => {
    const user = userEvent.setup();
    rejectWith(400, { error: "invalid_name", reason: "too_short" });
    renderDialog();

    await user.type(nameInput(), "ab");
    // Before the request there is one sentence, in the preview.
    expect(
      screen.getByTestId("coord-project-create-preview-problem").textContent
    ).toBe(TOO_SHORT);

    await user.click(submitButton());

    // After it there is still ONE. Counting the matches is the assertion:
    // "the error box says the right thing" passes just as well when the
    // preview is saying it a second time directly above.
    expect(await screen.findAllByText(TOO_SHORT)).toHaveLength(1);
    // The half that survives is the one that ANNOUNCES — coord answered the
    // click, and `role="alert"` is what tells a screen reader so.
    expect(screen.getByTestId("coord-project-create-error").textContent).toBe(
      TOO_SHORT
    );
    expect(
      screen.queryByTestId("coord-project-create-preview-problem")
    ).not.toBeTruthy();
  });

  it("drops coord's answer once the name it was about is gone", async () => {
    const user = userEvent.setup();
    rejectWith(400, { error: "invalid_name", reason: "too_short" });
    renderDialog();

    await user.type(nameInput(), "ab");
    await user.click(submitButton());
    expect(
      await screen.findByTestId("coord-project-create-error")
    ).toBeTruthy();

    await user.type(nameInput(), "c");

    // `abc` derives a perfectly good id. A sentence saying it needs at least
    // three characters is no longer about anything on screen.
    expect(
      screen.getByTestId("coord-project-create-preview-slug").textContent
    ).toBe("abc");
    expect(screen.queryByTestId("coord-project-create-error")).not.toBeTruthy();
    expect(nameInput().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("brings it back if the name comes back", async () => {
    const user = userEvent.setup();
    rejectWith(400, { error: "invalid_name", reason: "too_short" });
    renderDialog();

    await user.type(nameInput(), "ab");
    await user.click(submitButton());
    await user.type(nameInput(), "c");
    expect(screen.queryByTestId("coord-project-create-error")).not.toBeTruthy();

    await user.keyboard("{Backspace}");

    // Coord's answer for `ab` is still coord's answer for `ab`. Discarding it
    // would send the user back for a round-trip to be told the same thing.
    expect(screen.getByTestId("coord-project-create-error").textContent).toBe(
      TOO_SHORT
    );
    expect(screen.getAllByText(TOO_SHORT)).toHaveLength(1);
  });

  it("keeps an answer the preview could NOT have given", async () => {
    const user = userEvent.setup();
    rejectWith(409, { error: "slug_taken", slug: "my-pizzeria" });
    renderDialog();

    await user.type(nameInput(), "My Pizzeria!");
    await user.click(submitButton());

    // `slug_taken` and `reserved_name` are the answers the preview is
    // structurally unable to mirror, so nothing is being said twice here and
    // both halves must stay: the id the name derives, and the fact it is gone.
    expect(
      (await screen.findByTestId("coord-project-create-error")).textContent
    ).toBe("That name is taken. Pick a different one.");
    expect(
      screen.getByTestId("coord-project-create-preview-slug").textContent
    ).toBe("my-pizzeria");
  });
});
