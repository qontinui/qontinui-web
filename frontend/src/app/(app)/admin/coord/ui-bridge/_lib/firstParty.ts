/**
 * Which repository the dashboard's free text belongs to — the input D3.3's
 * redaction needs (plan `2026-10-23-console-presentation-spaces`): in
 * presentation mode, text renders only when its repository's owner is on the
 * tenant's first-party list (`RedactedText`), and text with no repository is
 * withheld.
 *
 * Exactly ONE thing on this page can be attributed: the runner's OWN app,
 * which the runner registers for itself under {@link RUNNER_APP_ID} and whose
 * screens are authored in the runner's repository. Whether that repository's
 * owner is first-party is the tenant's scope to decide, not this module's.
 *
 * Everything else is deliberately unattributed, and so withheld while
 * presenting:
 * - other apps' names and screens — the registry records a local checkout
 *   path, never an `owner/name`, so nothing proves whose an app is;
 * - component and action text — over the relay the runner answers with its
 *   OWN registry only and asks no wrapper app (`wrapperComponents` is
 *   `"withheld"`), so none of it is a third party's page. But the runner's
 *   own entries embed runtime data — a saved project's name, or the
 *   self-declared name of an app its integration page lists — and no
 *   repository's owner is the owner of that;
 * - snapshot and page-health text quoted from the window.
 */

import { RUNNER_APP_ID } from "@/app/(app)/digital-twin/_lib/ui-bridge-types";

/** The repository the runner's own UI is built from. */
export const RUNNER_REPO = "qontinui/qontinui-runner";

/** The repository an app's own text belongs to, when this page can say. */
export function appRepoOf(appId: string | null | undefined): string | null {
  return appId === RUNNER_APP_ID ? RUNNER_REPO : null;
}
