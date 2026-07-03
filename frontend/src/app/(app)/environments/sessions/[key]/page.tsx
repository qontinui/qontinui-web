"use client";

/**
 * /environments/sessions/[key] — session identity card detail (P4 of plan
 * `2026-07-02-digital-twin-session-identity-registry`).
 *
 * `key` is a session UUID or name; names can be AMBIGUOUS, so the coord
 * resolver (`GET /api/v1/admin/agent-sessions/{key}`) returns
 * `{"resolved": [card, ...], "count": N}` newest-first and this page
 * renders every match (one card in the common case). Each card shows
 * name, status, the bound machine/environment (machine name links back to
 * /environments/machines), the "working on" summary + session snapshot,
 * recent commits, and the lineage timeline.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  GitCommitHorizontal,
  History,
  Loader2,
  RefreshCw,
  Server,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/components/operations/utils";
import {
  AgentSessionsApiError,
  resolveAgentSession,
  type SessionCard,
} from "@/services/agent-sessions-api";

function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "live":
      return <Badge variant="success">live</Badge>;
    case "stale":
      return <Badge variant="warning">stale</Badge>;
    case "closed":
      return <Badge variant="secondary">closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

/** Label/value pair for the working_on.session snapshot grid. */
function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-xs font-mono truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

function SessionCardView({ card }: { card: SessionCard }) {
  const displayName = card.name ?? card.derived_name;
  const workingOn = card.working_on;
  const snapshot = workingOn?.session ?? null;
  const commits = workingOn?.commits ?? [];
  const lineage = workingOn?.lineage ?? [];

  return (
    <div
      className="rounded-lg border border-border"
      data-testid="twin-session-card"
    >
      {/* Header: name + status + identifiers */}
      <div className="px-4 py-3 border-b border-border bg-muted/50">
        <div className="flex flex-wrap items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold">{displayName}</span>
          <StatusBadge status={card.status} />
          <span
            className="font-mono text-[10px] text-muted-foreground"
            title={card.id}
          >
            {card.id}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
          {card.label && card.label !== card.derived_name && (
            <span>
              derived name{" "}
              <span className="font-mono">{card.derived_name}</span>
            </span>
          )}
          <span>first seen {relativeTime(card.first_seen)}</span>
          <span>last seen {relativeTime(card.last_seen)}</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Machine / environment */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Server className="size-4 text-muted-foreground" />
          {card.machine ? (
            <>
              <Link
                href="/environments/machines"
                className="font-medium text-primary hover:underline"
              >
                {card.machine.name}
              </Link>
              {card.machine.hostname && (
                <span className="font-mono text-xs text-muted-foreground">
                  {card.machine.hostname}
                </span>
              )}
              {card.machine.environment && (
                <Badge variant="outline">{card.machine.environment.name}</Badge>
              )}
            </>
          ) : card.device_id ? (
            <span
              className="font-mono text-xs text-muted-foreground"
              title={card.device_id}
            >
              device {card.device_id}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              no machine binding
            </span>
          )}
        </div>

        {/* Working-on summary */}
        {card.summary && <p className="text-sm">{card.summary}</p>}

        {/* Live session snapshot */}
        {snapshot && (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            <Field label="purpose" value={snapshot.intent_purpose} />
            <Field label="plan" value={snapshot.plan_slug} />
            <Field label="topic" value={snapshot.correlation_topic} />
            <Field label="repo" value={snapshot.repo} />
            <Field label="branch" value={snapshot.branch} />
            <Field label="provider" value={snapshot.provider} />
            <Field label="kind" value={snapshot.session_kind} />
            <Field label="state" value={snapshot.state} />
          </dl>
        )}

        {/* Recent commits */}
        {commits.length > 0 && (
          <div>
            <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <GitCommitHorizontal className="size-3.5" />
              Recent commits
            </h4>
            <ul className="space-y-1">
              {commits.map((c, idx) => (
                <li
                  key={`${c.repo}:${c.sha}:${idx}`}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <span className="font-mono">
                    {c.repo}
                    {c.branch ? `@${c.branch}` : ""}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {shortSha(c.sha)}
                  </span>
                  <span className="text-muted-foreground">
                    {relativeTime(c.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Lineage timeline. A plain chronological list rather than the
            shared <LineageTimeline /> — the card's lineage `kind` is an
            open string set, and LineageTimeline silently drops kinds
            outside its fixed four-kind union. */}
        {lineage.length > 0 && (
          <div>
            <h4 className="text-xs font-medium flex items-center gap-1.5 mb-1.5 text-muted-foreground">
              <History className="size-3.5" />
              Lineage
            </h4>
            <ul className="space-y-1">
              {lineage.map((entry, idx) => (
                <li
                  key={`${entry.kind}:${entry.handle}:${idx}`}
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                >
                  <Badge variant="outline">{entry.kind}</Badge>
                  <span className="font-mono truncate max-w-[28rem]">
                    {entry.handle}
                  </span>
                  <span className="text-muted-foreground">
                    {relativeTime(entry.occurred_at)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SessionDetailPage() {
  const params = useParams<{ key: string }>();
  const decodedKey = decodeURIComponent(params.key);

  const [cards, setCards] = useState<SessionCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchCard = useCallback(async () => {
    try {
      const data = await resolveAgentSession(decodedKey);
      setCards(data.resolved);
      setNotFound(false);
      setLoadError(null);
    } catch (err) {
      if (err instanceof AgentSessionsApiError && err.status === 404) {
        setNotFound(true);
        setLoadError(null);
      } else {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load session"
        );
      }
    } finally {
      setLoading(false);
    }
  }, [decodedKey]);

  useEffect(() => {
    fetchCard();
  }, [fetchCard]);

  return (
    <div className="p-6 space-y-6" data-testid="twin-session-detail-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/environments/sessions">
              <ArrowLeft className="size-4" />
              Sessions
            </Link>
          </Button>
          <h2 className="text-lg font-semibold font-mono">{decodedKey}</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setLoading(true);
            fetchCard();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-4" />
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : notFound ? (
        <div className="text-center py-12">
          <AlertTriangle className="size-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No session matches{" "}
            <span className="font-mono">{decodedKey}</span>.
          </p>
        </div>
      ) : loadError ? (
        <div className="text-center py-12">
          <AlertTriangle className="size-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Couldn&apos;t load session.
          </p>
          <p className="text-xs text-muted-foreground mt-1">{loadError}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setLoading(true);
              fetchCard();
            }}
          >
            <RefreshCw className="size-4" />
            Retry
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {(cards?.length ?? 0) > 1 && (
            <p className="text-xs text-muted-foreground">
              {cards?.length} sessions share this name (newest first).
            </p>
          )}
          {cards?.map((card) => (
            <SessionCardView key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
