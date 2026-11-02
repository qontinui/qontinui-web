/**
 * navigationOnly — the marker a control carries when pressing it changes only
 * what is DISPLAYED: a filter, a refresh, a link-like jump, a view switch.
 *
 * Plan `2026-10-23-console-presentation-spaces` D3.2: in presentation mode a
 * lens page renders no enabled control except those marked navigation-only.
 * The presentation test helper (`src/test/presentation.tsx`,
 * `expectPresentationSafe`) treats every enabled button, input and select as a
 * write hazard unless it is disabled, a link, a tab, a pure disclosure, or
 * carries this attribute — so the attribute is a CLAIM about the control's
 * effect, and only a control that cannot change server state may make it.
 *
 * It lives in `console/` rather than in `components/presentation/` because the
 * console primitives that are navigation-only by construction (`FilterTabs`,
 * `FilterChips`, `RefreshButton`) carry it themselves, and `console/` is the
 * base layer: `presentation/` composes `console/`, never the reverse. The
 * presentation barrel re-exports both names.
 *
 * Spread the props rather than spelling the attribute, so a grep for
 * `NAVIGATION_ONLY_PROPS` finds every control that makes the claim.
 */

/** The attribute name. One spelling, shared by the markers and the test helper. */
export const NAVIGATION_ONLY_ATTRIBUTE = "data-presentation-nav";

/** Spread onto a control whose press changes only what is displayed. */
export const NAVIGATION_ONLY_PROPS = {
  [NAVIGATION_ONLY_ATTRIBUTE]: "",
} as const;
