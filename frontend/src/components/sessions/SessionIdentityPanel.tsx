"use client";

/**
 * SessionIdentityPanel — which Claude account a session ran on, on which
 * device, under which names, and whether it is running now.
 *
 * Plan `2026-10-19-session-lookup-by-name-shows-claude-account-in-web`
 * Phase 3. Rendered on `/sessions/[key]` above the twin card, one per match.
 *
 * Two sources, kept visibly apart:
 *
 * - **the durable stamp** on the resolver card (`account`, `config_dir`,
 *   `account_observed_at`, `registry_name`, `tag_name`) — survives the session
 *   ending, which is the whole point;
 * - **the live census** (`GET /api/v1/admin/sessions/census`, proxying coord's
 *   `/coord/sessions/census`) — the only source that can say "running now".
 *   Until coord serves that route the line reads
 *   `live status UNKNOWN — census not served`, never "not live".
 *
 * Every derivation is in `sessionAccount.ts`; this file only lays it out.
 * Identifying text (the names, the session id, the config dir) wraps rather
 * than truncating — `ux-priorities` `no-widget-may-hide-identifying-text`.
 */

import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
import {
  getSessionCensus,
  type SessionCard,
} from "@/services/agent-sessions-api";
import {
  classifyCensusError,
  deriveCardIdentity,
  type CensusHalf,
  deriveLiveStatus,
  type Fact,
  type LiveStatus,
} from "./sessionAccount";

export interface SessionIdentityPanelProps {
  card: SessionCard;
  hostnameFor?: (deviceId: string) => string | undefined;
  /** Injected for tests — the census proxy read. */
  readCensus?: typeof getSessionCensus;
  /** Injected for tests so every age is deterministic. */
  now?: number;
}

export function SessionIdentityPanel({
  card,
  hostnameFor,
  readCensus,
  now,
}: SessionIdentityPanelProps) {
  const [census, setCensus] = useState<CensusHalf>({
    state: "loading",
  });

  useEffect(() => {
    const ctrl = new AbortController();
    setCensus({ state: "loading" });
    void (readCensus ?? getSessionCensus)({
      session_id: card.id,
      signal: ctrl.signal,
    })
      .then((value) => {
        if (!ctrl.signal.aborted) setCensus({ state: "resolved", value });
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        if (!ctrl.signal.aborted) setCensus(classifyCensusError(err));
      });
    return () => ctrl.abort();
  }, [card.id, readCensus]);

  const identity = deriveCardIdentity(card, { hostnameFor, now });
  const live = deriveLiveStatus(census, card.id, { now });

  return (
    <section
      className="rounded-lg border border-border bg-card/30 px-4 py-3 space-y-2"
      data-testid="session-identity-panel"
      data-session-id={card.id}
    >
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Fingerprint className="size-3.5" />
        Identity — account, device, names
      </h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[9rem_1fr]">
        <Term>session id</Term>
        <dd
          className="font-mono text-xs break-all"
          data-testid="session-identity-session-id"
        >
          {card.id}
        </dd>

        <Term>Claude account</Term>
        <FactValue
          fact={
            identity.account.state === "known"
              ? { state: "known", text: identity.account.label }
              : { state: "unknown", text: identity.account.label }
          }
          testId="session-identity-account"
          mono={identity.account.state === "known"}
        />

        <Term>config dir</Term>
        <FactValue
          fact={identity.configDir}
          testId="session-identity-config-dir"
          mono
        />

        <Term>device</Term>
        <FactValue
          fact={identity.device}
          testId="session-identity-device"
          mono
        />

        <Term>account observed</Term>
        <FactValue
          fact={identity.observed}
          testId="session-identity-observed"
        />

        <Term>names</Term>
        <dd className="text-xs" data-testid="session-identity-names">
          {identity.names.length > 0 ? (
            <ul className="space-y-0.5">
              {identity.names.map((n) => (
                <li
                  key={n.source}
                  className="flex flex-wrap items-baseline gap-x-2"
                  data-testid={`session-identity-name-${n.source}`}
                >
                  <span className="font-mono break-all">{n.value}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {n.sourceLabel}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <UnknownText text={identity.namesUnknown ?? "UNKNOWN"} />
          )}
        </dd>

        <Term>running now</Term>
        <LiveValue status={live} />
      </dl>
    </section>
  );
}

function Term({ children }: { children: React.ReactNode }) {
  return (
    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground sm:pt-0.5">
      {children}
    </dt>
  );
}

/** R3's ignorance floor: an UNKNOWN reads amber, never calm and never blank. */
function UnknownText({ text, title }: { text: string; title?: string }) {
  return (
    <span className="text-amber-300/90 break-words" title={title ?? text}>
      {text}
    </span>
  );
}

function FactValue({
  fact,
  testId,
  mono = false,
}: {
  fact: Fact;
  testId: string;
  mono?: boolean;
}) {
  return (
    <dd className="text-xs" data-testid={testId} data-state={fact.state}>
      {fact.state === "known" ? (
        <span
          className={mono ? "font-mono break-all" : undefined}
          title={fact.title}
        >
          {fact.text}
        </span>
      ) : (
        <UnknownText text={fact.text} />
      )}
    </dd>
  );
}

function LiveValue({ status }: { status: LiveStatus }) {
  return (
    <dd
      className="text-xs"
      data-testid="session-identity-live"
      data-state={status.state}
    >
      {status.state === "loading" ? (
        <span className="text-muted-foreground">{status.text}</span>
      ) : status.state === "unknown" ? (
        <UnknownText text={status.text} title={status.title} />
      ) : (
        <span
          className={
            status.state === "live" ? "text-green-300" : "text-foreground"
          }
          title={status.title}
        >
          {status.text}
        </span>
      )}
    </dd>
  );
}
