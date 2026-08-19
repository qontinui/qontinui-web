"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { CoordPolicyRow } from "./coordPolicies";
import {
  createCoordPolicy,
  deleteCoordPolicy,
  deleteCoordPolicySystemOverride,
  listCoordPolicies,
  patchCoordPolicy,
  putCoordPolicySystemOverride,
  restoreCoordPolicyDefault,
} from "./coordPolicyApi";

/**
 * The one CRUD chain against the tenant-admin coord-proxy
 * (`/api/v1/operations/coord/policies`), shared by every `/admin/coord` policy
 * surface. Extracted from `automation-rules/_hooks/useAutomationRules.ts` when
 * the `gate_clearance` surface landed, so the two surfaces share the fetch
 * layer instead of running two copies of it.
 *
 * Each caller supplies:
 *  - `filter` — which rows belong to its surface (kind set, or decision domain)
 *  - `sort` — the caller's presentation order
 *  - `noun` — the word used in toasts ("rule", "clearance rule", …)
 * NOTE on DISABLED rows: coord's list route takes an `enabled` filter
 * (defaulting to enabled-only for the tenant's own rows), but the web
 * backend's proxy — `GET /api/v1/operations/coord/policies` in
 * `operations.py` — calls `_proxy_coord_get("/coord/policies", ...)` with NO
 * `params`, so no query string reaches coord. A tenant's DISABLED own rules
 * are therefore not listable from the console at all. Do not add an
 * `?enabled=` argument here expecting it to work; the fix belongs in the
 * proxy.
 *
 * The create/update bodies are generic: v1 surfaces post `{kind, condition,
 * action}`, v2 surfaces post `{decision_domain, mode, payload}`. Coord
 * validates the mutual exclusion (`derive_create_shape`), so this layer stays
 * shape-agnostic on purpose.
 */
export interface UseCoordPoliciesOptions {
  /** MUST be a stable reference (module-level or `useCallback`ed) — it is a
   *  `loadRules` dependency, so an inline lambda refetches every render. */
  filter: (row: CoordPolicyRow) => boolean;
  /** Same stability requirement as `filter`. */
  sort?: (a: CoordPolicyRow, b: CoordPolicyRow) => number;
  /** Singular noun for toast copy. Default `"rule"`. */
  noun?: string;
  /** Headline for a failed list call. Defaults to `Failed to load <noun>s`;
   *  the underlying error text is appended either way. */
  loadFailMessage?: string;
}

