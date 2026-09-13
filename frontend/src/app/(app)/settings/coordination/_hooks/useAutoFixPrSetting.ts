"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";
import {
  type AutoFixPrChoice,
  type AutoFixPrState,
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
}

/**
 * Loads and writes the tenant `auto_fix_pr` dial through the existing
 * pr-merge settings proxy. The dial writes on click rather than joining the
 * page's Save button: it is a different endpoint and a different table from
 * the next-step autonomy draft, and a Save that silently covered both would
 * blur which write failed.
 */
export function useAutoFixPrSetting(): UseAutoFixPrSettingReturn {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<AutoFixPrState | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data =
          await httpClient.get<TenantSettingsResponse>(SETTINGS_PATH);
        if (!cancelled) setState(readAutoFixPr(data?.profile));
      } catch (err) {
        if (!cancelled) {
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
  }, []);

  const setChoice = useCallback(async (choice: AutoFixPrChoice) => {
    setSaving(true);
    try {
      const data = await httpClient.patch<TenantSettingsResponse>(
        SETTINGS_PATH,
        { auto_fix_pr: tenantFromChoice(choice) }
      );
      setState(readAutoFixPr(data?.profile));
      setError(null);
      toast.success("Fixer session setting saved");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save fixer setting"
      );
    } finally {
      setSaving(false);
    }
  }, []);

  return { loading, saving, error, state, setChoice };
}
