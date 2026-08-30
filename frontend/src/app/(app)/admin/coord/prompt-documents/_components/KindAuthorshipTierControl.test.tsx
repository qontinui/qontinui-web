/**
 * KindAuthorshipTierControl — what the operator can read off the per-kind
 * authorship tier, and what it refuses to do on one click.
 *
 * Five properties, each one a case where the tier value ALONE would leave the
 * operator with a wrong belief that nothing else on the page corrects:
 *
 * 1. **`allow_with_notification` is disclosed in COORD'S words, in BOTH
 *    enforcement states.** The setting's NAME promises an announced write, and
 *    whether the deployed build delivers one is a fact only coord holds. This
 *    used to be "disclosed as not-yet-enforced" and the disclosure was hidden
 *    once coord reported it enforced — which was wrong twice after coord#1702
 *    shipped the precondition: it dropped the residual caveat coord keeps
 *    sending (the subtractive `policy_write` dial can still refuse a write the
 *    tier permitted), and it left three hardcoded "NOT YET ENFORCED" strings
 *    describing a world that had changed. A control that misreports what the
 *    click does is worse than no control, in either direction.
 * 5. **A kind-wide `allow` does not reach coord's named denies, and the control
 *    says so.** `policy` arrives `settable: true` / `floor: false`, so without
 *    `protected_documents` an operator would read an `allow` as opening
 *    `policy/session-protocol` and its two siblings — the documents that ARE
 *    the authority interpreting every other document.
 * 2. **An unreadable stored value is not rendered as "not set".** Both arrive
 *    as `tier: null` and they resolve in OPPOSITE directions — unset falls
 *    through to coord's built-in default, unreadable fail-closes to `deny`.
 * 3. **A FLOOR renders dead, not live.** No stored tier opens `claude_settings`,
 *    so a clickable control there would be a lie about what the click does.
 * 4. **Opening a kind is confirmed; closing it is not.** Opening grants
 *    authorship over every name under the kind, including names nobody has
 *    invented yet, which is exactly the reach that makes it worth pausing over.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  KindTierRow,
  KindTiersResponse,
} from "../_hooks/usePromptDocumentKindTiers";

const getMock = vi.fn();
const putMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/services/service-factory", () => ({
  httpClient: {
    get: (...args: unknown[]) => getMock(...args),
    put: (...args: unknown[]) => putMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    warning: (...a: unknown[]) => toastWarning(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

import { KindAuthorshipTierControl } from "./KindAuthorshipTierControl";

const COORD_WARNING =
  "`allow_with_notification` currently behaves EXACTLY as `allow`: this build " +
  "resolves the tier but does not enforce the notification precondition.";

/**
 * The prose coord sends once the precondition IS enforced — a positive fact
 * plus the one residual the tier cannot promise away.
 *
 * Kept close in shape to the real string rather than reduced to a token,
 * because the property under test is that the console shows COORD'S sentence:
 * a fixture trimmed to "enforced" would pass against a console that rendered a
 * local paraphrase containing the same word.
 */
const COORD_WARNING_ENFORCED =
  "`allow_with_notification` is ENFORCED by this build: a write on that tier is " +
  "refused unless it carries a `notification_ref`. What a tier CANNOT promise " +
  "is that the write then lands: the per-tenant `policy_write` dial is applied " +
  "AFTER authorization and only ever takes capability away.";

function row(over: Partial<KindTierRow> = {}): KindTierRow {
  return {
    kind: "audience_profile",
    tier: null,
    unreadable: false,
    builtin_default_denies: true,
    floor: false,
    settable: true,
    // The SERVER-DERIVED answer, which is what the badge renders. Present in
    // the fixture because a fixture that omitted it would exercise a shape
    // coord never sends — and every badge assertion below would then be
    // testing the UNKNOWN arm rather than the arm it names.
    effective_tier: "deny",
    effective_source: "default",
    ...over,
  };
}

