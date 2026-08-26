"use client";

/**
 * `/sessions/repository` — the Claude Code Session Repository.
 *
 * Phase 5 of `2026-08-26-claude-code-session-repository-in-qontinui-web`.
 *
 * A FIRST-CLASS route, deliberately not an `/admin/coord/*` sub-page. The
 * corpus is qontinui-web's own (`agent.session_artifacts` + the object store),
 * it answers questions an ordinary operator asks daily — "which sessions did I
 * never close out?", "what was I doing in that tab before the rebuild?" — and
 * burying it under the coordination console would make the answer to "where
 * did my sessions go" a piece of tribal knowledge.
 *
 * It sits beside `/sessions`, and the pair is the point: `/sessions` is
 * coord's LIVE view, bounded by a 7-day GC; this is the permanent archive
 * fed from disk. Each page says which it is.
 *
 * Authz posture copies the plan library (plan §3.3): reads are member-visible
 * and tenant-scoped SERVER-SIDE — nothing here passes a tenant and nothing
 * derives one from the caller's personal organization (plan §3.6 rule 1) —
 * while the mutating control (relaunch/transfer, on the detail page) is
 * gated by coord-tenant admin on the backend and merely reflected in the UI.
 */

import Link from "next/link";
import { Archive, Radio } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { SessionRepositoryList } from "@/components/session-repository";

export default function SessionRepositoryPage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div
      className="flex h-[calc(100vh-44px)] flex-col overflow-hidden bg-background"
      data-ui-bridge-id="session-repository.page"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-3">
        <div className="flex items-start gap-2">
          <Archive className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">Session Repository</h1>
            <p className="max-w-3xl text-xs text-muted-foreground">
              Every Claude Code session this fleet has archived — permanently,
              and searchable. The coordination layer keeps a live session for 7
              days after it closes; this corpus keeps it. Find the work a
              rebuild interrupted, see which sessions were never closed out, and
              run one again.
            </p>
          </div>
        </div>
        <Link href="/sessions" className="shrink-0">
          <Button
            variant="outline"
            size="sm"
            data-testid="session-repository-live-link"
          >
            <Radio className="size-3.5" />
            Live sessions
          </Button>
        </Link>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          <SessionRepositoryList />
        </div>
      </ScrollArea>
    </div>
  );
}
