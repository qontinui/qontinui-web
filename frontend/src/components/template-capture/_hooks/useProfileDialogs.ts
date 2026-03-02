import { useState, useCallback } from "react";
import type { ApplicationProfile } from "@/services/template-capture-service";
import type {
  DetectionStrategyType,
  TuningResult,
} from "@/services/template-capture-service";

export function useProfileDialogs() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<ApplicationProfile | null>(null);
  const [deletingProfile, setDeletingProfile] =
    useState<ApplicationProfile | null>(null);
  const [tuningProfile, setTuningProfile] = useState<ApplicationProfile | null>(
    null
  );
  const [tuningResult, setTuningResult] = useState<TuningResult | null>(null);

  const [formName, setFormName] = useState("");
  const [formStrategies, setFormStrategies] = useState<DetectionStrategyType[]>(
    []
  );
  const [formSubmitting, setFormSubmitting] = useState(false);

  const openCreateDialog = useCallback(() => {
    setFormName("");
    setFormStrategies([]);
    setCreateDialogOpen(true);
  }, []);

  const closeCreateDialog = useCallback(() => {
    setCreateDialogOpen(false);
    setFormName("");
    setFormStrategies([]);
  }, []);

  const openEditDialog = useCallback((profile: ApplicationProfile) => {
    setEditingProfile(profile);
    setFormStrategies(profile.preferred_strategies || []);
  }, []);

  const closeEditDialog = useCallback(() => {
    setEditingProfile(null);
  }, []);

  const openDeleteDialog = useCallback((profile: ApplicationProfile) => {
    setDeletingProfile(profile);
  }, []);

  const closeDeleteDialog = useCallback(() => {
    setDeletingProfile(null);
  }, []);

  const openTuningDialog = useCallback((profile: ApplicationProfile) => {
    setTuningProfile(profile);
    setTuningResult(null);
  }, []);

  const closeTuningDialog = useCallback(() => {
    setTuningProfile(null);
    setTuningResult(null);
  }, []);

  const toggleStrategy = useCallback((strategy: DetectionStrategyType) => {
    setFormStrategies((prev) =>
      prev.includes(strategy)
        ? prev.filter((s) => s !== strategy)
        : [...prev, strategy]
    );
  }, []);

  return {
    createDialogOpen,
    editingProfile,
    deletingProfile,
    tuningProfile,
    tuningResult,
    formName,
    formStrategies,
    formSubmitting,
    setFormName,
    setFormSubmitting,
    setTuningResult,
    openCreateDialog,
    closeCreateDialog,
    openEditDialog,
    closeEditDialog,
    openDeleteDialog,
    closeDeleteDialog,
    openTuningDialog,
    closeTuningDialog,
    toggleStrategy,
  };
}
