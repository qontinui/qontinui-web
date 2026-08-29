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
 *
 * The card itself now lives at `components/sessions/SessionCardView.tsx`: plan
 * `2026-08-26-sessions-console-consolidation` D5 mounts it on the merged
 * `/sessions/[key]` view too, and one component with two callers beats two
 * copies that drift. This page is deleted in that plan's Phase 3; the card
 * survives.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionCardView } from "@/components/sessions/SessionCardView";
import {
  AgentSessionsApiError,
  resolveAgentSession,
  type SessionCard,
} from "@/services/agent-sessions-api";

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
            No session matches <span className="font-mono">{decodedKey}</span>.
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
