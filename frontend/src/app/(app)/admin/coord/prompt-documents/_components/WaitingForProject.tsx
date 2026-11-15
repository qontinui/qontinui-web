"use client";

import { usePageWriteGuardContext } from "../_hooks/usePageWriteGuardContext";

/** The line while the page's project is not known yet, with the way out. */
const WAITING_FOR_PROJECT =
  "Waiting for this page's project to be known before reading these settings. If this does not change, select a project or reload the page.";

/** The line while a red notice at the top of the page says why and what to do. */
const SEE_PROJECT_LIST_NOTICE =
  "Not read until this page has a project: see the notice at the top of the page.";

/**
 * What a settings section shows while the page has no project to read its
 * settings in (`useFirstPinnedRead`). Nothing is read until the page knows
 * its project, and the section says so rather than show empty data or a load
 * that is not happening. The line is muted, as the section's loading line is,
 * and names the way out in words.
 *
 * When the layout's provider has said its membership read failed and the
 * page has no project to pin to (`projectListFailed`), nothing on this page
 * reads the list again: the provider shows ONE red notice saying why and what
 * to do — its own, or the cross-tab notice while the page is locked
 * (`PageWriteGuardProvider`) — and the section points to it instead of
 * repeating it.
 */
export function WaitingForProject({ testId }: { testId: string }) {
  const listFailed = usePageWriteGuardContext()?.projectListFailed ?? false;
  return (
    <p className="text-sm text-muted-foreground" data-testid={testId}>
      {listFailed ? SEE_PROJECT_LIST_NOTICE : WAITING_FOR_PROJECT}
    </p>
  );
}
