/**
 * A module with no default export, for `readinessTargets.test.ts`: a ready
 * route whose page module renders nothing must fail the loader, not load
 * nothing.
 */
export const notAPage = "this module exports no page component";
