import { useState, useCallback, useEffect } from "react";
import {
  TemplateCaptureService,
  type ApplicationProfile,
  type DetectionStrategyType,
  type TuningResult,
} from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export function useApplicationProfiles() {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [profiles, setProfiles] = useState<ApplicationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await service.listProfiles();
      setProfiles(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  const createProfile = useCallback(
    async (name: string, strategies: DetectionStrategyType[]) => {
      const newProfile = await service.createProfile({
        name: name.trim(),
        preferred_strategies: strategies.length > 0 ? strategies : undefined,
      });
      setProfiles((prev) => [...prev, newProfile]);
    },
    [service]
  );

  const updateProfile = useCallback(
    async (
      profile: ApplicationProfile,
      strategies: DetectionStrategyType[]
    ) => {
      const updatedProfile = await service.updateProfile(profile.name, {
        preferred_strategies: strategies.length > 0 ? strategies : undefined,
      });
      setProfiles((prev) =>
        prev.map((p) => (p.id === updatedProfile.id ? updatedProfile : p))
      );
    },
    [service]
  );

  const deleteProfile = useCallback(
    async (profile: ApplicationProfile) => {
      await service.deleteProfile(profile.name);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
    },
    [service]
  );

  const tuneProfile = useCallback(
    async (profile: ApplicationProfile): Promise<TuningResult> => {
      const result = await service.tuneProfile(profile.name);
      await fetchProfiles();
      return result;
    },
    [service, fetchProfiles]
  );

  return {
    profiles,
    loading,
    error,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    tuneProfile,
  };
}
