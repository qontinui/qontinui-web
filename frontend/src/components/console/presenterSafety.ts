/**
 * presenterSafety — the presenter's own safety controls: the ONLY controls
 * besides navigation that presentation mode keeps live on screen (plan
 * `2026-10-23-console-presentation-spaces` D3.2).
 *
 * Every other control that changes anything sits inside `OperatorOnly` and is
 * not rendered while presenting. These few stay, because each one acts on THIS
 * screen or THIS presenter's session, and taking it away would leave the
 * presenter unable to stop something happening in front of the audience:
 *
 * | Control | Where | Why it stays |
 * |---|---|---|
 * | `co-pilot-stop` | the "AI co-pilot is active" banner | stops the AI driving this screen (revokes this tab's consent) |
 * | `recording-stop` | the UI Bridge recording indicator | stops recording this screen |
 * | `session-continue` | the session-expiry dialog | keeps the presenter signed in mid-presentation |
 * | `session-sign-out` | the session-expiry dialog | signs the presenter out, or takes an expired session to sign-in |
 *
 * The list is CLOSED. A control claims its place with
 * `presenterSafetyProps(<name>)`, and the presentation test helper
 * (`src/test/presentation.tsx`, `expectPresentationSafe`) allows exactly these
 * names: a marker naming anything else is a violation, so an exemption cannot
 * be minted at a call site. A control that only belongs to the account — "Disable for
 * this account" in the co-pilot banner, say — is not on this list and sits
 * inside `OperatorOnly`; the presenter can stop the co-pilot without it.
 *
 * Lives in `console/` beside `navigationOnly.ts` for the same reason: the
 * shell components that carry it are not presentation components, and
 * `presentation/` composes `console/`, never the reverse. The presentation
 * barrel re-exports it, and the toggle's title and the style guide's §6.5
 * name these controls as the exception they are.
 */

/** The attribute name. One spelling, shared by the markers and the test helper. */
export const PRESENTER_SAFETY_ATTRIBUTE = "data-presentation-safety";

/** The closed list: each safety control, and why presentation mode keeps it. */
export const PRESENTER_SAFETY_CONTROLS = {
  "co-pilot-stop":
    "stops the AI co-pilot driving this screen (revokes this tab's consent)",
  "recording-stop": "stops the UI Bridge recording of this screen",
  "session-continue":
    "keeps the presenter signed in when the session is about to expire",
  "session-sign-out":
    "signs the presenter out, or takes an expired session to sign-in",
} as const;

export type PresenterSafetyControl = keyof typeof PRESENTER_SAFETY_CONTROLS;

/** Whether `name` is one of the listed safety controls. */
export function isPresenterSafetyControl(
  name: string | null
): name is PresenterSafetyControl {
  return (
    name !== null &&
    Object.prototype.hasOwnProperty.call(PRESENTER_SAFETY_CONTROLS, name)
  );
}

/** Spread onto one of the listed safety controls. */
export function presenterSafetyProps(control: PresenterSafetyControl): {
  readonly [PRESENTER_SAFETY_ATTRIBUTE]: PresenterSafetyControl;
} {
  return { [PRESENTER_SAFETY_ATTRIBUTE]: control };
}
