"use client";

import { usePageWriteGuardContext } from "../_hooks/usePageWriteGuardContext";

/** The line while the page's project is not known yet, with the way out. */
const WAITING_FOR_PROJECT =
  "Waiting for this page's project to be known before reading these settings. If this does not change, select a project or reload the page.";

/** The line once the layout's provider has said its membership read failed. */
const PROJECT_LIST_FAILED =
  "This page's project is unknown because the list of your projects could not be read, so these settings are not read. Reload the page to try again.";

/**
 * What a settings section shows while the page has no project to read its
 * settings in (`useFirstPinnedRead`). Nothing is read until the page knows
 * its project, and the section says so rather than show empty data or a load
 * that is not happening.
 *
 * The project may never come: on a first visit the layout's provider reads
 * the membership list once and does not retry it, and an operator may have
 * none selected. The line then stays, and nothing is read or written, for the
 * tab's whole life — so it names the way out in words, as a calm row's ask
 * must be (console style guide R3). When the provider SAYS its read failed,
 * the line says that, and that a reload is what reads the list again.
 *
 * The section's own muted loading style.
 */
export function WaitingForProject({ testId }: { testId: string }) {
  const tenants = usePageWriteGuardContext()?.tenantContext ?? null;
  const listFailed =
    tenants !== null && !tenants.loading && tenants.error !== null;
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {listFailed ? PROJECT_LIST_FAILED : WAITING_FOR_PROJECT}
    </p>
  );
}
