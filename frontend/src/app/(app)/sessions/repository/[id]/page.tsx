"use client";

/**
 * `/sessions/repository/[id]` — one archived session.
 *
 * Phase 5 of `2026-08-26-claude-code-session-repository-in-qontinui-web`.
 *
 * The `[id]` here is the ARCHIVE row's id (`agent.session_artifacts.id`), not
 * the Claude Code session id and not coord's session id. The archive is keyed
 * on `(org, claude_session_id, account_label)` because a Claude session id is
 * unique per account home rather than globally, so the session id alone
 * cannot address a row.
 *
 * Note the route sits UNDER `/sessions`: Next.js matches the static
 * `repository` segment ahead of the sibling `[id]` route, so
 * `/sessions/repository` and `/sessions/<coord-session-id>` do not collide.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionArtifactDetail } from "@/components/session-repository";

export default function SessionRepositoryDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (!user) return null;

  // `useParams` returns string | string[] | undefined; the route is
  // single-value, so collapse defensively rather than index blindly.
  const rawId = params?.id;
  const artifactId = Array.isArray(rawId) ? rawId[0] : rawId;

  if (!artifactId) {
    return (
      <div
        className="flex h-[calc(100vh-44px)] items-center justify-center text-muted-foreground"
        data-ui-bridge-id="session-repository.detail-missing-id"
      >
        <p className="text-sm">No archived-session id in the URL.</p>
      </div>
    );
  }

  return (
    <div
      className="flex h-[calc(100vh-44px)] flex-col overflow-hidden bg-background"
      data-ui-bridge-id="session-repository.detail-page"
      data-session-artifact-id={artifactId}
    >
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <Link href="/sessions/repository">
          <Button variant="ghost" size="sm" data-testid="session-detail-back">
            <ArrowLeft className="size-4" />
            Repository
          </Button>
        </Link>
        <Archive className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Archived session</h1>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {artifactId}
          </p>
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-6 py-4">
          <SessionArtifactDetail artifactId={artifactId} />
        </div>
      </ScrollArea>
    </div>
  );
}