export interface UseCoordPoliciesResult<TCreate, TUpdate> {
  rules: CoordPolicyRow[];
  /**
   * True only while the FIRST list call is in flight. A mutation's refetch
   * deliberately does not raise it — flipping a page to a full-height
   * "Loading…" after every create/delete unmounts what the user was reading.
   * Use `saving` for in-flight edits instead.
   */
  loading: boolean;
  saving: boolean;
  /**
   * True when the last list call failed. The caller MUST treat `rules` as
   * UNKNOWN in that state, not as "this workspace has no rules" — an empty
   * list from a failed read is an absence of information.
   */
  loadFailed: boolean;
  reload: () => Promise<void>;
  /** The created row, or `null` on failure. Coord's `post_create` always
   *  returns the row body on 201, so `null` unambiguously means "did not
   *  land" — unlike DELETE, whose 204 has no body at all. */
  createRule: (data: TCreate) => Promise<CoordPolicyRow | null>;
  updateRule: (policyId: string, data: TUpdate) => Promise<boolean>;
  deleteRule: (policyId: string) => Promise<boolean>;
  restoreDefault: (policyId: string) => Promise<boolean>;
  overrideSystemRule: (
    systemRuleId: string,
    body: { disabled: boolean } | TCreate
  ) => Promise<boolean>;
  revertOverride: (systemRuleId: string) => Promise<boolean>;
  /**
   * Escape hatch for a multi-call sequence that must read as ONE edit (the
   * gate-clearance replace flow, which coord's payload-less PATCH forces):
   * holds the saving flag, runs `fn`, and reloads once at the end. `fn`
   * composes the raw `coordPolicyApi` calls, so no route is spelled twice.
   */
  runSequence: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function useCoordPolicies<TCreate, TUpdate>(
  options: UseCoordPoliciesOptions
): UseCoordPoliciesResult<TCreate, TUpdate> {
  const { filter, sort, noun = "rule", loadFailMessage } = options;
  const [rules, setRules] = useState<CoordPolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Cleared by the first completed load, so subsequent refetches are silent.
  const firstLoadDone = useRef(false);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      if (!firstLoadDone.current) setLoading(true);
      const res = await listCoordPolicies();
      const items = (res.policies ?? []).filter((r) => filter(r));
      if (sort) items.sort(sort);
      setRules(items);
      setLoadFailed(false);
    } catch (err) {
      setLoadFailed(true);
      // The headline names WHAT failed (an `httpClient` error message alone
      // often does not); the error text is appended, never swallowed.
      const headline = loadFailMessage ?? `Failed to load ${noun}s`;
      toast.error(
        err instanceof Error ? `${headline}: ${err.message}` : headline
      );
    } finally {
      firstLoadDone.current = true;
      setLoading(false);
    }
  }, [filter, sort, noun, loadFailMessage]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  /**
   * One-step edit: hold `saving`, run the call, toast, reload.
   *
   * Success is reported by an explicit `ok` flag, NOT by the response value:
   * `HttpClient.delete` resolves to `undefined` on a 204, so keying success on
   * a non-null body would report every successful DELETE as a failure.
   */
  const step = useCallback(
    async <T>(
      run: () => Promise<T>,
      okMessage: string,
      failMessage: string
    ): Promise<{ ok: true; value: T } | { ok: false }> => {
      try {
        setSaving(true);
        const value = await run();
        toast.success(okMessage);
        await loadRules();
        return { ok: true, value };
      } catch (err) {
        toast.error(err instanceof Error ? err.message : failMessage);
        return { ok: false };
      } finally {
        setSaving(false);
      }
    },
    [loadRules]
  );

  const createRule = async (data: TCreate): Promise<CoordPolicyRow | null> => {
    const result = await step(
      () => createCoordPolicy<TCreate>(data),
      `${capitalize(noun)} created`,
      `Failed to create ${noun}`
    );
    return result.ok ? (result.value ?? null) : null;
  };

  const updateRule = async (policyId: string, data: TUpdate) =>
    (
      await step(
        () => patchCoordPolicy<TUpdate>(policyId, data),
        `${capitalize(noun)} updated`,
        `Failed to update ${noun}`
      )
    ).ok;

  const deleteRule = async (policyId: string) =>
    (
      await step(
        () => deleteCoordPolicy(policyId),
        `${capitalize(noun)} deleted`,
        `Failed to delete ${noun}`
      )
    ).ok;

  const restoreDefault = async (policyId: string) =>
    (
      await step(
        () => restoreCoordPolicyDefault(policyId),
        "Restored to default",
        "Failed to restore default"
      )
    ).ok;

  /**
   * Upsert THIS tenant's override of a system built-in.
   *
   * ⚠️ **v1 shapes only.** Coord's `SystemOverrideRequest::Custom` is
   * `{name, kind, condition, action}` and carries NO `payload` field, and the
   * `{disabled:true}` toggle copies the system row's discriminator columns but
   * likewise NOT its `payload` — while the v2 domain resolver
   * (`fetch_policies_by_domain`) filters `enabled = true` and is blind to
   * `overrides_system_rule_id`. A v2 surface must therefore NOT wire this: a
   * disable-override would render as "disabled" while the system rule kept
   * deciding. See `gate-clearance/gateClearance.ts` for the mechanism a v2
   * surface uses instead (a tenant-band row of its own, which outranks the
   * system band).
   */
  const overrideSystemRule = async (
    systemRuleId: string,
    body: { disabled: boolean } | TCreate
  ) =>
    (
      await step(
        () => putCoordPolicySystemOverride<TCreate>(systemRuleId, body),
        "Built-in updated for your workspace",
        "Failed to update built-in"
      )
    ).ok;

  /** Revert THIS tenant's override of a system built-in (v1 shapes only). */
  const revertOverride = async (systemRuleId: string) =>
    (
      await step(
        () => deleteCoordPolicySystemOverride(systemRuleId),
        "Reverted to built-in",
        "Failed to revert to built-in"
      )
    ).ok;

  const runSequence = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      setSaving(true);
      return await fn();
    } finally {
      // Reload BEFORE releasing `saving`: clearing it first re-enables the
      // controls against the pre-edit list.
      await loadRules();
      setSaving(false);
    }
  };

  return {
    rules,
    loading,
    saving,
    loadFailed,
    reload: loadRules,
    createRule,
    updateRule,
    deleteRule,
    restoreDefault,
    overrideSystemRule,
    revertOverride,
    runSequence,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
