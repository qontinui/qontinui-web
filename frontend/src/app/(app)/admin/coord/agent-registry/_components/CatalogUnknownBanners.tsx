"use client";

/**
 * UNKNOWN banners for the agent catalog (verification-and-evidence
 * `silent-empty-is-unknown`): one per catalog source coord could not read, and
 * one for a catalog that could not be read at all. An unread source is never
 * an empty one — agent types it would have listed may be missing below.
 *
 * Painted with the ignorance floor (`UNKNOWN_AMBER`, style guide §R3 "amber
 * also covers we do not know"), never red: nothing has failed that a reader of
 * this page must act on, and nothing here is calm either.
 */

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNKNOWN_AMBER } from "@/components/console";
import type {
  AgentCatalogSkippedDeclared,
  AgentCatalogUnreadSource,
} from "@/lib/api/agent-registry";

/** What each catalog source is, in the page's words (R8). */
const SOURCE_NAME: Record<string, string> = {
  row: "registry rows",
  contract_kind: "coord's spawn kinds",
  contract_class: "coord's spawn classes",
  runner_key: "the runner's named spawns",
  harness_builtin: "the harness's built-in subagent types",
  declared_role: "roles declared in the tenant's repositories",
  observed: "names observed at spawn time",
  sources_unread: "the catalog's own list of unread sources",
};

export interface CatalogUnknownBannersProps {
  sourcesUnread: readonly AgentCatalogUnreadSource[];
  /** Role files whose declared name coord's grammar refuses: listed so a
   *  missing switch is explained, never silently absent. */
  declaredSkipped?: readonly AgentCatalogSkippedDeclared[];
  /** The catalog read's own failure, or null. */
  loadError: string | null;
  /** True when an earlier read is still on screen behind the failed one. */
  stale: boolean;
  onRetry: () => void;
}

export function CatalogUnknownBanners({
  sourcesUnread,
  declaredSkipped = [],
  loadError,
  stale,
  onRetry,
}: CatalogUnknownBannersProps) {
  if (!loadError && sourcesUnread.length === 0 && declaredSkipped.length === 0)
    return null;
  return (
    <div className="space-y-1" data-testid="agent-catalog-unknown">
      {loadError && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
          data-testid="agent-catalog-load-error"
          role="status"
        >
          <span className="flex-1">
            {stale
              ? `UNKNOWN: the latest agent catalog read failed (${loadError}). The spawn switches below show an earlier read, which may be out of date.`
              : `UNKNOWN: the agent catalog could not be read (${loadError}). Agent types with no registry row are missing below, and every spawn switch reads Unknown until it is.`}
          </span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3 w-3" />
            Retry
          </Button>
        </div>
      )}
      {sourcesUnread.map((u, i) =>
        u.source === "malformed_entries" ? (
          <div
            key={`malformed-${i}`}
            className={`rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
            data-testid="agent-catalog-source-unread-malformed_entries"
            role="status"
          >
            UNKNOWN: {u.reason}.
          </div>
        ) : (
          <div
            key={`${u.source}-${u.repo ?? ""}-${i}`}
            className={`rounded-md border px-3 py-2 text-xs ${UNKNOWN_AMBER}`}
            data-testid={`agent-catalog-source-unread-${u.source}`}
            role="status"
          >
            UNKNOWN: {SOURCE_NAME[u.source] ?? `catalog source "${u.source}"`}
            {u.repo ? ` in ${u.repo}` : ""} could not be read — {u.reason}.
            Agent types only that source lists may be missing below.
          </div>
        )
      )}
      {declaredSkipped.length > 0 && (
        <div
          className="rounded-md border px-3 py-2 text-xs text-muted-foreground"
          data-testid="agent-catalog-declared-skipped"
        >
          {declaredSkipped.length} role file
          {declaredSkipped.length === 1 ? " declares" : "s declare"} a name the
          registry refuses, so{" "}
          {declaredSkipped.length === 1 ? "it has" : "they have"} no switch:
          <ul className="mt-1 space-y-0.5">
            {declaredSkipped.map((d) => (
              <li key={`${d.repo}:${d.path}`}>
                <span className="font-mono">{d.declared_name}</span> in{" "}
                <span className="font-mono">
                  {d.repo}:{d.path}
                </span>{" "}
                — {d.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