function response(
  kinds: KindTierRow[],
  over: Partial<KindTiersResponse> = {}
): KindTiersResponse {
  return {
    kinds,
    vocabulary: ["deny", "allow", "allow_with_notification"],
    notification_enforced: false,
    warning: COORD_WARNING,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("KindAuthorshipTierControl", () => {
  it("renders coord's own not-yet-enforced disclosure", async () => {
    getMock.mockResolvedValue(response([row()]));
    render(<KindAuthorshipTierControl />);

    const notice = await screen.findByTestId(
      "kind-tier-notification-disclosure"
    );
    // Coord's WORDS, not a local paraphrase.
    expect(notice).toHaveTextContent("behaves EXACTLY as `allow`");
    expect(notice).toHaveAttribute("data-enforced", "false");
  });

  /**
   * The disclosure SURVIVES enforcement, and this test replaces one that
   * asserted the opposite.
   *
   * That older test read `notification_enforced: true` as "there is nothing
   * left to disclose". Coord#1702 shipped the precondition and deliberately
   * KEPT the field rather than deleting it with the caveat it used to carry,
   * because the honest answer became a positive fact plus one residual: the
   * subtractive `policy_write` dial runs AFTER authorization and can still
   * refuse a write this tier permitted, with its own codes. Hiding the box
   * threw that residual away at exactly the moment it was the only thing left
   * to say.
   *
   * What keys off the flag is the STYLING — `data-enforced`, asserted in both
   * arms so this pins which one rendered rather than only that something did.
   */
  it("keeps showing coord's disclosure once the precondition is enforced", async () => {
    getMock.mockResolvedValue(
      response([row()], {
        notification_enforced: true,
        warning: COORD_WARNING_ENFORCED,
      })
    );
    render(<KindAuthorshipTierControl />);

    const notice = await screen.findByTestId(
      "kind-tier-notification-disclosure"
    );
    expect(notice).toHaveAttribute("data-enforced", "true");
    expect(notice).toHaveTextContent("is ENFORCED by this build");
    // The RESIDUAL is the half that only exists on this arm, and the half a
    // console that merely swapped one hardcoded sentence for another would
    // lose. An operator picking this tier needs it before the click.
    expect(notice).toHaveTextContent("policy_write");
  });

  /**
   * The names a kind-wide `allow` does NOT reach, on the row and again in the
   * confirmation.
   *
   * Coord answers these at resolution step 2b, ABOVE the per-kind table this
   * control writes, and sends them precisely so the control stops reading as
   * "allow opens every document of this kind". `policy` arrives
   * `settable: true` and `floor: false`, so nothing else on the row corrects
   * that reading.
   */
  it("names the documents a kind-wide allow will not reach", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          kind: "policy",
          tier: null,
          builtin_default_denies: false,
          effective_tier: "allow",
          effective_source: "default",
          protected_documents: [
            "session-protocol",
            "security-and-autonomy",
            "escalation-bar",
          ],
        }),
      ])
    );
    render(<KindAuthorshipTierControl />);

    const carveOut = await screen.findByTestId("kind-tier-protected-policy");
    expect(carveOut).toHaveTextContent("session-protocol");
    expect(carveOut).toHaveTextContent("security-and-autonomy");
    expect(carveOut).toHaveTextContent("escalation-bar");

    // And AGAIN at the moment of the click, which is where the operator is
    // actually deciding. The row is a reference; the dialog is the decision.
    await userEvent.click(screen.getByRole("button", { name: "allow" }));
    const inDialog = await screen.findByTestId("kind-tier-dialog-protected");
    expect(inDialog).toHaveTextContent("session-protocol");
  });

  /**
   * NON-VACUITY for the test above: a kind with no named denies renders no
   * carve-out at all.
   *
   * An empty list rendered as "0 documents stay closed" would be a positive
   * claim that the kind-wide `allow` reaches everything — which is what a coord
   * predating the field cannot support, since it sends nothing and absence is
   * UNKNOWN.
   */
  it("renders no carve-out for a kind coord reports none for", async () => {
    getMock.mockResolvedValue(response([row({ kind: "audience_profile" })]));
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    expect(
      screen.queryByTestId("kind-tier-protected-audience_profile")
    ).not.toBeInTheDocument();
  });

  it("distinguishes an unreadable stored tier from an unset one", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          kind: "audience_profile",
          tier: null,
          unreadable: false,
          effective_tier: "deny",
          effective_source: "default",
        }),
        row({
          kind: "domain_spec",
          tier: null,
          unreadable: true,
          effective_tier: "deny",
          effective_source: "default",
        }),
      ])
    );
    render(<KindAuthorshipTierControl />);

    const unset = await screen.findByTestId("kind-tier-row-audience_profile");
    expect(unset).toHaveTextContent("not set");

    // THE ASSERTION THIS TEST EXISTS FOR. Same wire value, opposite meanings:
    // enforcement fail-closes to `deny` on this one while the row above falls
    // through to coord's built-in default.
    const bad = screen.getByTestId("kind-tier-row-domain_spec");
    expect(bad).toHaveTextContent("unreadable");
    expect(bad).not.toHaveTextContent("not set");
  });

  it("renders a floored kind's control as dead", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          kind: "claude_settings",
          floor: true,
          settable: false,
          builtin_default_denies: false,
          effective_tier: "deny",
          effective_source: "floor",
        }),
      ])
    );
    render(<KindAuthorshipTierControl />);

    const floored = await screen.findByTestId("kind-tier-row-claude_settings");
    expect(floored).toHaveTextContent("denied — floor");
    expect(floored).toHaveTextContent("No setting can open this kind.");
    // No tier buttons at all — a live-looking control whose click changes
    // nothing is the exact lie the `settable` flag exists to prevent.
    expect(
      screen.queryByRole("button", { name: /allow/i })
    ).not.toBeInTheDocument();
  });

  it("confirms opening a kind, and does not write until confirmed", async () => {
    getMock.mockResolvedValue(response([row()]));
    putMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    // `getByRole`'s `name` already matches the full accessible name, so this
    // does not also match "allow with notification". (`exact` is a ByText
    // option and is silently ignored on ByRole — it was here and did nothing.)
    await user.click(screen.getByRole("button", { name: "allow" }));

    // The click alone must not have written anything.
    expect(putMock).not.toHaveBeenCalled();
    expect(await screen.findByText(/Open the kind/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Open the kind/i }));
    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0][0]).toContain(
      "/coord/prompt-document-kind-tiers/audience_profile"
    );
    expect(putMock.mock.calls[0][1]).toEqual({ tier: "allow" });
  });

  it("closes a kind on one click — the recoverable direction is not gated", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          tier: "allow",
          effective_tier: "allow",
          effective_source: "kind",
        }),
      ])
    );
    putMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    await user.click(screen.getByRole("button", { name: "deny" }));

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock.mock.calls[0][1]).toEqual({ tier: "deny" });
  });

  it("says a failed read is UNKNOWN rather than showing an empty setting list", async () => {
    getMock.mockRejectedValue(new Error("coord is not reachable"));
    render(<KindAuthorshipTierControl />);

    const err = await screen.findByTestId("kind-tier-error");
    expect(err).toHaveTextContent("coord is not reachable");
    // The distinction the 503 exists to preserve: absence of an answer is not
    // an answer of absence.
    expect(err).toHaveTextContent(/UNKNOWN/);
  });

  it("renders an out-of-vocabulary effective tier as UNKNOWN, never as open", async () => {
    // The wire type is a cast over `JSON.parse`, not a check. A coord serving a
    // tier this build predates, or a hand-written row, arrives as an arbitrary
    // string — and it is the exact input coord fail-closes to `deny`.
    getMock.mockResolvedValue(
      response([
        row({
          kind: "audience_profile",
          tier: "allow",
          effective_tier: "allow_when_the_moon_is_full",
          effective_source: "kind",
        }),
      ])
    );
    render(<KindAuthorshipTierControl />);

    const badge = await screen.findByTestId("kind-tier-row-audience_profile");
    expect(badge).toHaveTextContent("unknown");
    // THE ASSERTION THIS TEST EXISTS FOR: it must not read as opened.
    expect(badge).not.toHaveTextContent(/allow_when_the_moon_is_full/);
  });

  it("renders a coord that reports no effective tier as UNKNOWN, never as open", async () => {
    const bare = row({ kind: "audience_profile", tier: "allow" });
    delete (bare as Partial<KindTierRow>).effective_tier;
    delete (bare as Partial<KindTierRow>).effective_source;
    getMock.mockResolvedValue(response([bare]));
    render(<KindAuthorshipTierControl />);

    const badge = await screen.findByTestId("kind-tier-row-audience_profile");
    expect(badge).toHaveTextContent("unknown");
  });

  it("does not say agents may now write when the operator clicked deny", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          tier: "allow",
          effective_tier: "allow",
          effective_source: "kind",
        }),
      ])
    );
    putMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    await user.click(screen.getByRole("button", { name: "deny" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    const said = String(toastSuccess.mock.calls[0][0]);
    // One message served all three tiers, so closing a kind reported
    // "Agents may now write ... : deny" — the display asserting the opposite of
    // what the operator just did, in the permissive direction.
    expect(said).not.toMatch(/may now write/);
    expect(said).toMatch(/no longer/);
  });

  it("warns rather than claiming success when the read-back fails", async () => {
    getMock.mockResolvedValueOnce(response([row()]));
    putMock.mockResolvedValue({});
    const user = userEvent.setup();
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    // The reload after the write fails.
    getMock.mockRejectedValue(new Error("coord is not reachable"));
    await user.click(screen.getByRole("button", { name: "deny" }));

    await waitFor(() => expect(toastWarning).toHaveBeenCalledTimes(1));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(String(toastWarning.mock.calls[0][0])).toMatch(/read-back failed/);
  });

  it("offers the tiers COORD names, not the ones this build was compiled with", async () => {
    getMock.mockResolvedValue(
      response([row()], { vocabulary: ["deny", "allow"] })
    );
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    expect(screen.getByRole("button", { name: "deny" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "allow" })).toBeInTheDocument();
    // Offering it would hand the operator a button coord answers 400 to.
    expect(
      screen.queryByRole("button", { name: "allow with notification" })
    ).not.toBeInTheDocument();
  });

  it("shows readable disclosure text even when coord sends no warning prose", async () => {
    const bare = response([row()]);
    delete (bare as Partial<KindTiersResponse>).notification_enforced;
    delete (bare as Partial<KindTiersResponse>).warning;
    getMock.mockResolvedValue(bare);
    render(<KindAuthorshipTierControl />);

    const notice = await screen.findByTestId(
      "kind-tier-notification-disclosure"
    );
    // An amber box with an icon and NO text reads as a rendering bug rather
    // than as a disclosure. Failing toward saying something is right; failing
    // toward saying nothing visible is not.
    expect(notice.textContent?.trim().length ?? 0).toBeGreaterThan(40);
    expect(notice).toHaveTextContent(/allow_with_notification/);
    // An ABSENT flag is NOT enforcement. This is the permissive direction, so
    // it is pinned rather than left to the strictness of one `===`.
    expect(notice).toHaveAttribute("data-enforced", "false");
  });

  /**
   * `builtin_default_denies` is the only field that says which way "coord's
   * built-in default applies again" falls. On the six intent kinds it falls to
   * DENY, so clearing an opened kind CLOSES it — and the page's whole asymmetry
   * (opening is confirmed, closing and clearing are not) is only defensible if
   * the operator can see that before the click.
   */
  it("names what clearing produces, in the direction the built-in default falls", async () => {
    getMock.mockResolvedValue(
      response([
        row({
          kind: "audience_profile",
          tier: "allow",
          builtin_default_denies: true,
          effective_tier: "allow",
          effective_source: "kind",
        }),
        row({
          kind: "prompt_template",
          tier: "deny",
          builtin_default_denies: false,
          effective_tier: "deny",
          effective_source: "kind",
        }),
      ])
    );
    render(<KindAuthorshipTierControl />);

    await screen.findByTestId("kind-tier-row-audience_profile");
    const clears = screen.getAllByRole("button", { name: "clear" });
    expect(clears[0]).toHaveAttribute(
      "title",
      expect.stringContaining("DENIES agent authorship, so clearing CLOSES it")
    );
    expect(clears[1]).toHaveAttribute(
      "title",
      expect.stringContaining("ALLOWS agent authorship")
    );
  });
});
