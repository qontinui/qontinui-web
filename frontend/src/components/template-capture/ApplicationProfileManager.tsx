import React, { useCallback } from "react";
import { Plus, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApplicationProfile } from "@/services/template-capture-service";
import { useApplicationProfiles } from "./_hooks/useApplicationProfiles";
import { useProfileDialogs } from "./_hooks/useProfileDialogs";
import { ProfileCard } from "./_components/ProfileCard";
import { CreateProfileDialog } from "./_components/CreateProfileDialog";
import { EditProfileDialog } from "./_components/EditProfileDialog";
import { DeleteProfileDialog } from "./_components/DeleteProfileDialog";
import { TuningDialog } from "./_components/TuningDialog";

export interface ApplicationProfileManagerProps {
  onProfileSelect?: (profile: ApplicationProfile) => void;
  selectedProfileName?: string;
  className?: string;
}

export function ApplicationProfileManager({
  onProfileSelect,
  selectedProfileName,
  className,
}: ApplicationProfileManagerProps) {
  const {
    profiles,
    loading,
    error,
    fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    tuneProfile,
  } = useApplicationProfiles();

  const dialogs = useProfileDialogs();

  const handleCreate = useCallback(async () => {
    if (!dialogs.formName.trim()) return;
    dialogs.setFormSubmitting(true);
    try {
      await createProfile(dialogs.formName, dialogs.formStrategies);
      dialogs.closeCreateDialog();
    } finally {
      dialogs.setFormSubmitting(false);
    }
  }, [createProfile, dialogs]);

  const handleUpdate = useCallback(async () => {
    if (!dialogs.editingProfile) return;
    dialogs.setFormSubmitting(true);
    try {
      await updateProfile(dialogs.editingProfile, dialogs.formStrategies);
      dialogs.closeEditDialog();
    } finally {
      dialogs.setFormSubmitting(false);
    }
  }, [updateProfile, dialogs]);

  const handleDelete = useCallback(async () => {
    if (!dialogs.deletingProfile) return;
    await deleteProfile(dialogs.deletingProfile);
    dialogs.closeDeleteDialog();
  }, [deleteProfile, dialogs]);

  const handleTune = useCallback(async () => {
    if (!dialogs.tuningProfile) return;
    dialogs.setFormSubmitting(true);
    try {
      const result = await tuneProfile(dialogs.tuningProfile);
      dialogs.setTuningResult(result);
    } finally {
      dialogs.setFormSubmitting(false);
    }
  }, [tuneProfile, dialogs]);

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Application Profiles</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchProfiles}
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={dialogs.openCreateDialog}>
            <Plus className="h-4 w-4 mr-2" />
            New Profile
          </Button>
        </div>
      </div>

      {loading && profiles.length === 0 ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center text-red-600 py-4">{error}</div>
      ) : profiles.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          <p>No profiles yet</p>
          <p className="text-sm">
            Create a profile to optimize detection for specific applications
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.map((profile) => (
            <ProfileCard
              key={profile.id}
              profile={profile}
              isSelected={selectedProfileName === profile.name}
              onSelect={() => onProfileSelect?.(profile)}
              onEdit={() => dialogs.openEditDialog(profile)}
              onDelete={() => dialogs.openDeleteDialog(profile)}
              onTune={() => dialogs.openTuningDialog(profile)}
            />
          ))}
        </div>
      )}

      <CreateProfileDialog
        open={dialogs.createDialogOpen}
        onOpenChange={(open) => !open && dialogs.closeCreateDialog()}
        formName={dialogs.formName}
        onFormNameChange={dialogs.setFormName}
        formStrategies={dialogs.formStrategies}
        onToggleStrategy={dialogs.toggleStrategy}
        onSubmit={handleCreate}
        submitting={dialogs.formSubmitting}
      />

      <EditProfileDialog
        profile={dialogs.editingProfile}
        onClose={dialogs.closeEditDialog}
        formStrategies={dialogs.formStrategies}
        onToggleStrategy={dialogs.toggleStrategy}
        onSubmit={handleUpdate}
        submitting={dialogs.formSubmitting}
      />

      <DeleteProfileDialog
        profile={dialogs.deletingProfile}
        onClose={dialogs.closeDeleteDialog}
        onConfirm={handleDelete}
      />

      <TuningDialog
        profile={dialogs.tuningProfile}
        result={dialogs.tuningResult}
        onClose={dialogs.closeTuningDialog}
        onTune={handleTune}
        submitting={dialogs.formSubmitting}
      />
    </div>
  );
}
