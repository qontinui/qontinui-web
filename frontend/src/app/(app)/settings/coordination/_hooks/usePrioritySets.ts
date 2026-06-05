"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  type PrioritySetRow,
  type CompositionRuleRow,
  type SetDelivery,
  computeDeliveryMap,
  friendlyCoordError,
  unwrapPrioritySets,
  unwrapCompositionRules,
} from "./priority-set-delivery";

const SETS_URL = "/api/v1/operations/coord/priority-sets";
const RULES_URL = "/api/v1/operations/coord/composition-rules";

/** Payload for creating a tenant priority set (v1 uses bare-string ordering). */
export interface CreatePrioritySetInput {
  set_name: string;
  /** null = tenant-wide. */
  repo: string | null;
  ordering: string[];
  non_factors: string[];
}

interface UsePrioritySetsReturn {
  sets: PrioritySetRow[];
  rules: CompositionRuleRow[];
  /** set_name -> delivery (carried surfaces + delivered flag). */
  delivery: Record<string, SetDelivery>;
  loading: boolean;
  error: string | null;
  creating: boolean;
  createError: string | null;
  deletingId: string | null;
  createSet: (input: CreatePrioritySetInput) => Promise<boolean>;
  softDeleteSet: (id: string) => Promise<void>;
  clearCreateError: () => void;
}

/**
 * Loads + mutates the caller's per-coord-tenant priority sets and composition
 * rules via the open-source web proxy (`/api/v1/operations/coord/...`), which
 * forwards to the closed-source coord façade (web #465 / coord #355).
 *
 * Two GETs on mount (sets + rules) so the section can compute the honesty-gate
 * "delivered to agents" state locally. Mutations re-fetch to stay authoritative.
 */
export function usePrioritySets(): UsePrioritySetsReturn {
  const [sets, setSets] = useState<PrioritySetRow[]>([]);
  const [rules, setRules] = useState<CompositionRuleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    // Coord returns {priority_sets, total} / {composition_rules, total}
    // envelopes — unwrap defensively (see priority-set-delivery.ts).
    const [setsData, rulesData] = await Promise.all([
      httpClient.get<unknown>(SETS_URL),
      httpClient.get<unknown>(RULES_URL),
    ]);
    setSets(unwrapPrioritySets(setsData));
    setRules(unwrapCompositionRules(rulesData));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [setsData, rulesData] = await Promise.all([
          httpClient.get<unknown>(SETS_URL),
          httpClient.get<unknown>(RULES_URL),
        ]);
        if (!cancelled) {
          setSets(unwrapPrioritySets(setsData));
          setRules(unwrapCompositionRules(rulesData));
        }
      } catch (err) {
        if (!cancelled) {
          const msg = friendlyCoordError(err);
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const createSet = useCallback(
    async (input: CreatePrioritySetInput): Promise<boolean> => {
      setCreating(true);
      setCreateError(null);
      try {
        await httpClient.post<PrioritySetRow>(SETS_URL, input);
        await reload();
        toast.success(`Priority set "${input.set_name}" created`);
        return true;
      } catch (err) {
        setCreateError(friendlyCoordError(err));
        return false;
      } finally {
        setCreating(false);
      }
    },
    [reload]
  );

  const softDeleteSet = useCallback(
    async (id: string): Promise<void> => {
      setDeletingId(id);
      try {
        await httpClient.delete<unknown>(`${SETS_URL}/${id}`);
        await reload();
        toast.success("Priority set disabled");
      } catch (err) {
        toast.error(friendlyCoordError(err));
      } finally {
        setDeletingId(null);
      }
    },
    [reload]
  );

  const clearCreateError = useCallback(() => setCreateError(null), []);

  const delivery = useMemo(
    () => computeDeliveryMap(sets, rules),
    [sets, rules]
  );

  return {
    sets,
    rules,
    delivery,
    loading,
    error,
    creating,
    createError,
    deletingId,
    createSet,
    softDeleteSet,
    clearCreateError,
  };
}
