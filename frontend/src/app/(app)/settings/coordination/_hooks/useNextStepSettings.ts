"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { httpClient } from "@/services/service-factory";

export type AutonomyLevel =
  | "always_escalate"
  | "guidance_only"
  | "auto_decide";

export interface NextStepDomain {
  decision_domain: string;
  label: string;
  description: string;
  autonomy_level: AutonomyLevel;
  default_autonomy_level: AutonomyLevel;
  mode: string;
  resolved_from: "system" | "tenant" | "repo";
  requires_master: boolean;
  effective: boolean;
}

export interface NextStepSettings {
  master_enabled: boolean;
  can_edit: boolean;
  domains: NextStepDomain[];
}

interface DraftMap {
  [decision_domain: string]: AutonomyLevel;
}

interface UseNextStepSettingsReturn {
  settings: NextStepSettings | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  draft: DraftMap;
  hasChanges: boolean;
  canEdit: boolean;
  masterEnabled: boolean;
  setDomainLevel: (domain: string, level: AutonomyLevel) => void;
  resetDomain: (domain: string) => void;
  setPrimary: (on: boolean) => void;
  resetAllDraft: () => void;
  save: () => Promise<void>;
}

function buildDraftFromSettings(settings: NextStepSettings): DraftMap {
  const map: DraftMap = {};
  for (const d of settings.domains) {
    map[d.decision_domain] = d.autonomy_level;
  }
  return map;
}

function draftHasChanges(
  draft: DraftMap,
  settings: NextStepSettings | null
): boolean {
  if (!settings) return false;
  return settings.domains.some(
    (d) => draft[d.decision_domain] !== d.autonomy_level
  );
}

/**
 * Loads + mutates the caller's per-coord-tenant "autonomous next-step"
 * settings via the open-source web proxy (`/api/v1/operations/coord/
 * next-step-settings`), which forwards to the closed-source coord façade.
 * One GET on mount, one PUT on save (the PUT returns the authoritative
 * new state, which re-seeds the form).
 */
export function useNextStepSettings(): UseNextStepSettingsReturn {
  const [settings, setSettings] = useState<NextStepSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftMap>({});

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await httpClient.get<NextStepSettings>(
          "/api/v1/operations/coord/next-step-settings"
        );
        if (!cancelled) {
          setSettings(data);
          setDraft(buildDraftFromSettings(data));
        }
      } catch (err) {
        if (!cancelled) {
          const msg =
            err instanceof Error ? err.message : "Failed to load settings";
          setError(msg);
          toast.error(msg);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const setDomainLevel = useCallback(
    (domain: string, level: AutonomyLevel) => {
      setDraft((prev) => ({ ...prev, [domain]: level }));
    },
    []
  );

  const resetDomain = useCallback(
    (domain: string) => {
      if (!settings) return;
      const d = settings.domains.find((x) => x.decision_domain === domain);
      if (!d) return;
      setDraft((prev) => ({
        ...prev,
        [domain]: d.default_autonomy_level,
      }));
    },
    [settings]
  );

  const setPrimary = useCallback((on: boolean) => {
    setDraft((prev) => ({
      ...prev,
      next_step: on ? "auto_decide" : "guidance_only",
    }));
  }, []);

  const resetAllDraft = useCallback(() => {
    if (!settings) return;
    setDraft(buildDraftFromSettings(settings));
  }, [settings]);

  const save = useCallback(async () => {
    if (!settings) return;

    const changedDomains = settings.domains
      .filter((d) => draft[d.decision_domain] !== d.autonomy_level)
      .map((d) => ({
        decision_domain: d.decision_domain,
        autonomy_level: draft[d.decision_domain],
      }));

    if (changedDomains.length === 0) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await httpClient.put<NextStepSettings>(
        "/api/v1/operations/coord/next-step-settings",
        { domains: changedDomains }
      );
      setSettings(updated);
      setDraft(buildDraftFromSettings(updated));
      toast.success("Coordination settings saved");
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to save settings";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }, [settings, draft]);

  const hasChanges = draftHasChanges(draft, settings);
  const canEdit = settings?.can_edit ?? false;
  const masterEnabled = settings?.master_enabled ?? false;

  return {
    settings,
    loading,
    saving,
    error,
    draft,
    hasChanges,
    canEdit,
    masterEnabled,
    setDomainLevel,
    resetDomain,
    setPrimary,
    resetAllDraft,
    save,
  };
}
