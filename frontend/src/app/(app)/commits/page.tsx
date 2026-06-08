"use client";

/**
 * Commit Lineage page — "which Claude Code session produced which commit".
 *
 * Customer-facing home for the commit-attribution feed that previously lived
 * only in the dev-only qontinui-supervisor (its Lineage tab). Reads from the
 * web-backend proxy at `/api/v1/operations/lineage/*`, which forwards the
 * operator's credential to coord's `coord.commit_lineage` endpoints.
 */

import { GitCommitHorizontal } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CommitLineage } from "@/components/commits/CommitLineage";

export default function CommitsPage() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-bridge-id="commits.page"
    >
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <GitCommitHorizontal className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Commit Lineage</h1>
            <p className="text-xs text-muted-foreground">
              Which Claude Code session produced which commit — recorded
              server-side by coord (merge orchestrator, push reports, trailer
              backfill). Click a session chip to see all of its commits.
            </p>
          </div>
        </div>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4">
          <CommitLineage />
        </div>
      </ScrollArea>
    </div>
  );
}
