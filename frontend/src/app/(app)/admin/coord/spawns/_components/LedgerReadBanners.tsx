"use client";

/**
 * What the latest ledger reads could not say: one note for the window's list,
 * and one for the requests still waiting when its failure differs. Shared by
 * the agentic-activity page and its requests investigation view, each naming
 * what it shows from the window's list (`retainedSubject`): the counts on the
 * one, the rows on the other.
 */

import type { SpawnLedgerRead } from "../_lib/useSpawnLedger";
import { spawnIssueTextFor } from "../_lib/spawnStatus";
import { UnknownNote } from "./UnknownNote";

export function LedgerReadBanners({
  ledger,
  presenting,
  retainedSubject,
}: {
  ledger: Pick<SpawnLedgerRead, "list" | "pending">;
  presenting: boolean;
  /** What the page shows from a retained list: "the counts below" or "the rows below". */
  retainedSubject: "the counts below" | "the rows below";
}) {
  const listIssue = ledger.list.issue;
  const pendingIssue = ledger.pending.issue;
  return (
    <>
      {listIssue && (
        <UnknownNote
          role="status"
          data-testid="coord-spawns-unknown-banner"
          data-issue={listIssue.kind}
        >
          {ledger.list.data
            ? `Last refresh failed — ${retainedSubject} are from the last good read. `
            : ""}
          {spawnIssueTextFor(
            listIssue,
            "which spawns were requested",
            presenting
          )}
        </UnknownNote>
      )}
      {pendingIssue && pendingIssue.kind !== listIssue?.kind && (
        <UnknownNote
          role="status"
          data-testid="coord-spawns-pending-banner"
          data-issue={pendingIssue.kind}
        >
          {spawnIssueTextFor(
            pendingIssue,
            "which older requests are still waiting",
            presenting
          )}
        </UnknownNote>
      )}
    </>
  );
}
