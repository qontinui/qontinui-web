"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  type AutoFixPrChoice,
  type AutoFixPrState,
  isUnconfirmedWrite,
  readAutoFixPr,
  tenantFromChoice,
} from "./auto-fix-pr";

const SETTINGS_PATH = "/api/v1/operations/pr-merge/settings";

interface TenantSettingsResponse {
  tenant_id: string;
  profile: unknown;
}

export interface UseAutoFixPrSettingReturn {
  loading: boolean;
  saving: boolean;
  /** Load failure message — the dial is then UNKNOWN, never on. */
  error: string | null;
  /** `null` when loaded but the coord build does not serve the fields. */
  state: AutoFixPrState | null;
  setChoice: (choice: AutoFixPrChoice) => Promise<void>;
  reload: () => void;
}

/**
 * Loads and writes the tenant `auto_fix_pr` dial through the existing
 * pr-merge settings proxy. The dial writes on click rather than joining the
 * page's Save button: it is a different endpoint and a different table from
 * the next-step autonomy draft, and a Save that silently covered both would
 * blur which write failed.
 *
 * A write counts as saved only when coord's response READS BACK the value that
 * was sent. A 2xx whose profile lacks the dial, or carries a different tenant
 * value, is an unconfirmed write and is reported as one.
 */
export function useAutoFixPrSetting(): UseAutoFixPrSettingReturn {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AutoFixPrState | null>(null);
  const [loadNonce, setLoadNonce] = useState(0);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data =
          await httpClient.get<TenantSettingsResponse>(SETTINGS_PATH);
        if (!cancelled) setState(readAutoFixPr(data?.profile));
      } catch (err) {
        if (!cancelled) {
          setState(null);
          setError(
            err instanceof Error ? err.message : "Failed to load merge settings"
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadNonce]);

  const reload = useCallback(() => setLoadNonce((n) => n + 1), []);

  const setChoice = useCallback(async (choice: AutoFixPrChoice) => {
    // One write at a time: a second click while a PATCH is in flight is
    // dropped rather than racing the first to a last-writer-wins result.
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    const sent = tenantFromChoice(choice);
    try {
      const data = await httpClient.patch<TenantSettingsResponse>(
        SETTINGS_PATH,
        { auto_fix_pr: sent }
      );
      const next = readAutoFixPr(data?.profile);
      if (next === null || next.tenant !== sent) {
        toast.error(
          "Coord accepted the request but did not confirm the fixer setting — reloading."
        );
        setLoadNonce((n) => n + 1);
        return;
      }
      setState(next);
      setError(null);
      toast.success("Fixer session setting saved");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save fixer setting";
      if (isUnconfirmedWrite(message)) {
        // coord could not tell whether the commit landed. Neither "saved" nor
        // "safe to retry": show what coord actually serves now.
        toast.error(
          "Save outcome unknown — coord could not confirm the commit. Reloading to check."
        );
        setLoadNonce((n) => n + 1);
        return;
      }
      toast.error(message);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, []);

  return { loading, saving, error, state, setChoice, reload };
}
