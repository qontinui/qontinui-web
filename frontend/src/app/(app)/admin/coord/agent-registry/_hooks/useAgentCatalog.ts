"use client";

/**
 * The agent catalog read for `/admin/coord/agent-registry`: every agent type a
 * spawn may be authorized under, with or without a registry row. Readable by
 * any member (plan `2026-11-24-tenant-admins-switch-agent-spawns-off-per-agent-type`
 * Phase 7).
 *
 * Reads are ticketed like the page's row read, so an older answer never paints
 * over a newer one and an older failure says nothing about a newer value. A
 * failed read keeps the last delivered catalog on screen and reports the
 * failure beside it; with no catalog ever delivered, the page reads every
 * spawn switch as UNKNOWN.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createReadSequence } from "@/components/console";
import { getAgentCatalog, type AgentCatalog } from "@/lib/api/agent-registry";

export interface AgentCatalogRead {
  catalog: AgentCatalog | null;
  loaded: boolean;
  error: string | null;
  /** Resolves with whether what is shown is a read issued at or after this one. */
  refresh: () => Promise<boolean>;
}

export function useAgentCatalog(): AgentCatalogRead {
  const [catalog, setCatalog] = useState<AgentCatalog | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reads = useRef(createReadSequence());

  const refresh = useCallback(async (): Promise<boolean> => {
    const seq = reads.current;
    const ticket = seq.issue();
    try {
      const next = await getAgentCatalog();
      if (seq.settle(ticket, true)) {
        setCatalog(next);
        if (!seq.isStale()) setError(null);
      }
      return true;
    } catch (err) {
      seq.settle(ticket, false);
      if (seq.hasDelivered() && !seq.isStale()) return true;
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { catalog, loaded, error, refresh };
}
