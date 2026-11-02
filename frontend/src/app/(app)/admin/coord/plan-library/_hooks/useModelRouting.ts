"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import type { ModelRoutingResponse, ModelRoutingUpdate } from "../types";

const ROUTE = "/api/v1/plan-library/model-routing";

function message(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/**
 * The model family each plan difficulty level routes to (plan
 * `2026-10-08-operator-editable-model-family-per-plan-difficulty`).
 *
 * Honesty properties, the same ones the policy dials on this page keep:
 *
 * - `routing` is what the backend SERVES — after a save it is the PUT's own
 *   answer, which the backend re-reads after its commit, never the map the
 *   form sent. So the panel shows what `/vet-imp-sweep` will now read.
 * - A failed read leaves the last good `routing` in place and sets `error`;
 *   with no prior read, `routing` stays null and the panel says UNKNOWN rather
 *   than painting the defaults.
 * - A failed save sets `saveError` and leaves `routing` untouched: nothing was
 *   confirmed stored, so nothing on screen claims it was.
 */
export function useModelRouting() {
  const [routing, setRouting] = useState<ModelRoutingResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** When the last save was CONFIRMED by the backend's answer. */
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    // A re-read may return someone else's map; the "saved" line describes
    // only the answer to THIS session's save, so it goes.
    setSavedAt(null);
    try {
      const next = await httpClient.get<ModelRoutingResponse>(ROUTE);
      if (!mounted.current) return;
      setRouting(next);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(message(err, "the model routing could not be read"));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** One write path for both verbs: the answer is what is now SERVED. */
  const write = useCallback(
    async (
      send: () => Promise<ModelRoutingResponse>,
      done: string
    ): Promise<boolean> => {
      setSaving(true);
      setSaveError(null);
      try {
        const next = await send();
        if (!mounted.current) return true;
        setRouting(next);
        setError(null);
        setSavedAt(new Date());
        toast.success(done);
        return true;
      } catch (err) {
        const why = message(err, "the write was refused");
        if (mounted.current) setSaveError(why);
        toast.error(`Model routing not changed: ${why}`);
        return false;
      } finally {
        if (mounted.current) setSaving(false);
      }
    },
    []
  );

  /** Store the FULL map (`PUT`). */
  const save = useCallback(
    (update: ModelRoutingUpdate) =>
      write(
        () => httpClient.put<ModelRoutingResponse>(ROUTE, update),
        "Model routing saved"
      ),
    [write]
  );

  /** Delete every stored level (`DELETE`) — each serves the default again. */
  const reset = useCallback(
    () =>
      write(
        () => httpClient.delete<ModelRoutingResponse>(ROUTE),
        "Model routing reset to the defaults"
      ),
    [write]
  );

  return {
    routing,
    loading,
    saving,
    error,
    saveError,
    savedAt,
    reload,
    save,
    reset,
  };
}
