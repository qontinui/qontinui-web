"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  deleteTenantGithubHost,
  fetchTenantGithubHost,
  putTenantGithubHost,
  type TenantGithubHostView,
  type TenantGithubHostWrite,
} from "@/lib/api/operations/tenantPolicy";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import {
  githubHostRefusal,
  type GithubHostRefusal,
} from "../_lib/githubHostRefusal";

/**
 * The tenant's GitHub host (`/operations/tenant/github-host`, plan
 * `2026-10-10-spec-front-end-phase-9-generic-boundary` Phase 3).
 *
 * * **`host`** — the last view coord answered: the read, or a write's echo
 *   (coord returns the row it stored, so a landed write needs no re-read).
 *   `null` until a read succeeds.
 * * **`error`** — the last read failed; `host` is then the last value read, or
 *   `null` (UNKNOWN), never the github.com default.
 * * **`writeError`** — the last write was refused or lost, with coord's code
 *   and, for `repos_registered_on_another_host`, the repos blocking it.
 *
 * A read that began before a write landed is dropped, so a slow Refresh can
 * never repaint the pre-write host over the write's echo.
 */
export function useTenantGithubHost() {
  const [host, setHost] = useState<TenantGithubHostView | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<GithubHostRefusal | null>(null);
  /** Bumped by every read start and every landed write. */
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const view = await fetchTenantGithubHost();
      if (mine !== generation.current) return false;
      setHost(view);
      setError(null);
      return true;
    } catch (err) {
      if (mine !== generation.current) return false;
      setError(operationsErrorMessage(err));
      return false;
    } finally {
      if (mine === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const write = useCallback(
    async (
      send: () => Promise<TenantGithubHostView>,
      success: string
    ): Promise<boolean> => {
      setSaving(true);
      setWriteError(null);
      try {
        const view = await send();
        generation.current += 1;
        setHost(view);
        setError(null);
        setLoading(false);
        toast.success(success);
        return true;
      } catch (err) {
        const refusal = githubHostRefusal(err);
        setWriteError(refusal);
        toast.error(refusal.message);
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const save = useCallback(
    (bases: TenantGithubHostWrite) =>
      write(() => putTenantGithubHost(bases), "GitHub host saved"),
    [write]
  );

  const reset = useCallback(
    () =>
      write(() => deleteTenantGithubHost(), "GitHub host reset to github.com"),
    [write]
  );

  return { host, loading, saving, error, writeError, reload, save, reset };
}
