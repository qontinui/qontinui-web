"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  createPrioritySet,
  deletePrioritySet,
  fetchCompositionRules,
  fetchPrioritySets,
  updatePrioritySet,
  type CreatePrioritySetInput,
  type UpdatePrioritySetInput,
} from "@/lib/api/operations/coordSettings";
import {
  type PrioritySetRow,
  type CompositionRuleRow,
  type SetDelivery,
  computeDeliveryMap,
  friendlyCoordError,
  unwrapPrioritySets,
  unwrapCompositionRules,
} from "./priority-set-delivery";

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
  updatingId: string | null;
  createSet: (input: CreatePrioritySetInput) => Promise<boolean>;
  updateSet: (id: string, partial: UpdatePrioritySetInput) => Promise<boolean>;
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
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    // Coord returns {priority_sets, total} / {composition_rules, total}
    // envelopes — unwrap defensively (see priority-set-delivery.ts).
    const [setsData, rulesData] = await Promise.all([
      fetchPrioritySets(),
      fetchCompositionRules(),
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
          fetchPrioritySets(),
          fetchCompositionRules(),
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
        await createPrioritySet(input);
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

  const updateSet = useCallback(
    async (id: string, partial: UpdatePrioritySetInput): Promise<boolean> => {
      // No-op edit (empty diff) — nothing to PATCH; treat as a clean save.
      if (Object.keys(partial).length === 0) return true;
      setUpdatingId(id);
      try {
        await updatePrioritySet(id, partial);
        await reload();
        toast.success("Priority set updated");
        return true;
      } catch (err) {
        // Surfaced inline by the editing row (it owns its error state); rethrow
        // so the row can map the code via friendlyCoordError. Toast stays a
        // success-only signal, matching createSet/softDeleteSet.
        throw err;
      } finally {
        setUpdatingId(null);
      }
    },
    [reload]
  );

  const softDeleteSet = useCallback(
    async (id: string): Promise<void> => {
      setDeletingId(id);
      try {
        await deletePrioritySet(id);
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
    updatingId,
    createSet,
    updateSet,
    softDeleteSet,
    clearCreateError,
  };
}
