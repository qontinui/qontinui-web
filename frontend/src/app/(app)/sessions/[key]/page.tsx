"use client";

/**
 * `/sessions/[key]` — the consolidated session detail permalink.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 2 (D3, D4, D5).
 * Was `/sessions/[id]`, which rendered only the coordination half over a
 * `coord.sessions` id. Renamed rather than added beside: Next.js refuses two
 * different slug names at one dynamic position, and `key` is the honest name
 * — this segment is not an id, it is any of four things (§D4).
 *
 * ## What this route is FOR (D3)
 *
 * Row click on `/sessions` expands in place — that is the fast path, and it
 * carries an "Open full view ↗" action to here. This route is the SHAREABLE
 * one, and it exists because the tall panes (Transcript, Live tail, PTY
 * output) need viewport height that an inline expansion cannot give them.
 * Both are addressable; neither replaces the other.
 *
 * ## D4 — the resolver spans both id spaces AND names, and renders EVERY match
 *
 * `GET /api/v1/admin/agent-sessions/{key}` resolves a uuid **or a name** and
 * answers `{"resolved": [...], "count": N}` newest-first, **because names are
 * ambiguous**. When `count > 1` this page renders every match, exactly as
 * `/environments/sessions/[key]` does today. Collapsing to `resolved[0]` would
 * put one session's transcript under another session's name with nothing on
 * screen to say so.
 *
 * A key the agent resolver 404s may still be a `coord.sessions` id — a shell,
 * a workflow, an automation has no Claude session id at all — so the lifecycle
 * read is asked as its own half. "Not found" is claimed only when BOTH halves
 * answered and both said no; a half that failed to answer produces UNKNOWN,
 * never absence (`readFailure.ts`'s split, applied per half).
 *
 * ## Trap 8 — `/sessions/repository` is a RESERVED static segment
 *
 * `/sessions/repository` and `/sessions/repository/[id]` are the shipped
 * permanent-transcript surface and they live inside this namespace. Next.js
 * App Router resolves a static segment ahead of a dynamic sibling, so the
 * filesystem side is safe — but this resolver additionally refuses the literal
 * string by name (`isReservedSessionSegment`), so a hand-built link or a
 * future rewrite cannot make it ask coord to resolve a session called
 * "repository". `sessions-routes.test.ts` asserts both halves.
 *
 * `sessions.detail-page` is carried forward **verbatim** (trap 5).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConsolidatedSessionDetail } from "@/components/sessions/ConsolidatedSessionDetail";
import { getSession } from "@/components/sessions/api";
import {
  classifyAgentError,
  classifyLifecycleError,
  deriveKeyVerdict,
  isReservedSessionSegment,
  type AgentHalf,
  type LifecycleHalf,
} from "@/components/sessions/sessionKeyResolution";
import { useDeviceStatusStream } from "@/components/operations/useDeviceStatusStream";
import { resolveAgentSession } from "@/services/agent-sessions-api";

export default function SessionKeyPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const deviceStatus = useDeviceStatusStream();

  const rawKey = params?.key;
  const key = decodeURIComponent(
    Array.isArray(rawKey) ? (rawKey[0] ?? "") : (rawKey ?? "")
  );

  const [agent, setAgent] = useState<AgentHalf>({ state: "loading" });
  const [lifecycle, setLifecycle] = useState<LifecycleHalf>({
    state: "loading",
  });
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!authLoading && !user) router.push("/");
  }, [user, authLoading, router]);

  const load = useCallback(
    (signal: AbortSignal) => {
      // A reserved static segment is never a session key — asking coord to
      // resolve "repository" would render "no session matches" over a route
      // that exists.
      if (!key || isReservedSessionSegment(key)) return;

      setAgent({ state: "loading" });
      setLifecycle({ state: "loading" });

      void resolveAgentSession(key)
        .then((value) => {
          if (!signal.aborted) setAgent({ state: "resolved", value });
        })
        .catch((err: unknown) => {
          if (!signal.aborted) setAgent(classifyAgentError(err));
        });

      // The OTHER id space, asked in parallel and never as a fallback: coord
      // resolves `id = $1 OR claude_code_session_id = $1` on this route, so a
      // lifecycle-only session (no Claude session id at all) is reachable here
      // and nowhere in the agent resolver.
      void getSession(key, signal)
        .then((value) => {
          if (!signal.aborted) setLifecycle({ state: "resolved", value });
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === "AbortError") return;
          if (!signal.aborted) setLifecycle(classifyLifecycleError(err));
        });
    },
    [key]
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load, reloadNonce]);

  const hostnameFor = useMemo(() => {
    const byId = new Map<string, string>();
    for (const row of deviceStatus.byHostname.values()) {
      if (row.hostname) byId.set(row.device_id, row.hostname);
    }
    return (deviceId: string) => byId.get(deviceId);
  }, [deviceStatus.byHostname]);

  // Candidate handoff targets — every online device in the live status stream.
  // The HandoffModal filters out the session's own device; coord also rejects
  // a self-handoff with a 400.
  const handoffTargets = useMemo(
    () =>
      Array.from(deviceStatus.byHostname.values()).map((row) => ({
        device_id: row.device_id,
        hostname: row.hostname ?? "",
      })),
    [deviceStatus.byHostname]
  );

  const verdict = useMemo(
    () => deriveKeyVerdict(key, agent, lifecycle),
    [key, agent, lifecycle]
  );

  if (!user) return null;

  if (!key) {
    return (
      <div
        className="h-[calc(100vh-44px)] flex items-center justify-center text-muted-foreground"
        data-ui-bridge-id="sessions.detail-missing-id"
      >
        <p className="text-sm">No session key in URL.</p>
      </div>
    );
  }

  const matchCount =
    verdict.kind === "matches"
      ? verdict.cards.length || (verdict.lifecycleOnlyId ? 1 : 0)
      : 0;

  return (
    <div
      className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
      data-ui-bridge-id="sessions.detail-page"
      data-session-id={key}
      data-match-count={matchCount}
    >
      <header className="flex items-center justify-between gap-2 px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sessions">
              <ArrowLeft className="size-4" />
              Sessions
            </Link>
          </Button>
          <Activity className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">Session</h1>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {key}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setReloadNonce((n) => n + 1)}
          aria-label="Refresh session"
          data-testid="sessions-detail-refresh"
        >
          <RefreshCw className="size-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-4 space-y-4">
          {verdict.kind === "reserved" && (
            <Notice
              testId="sessions-detail-reserved"
              title="That is a route, not a session"
              body={
                <>
                  <span className="font-mono">/sessions/{verdict.segment}</span>{" "}
                  is a page in its own right — the permanent transcript
                  repository — not a session key. Nothing was asked of coord.
                </>
              }
              action={
                <Link
                  href="/sessions/repository"
                  className="underline underline-offset-2"
                >
                  Open the session repository ↗
                </Link>
              }
            />
          )}

          {verdict.kind === "loading" && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {verdict.kind === "not-found" && (
            <Notice
              testId="sessions-detail-not-found"
              title="No session matches this key"
              body={
                <>
                  Both id spaces answered and neither holds a row for{" "}
                  <span className="font-mono">{key}</span>. A session id is
                  re-minted on every boot, so an old link can outlive the row it
                  pointed at.
                </>
              }
            />
          )}

          {verdict.kind === "unknown" && (
            <Notice
              testId="sessions-detail-unknown"
              title="This key could not be resolved"
              body={
                <>
                  One of the two reads did not land, so nothing here is
                  established. This is <strong>unknown</strong> — it is not a
                  finding that the session does not exist.
                  <span className="mt-1 block break-all font-mono text-[10px]">
                    {verdict.detail}
                  </span>
                </>
              }
              action={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setReloadNonce((n) => n + 1)}
                >
                  <RefreshCw className="size-4" />
                  Retry
                </Button>
              }
            />
          )}

          {verdict.kind === "matches" && (
            <div className="space-y-4">
              {verdict.cards.length > 1 && (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="sessions-detail-ambiguous-key"
                >
                  {verdict.cards.length} sessions match this key (newest
                  first). Session names are not unique, so every match is
                  rendered — picking one would show you a session you did not
                  ask for.
                </p>
              )}

              {verdict.cards.map((card) => (
                <ConsolidatedSessionDetail
                  key={card.id}
                  card={card}
                  sessionId={card.id}
                  hostnameFor={hostnameFor}
                  handoffTargets={handoffTargets}
                />
              ))}

              {verdict.cards.length === 0 && verdict.lifecycleOnlyId && (
                <ConsolidatedSessionDetail
                  card={null}
                  sessionId={verdict.lifecycleOnlyId}
                  hostnameFor={hostnameFor}
                  handoffTargets={handoffTargets}
                />
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function Notice({
  testId,
  title,
  body,
  action,
}: {
  testId: string;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="py-12 text-center" data-testid={testId}>
      <AlertTriangle className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
      <p className="text-sm font-medium">{title}</p>
      <div className="mx-auto mt-1 max-w-xl text-xs text-muted-foreground">
        {body}
      </div>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
