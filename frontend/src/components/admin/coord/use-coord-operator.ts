"use client";

import { useAuth } from "@/contexts/auth-context";

/**
 * useCoordOperator — gate for Coord Console mutation controls.
 *
 * The /admin/coord console is VIEWABLE by every authenticated user (the
 * layout no longer hard-gates on is_superuser). Operator/mutation controls
 * — spawn, plan transitions, memory upsert/delete/restore, rollout
 * promote/demote, onboarding writes, question answers — stay gated to
 * superusers per-control.
 *
 * `isOperator` is the single predicate every mutation surface reads. It is
 * a UX boundary only — the API endpoints behind each control are the real
 * security boundary and must enforce admin server-side independently.
 *
 * Fail-safe convention: HIDE the mutation control (button / form / modal
 * trigger) when `!isOperator`, rather than merely disabling it. Read views
 * stay visible.
 */
export function useCoordOperator(): { isOperator: boolean } {
  const { user } = useAuth();
  return { isOperator: !!user?.is_superuser };
}
