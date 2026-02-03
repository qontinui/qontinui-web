/**
 * ApplicationProfileManager Component
 *
 * CRUD interface for application detection profiles.
 *
 * Features:
 * - List all profiles with stats
 * - Create new profiles
 * - Edit profile settings
 * - Trigger auto-tuning
 * - Delete profiles
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  Plus,
  Settings,
  Trash2,
  Wand2,
  RefreshCw,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type {
  ApplicationProfile,
  DetectionStrategyType,
  TuningResult,
} from "@/services/template-capture-service";
import { TemplateCaptureService } from "@/services/template-capture-service";
import { httpClient } from "@/services/service-factory";

export interface ApplicationProfileManagerProps {
  onProfileSelect?: (profile: ApplicationProfile) => void;
  selectedProfileName?: string;
  className?: string;
}

const STRATEGY_OPTIONS: DetectionStrategyType[] = [
  "contour",
  "edge",
  "color_segmentation",
  "flood_fill",
  "gradient",
];

export function ApplicationProfileManager({
  onProfileSelect,
  selectedProfileName,
  className,
}: ApplicationProfileManagerProps) {
  const [service] = useState(() => new TemplateCaptureService(httpClient));
  const [profiles, setProfiles] = useState<ApplicationProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<ApplicationProfile | null>(null);
  const [deletingProfile, setDeletingProfile] =
    useState<ApplicationProfile | null>(null);
  const [tuningProfile, setTuningProfile] = useState<ApplicationProfile | null>(
    null
  );
  const [tuningResult, setTuningResult] = useState<TuningResult | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formStrategies, setFormStrategies] = useState<DetectionStrategyType[]>(
    []
  );
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Fetch profiles
  const fetchProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await service.listProfiles();
      setProfiles(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load profiles");
      console.error(
        "[ApplicationProfileManager] Error fetching profiles:",
        err
      );
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    fetchProfiles();
  }, [fetchProfiles]);

  // Create profile
  const handleCreate = useCallback(async () => {
    if (!formName.trim()) return;

    setFormSubmitting(true);
    try {
      const newProfile = await service.createProfile({
        name: formName.trim(),
        preferred_strategies:
          formStrategies.length > 0 ? formStrategies : undefined,
      });
      setProfiles((prev) => [...prev, newProfile]);
      setCreateDialogOpen(false);
      setFormName("");
      setFormStrategies([]);
    } catch (err) {
      console.error("[ApplicationProfileManager] Error creating profile:", err);
    } finally {
      setFormSubmitting(false);
    }
  }, [service, formName, formStrategies]);

  // Update profile
  const handleUpdate = useCallback(async () => {
    if (!editingProfile) return;

    setFormSubmitting(true);
    try {
      const updatedProfile = await service.updateProfile(editingProfile.name, {
        preferred_strategies:
          formStrategies.length > 0 ? formStrategies : undefined,
      });
      setProfiles((prev) =>
        prev.map((p) => (p.id === updatedProfile.id ? updatedProfile : p))
      );
      setEditingProfile(null);
    } catch (err) {
      console.error("[ApplicationProfileManager] Error updating profile:", err);
    } finally {
      setFormSubmitting(false);
    }
  }, [service, editingProfile, formStrategies]);

  // Delete profile
  const handleDelete = useCallback(async () => {
    if (!deletingProfile) return;

    try {
      await service.deleteProfile(deletingProfile.name);
      setProfiles((prev) => prev.filter((p) => p.id !== deletingProfile.id));
      setDeletingProfile(null);
    } catch (err) {
      console.error("[ApplicationProfileManager] Error deleting profile:", err);
    }
  }, [service, deletingProfile]);

  // Trigger tuning
  const handleTune = useCallback(async () => {
    if (!tuningProfile) return;

    setFormSubmitting(true);
    try {
      const result = await service.tuneProfile(tuningProfile.name);
      setTuningResult(result);
      // Refresh profiles to get updated metrics
      await fetchProfiles();
    } catch (err) {
      console.error("[ApplicationProfileManager] Error tuning profile:", err);
    } finally {
      setFormSubmitting(false);
    }
  }, [service, tuningProfile, fetchProfiles]);

  // Open edit dialog
  const openEditDialog = useCallback((profile: ApplicationProfile) => {
    setEditingProfile(profile);
    setFormStrategies(profile.preferred_strategies || []);
  }, []);

  // Toggle strategy selection
  const toggleStrategy = useCallback((strategy: DetectionStrategyType) => {
    setFormStrategies((prev) =>
      prev.includes(strategy)
        ? prev.filter((s) => s !== strategy)
        : [...prev, strategy]
    );
  }, []);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
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
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            New Profile
          </Button>
        </div>
      </div>

      {/* Profile List */}
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
            <Card
              key={profile.id}
              className={cn(
                "cursor-pointer transition-colors",
                selectedProfileName === profile.name && "ring-2 ring-primary"
              )}
              onClick={() => onProfileSelect?.(profile)}
            >
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base">{profile.name}</CardTitle>
                    <Badge variant="outline">
                      {Math.round(profile.success_rate * 100)}% success
                    </Badge>
                    <Badge variant="secondary">
                      {profile.sample_count} samples
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTuningProfile(profile);
                      }}
                    >
                      <Wand2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEditDialog(profile);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeletingProfile(profile);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
              </CardHeader>
              {profile.preferred_strategies &&
                profile.preferred_strategies.length > 0 && (
                  <CardContent className="py-2 pt-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        Strategies:
                      </span>
                      {profile.preferred_strategies.map((s) => (
                        <Badge key={s} variant="outline" className="text-xs">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                )}
            </Card>
          ))}
        </div>
      )}

      {/* Create Profile Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Application Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Application Name</Label>
              <Input
                id="name"
                placeholder="e.g., Civilization 6"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Preferred Detection Strategies</Label>
              <div className="flex flex-wrap gap-2">
                {STRATEGY_OPTIONS.map((strategy) => (
                  <Badge
                    key={strategy}
                    variant={
                      formStrategies.includes(strategy) ? "default" : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => toggleStrategy(strategy)}
                  >
                    {strategy}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Leave empty to use all strategies
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!formName.trim() || formSubmitting}
            >
              {formSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Profile Dialog */}
      <Dialog
        open={!!editingProfile}
        onOpenChange={(open) => !open && setEditingProfile(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile: {editingProfile?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Preferred Detection Strategies</Label>
              <div className="flex flex-wrap gap-2">
                {STRATEGY_OPTIONS.map((strategy) => (
                  <Badge
                    key={strategy}
                    variant={
                      formStrategies.includes(strategy) ? "default" : "outline"
                    }
                    className="cursor-pointer"
                    onClick={() => toggleStrategy(strategy)}
                  >
                    {strategy}
                  </Badge>
                ))}
              </div>
            </div>
            {editingProfile?.tuning_metrics && (
              <div className="space-y-2">
                <Label>Tuning Metrics</Label>
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>
                    Samples analyzed:{" "}
                    {editingProfile.tuning_metrics.samples_analyzed}
                  </p>
                  <p>
                    Avg accuracy:{" "}
                    {Math.round(
                      editingProfile.tuning_metrics.avg_boundary_accuracy * 100
                    )}
                    %
                  </p>
                  <p>
                    Edge thresholds:{" "}
                    {editingProfile.tuning_metrics.optimal_edge_thresholds.join(
                      " - "
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingProfile(null)}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={formSubmitting}>
              {formSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingProfile}
        onOpenChange={(open) => !open && setDeletingProfile(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Profile</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the profile &quot;
              {deletingProfile?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tuning Dialog */}
      <Dialog
        open={!!tuningProfile}
        onOpenChange={(open) => !open && setTuningProfile(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Auto-Tune: {tuningProfile?.name}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {tuningResult ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {tuningResult.success ? (
                    <Badge className="bg-green-500">Success</Badge>
                  ) : (
                    <Badge className="bg-red-500">Failed</Badge>
                  )}
                  {tuningResult.message && (
                    <span className="text-sm">{tuningResult.message}</span>
                  )}
                </div>
                <div className="space-y-2">
                  <p className="text-sm">
                    <strong>Samples analyzed:</strong>{" "}
                    {tuningResult.metrics.samples_analyzed}
                  </p>
                  <p className="text-sm">
                    <strong>Boundary accuracy:</strong>{" "}
                    {Math.round(
                      tuningResult.metrics.avg_boundary_accuracy * 100
                    )}
                    %
                  </p>
                  <p className="text-sm">
                    <strong>Recommended strategies:</strong>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {tuningResult.recommended_strategies.map((s) => (
                      <Badge key={s} variant="outline">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <p className="text-muted-foreground">
                  Auto-tuning will analyze approved templates to optimize
                  detection parameters for this application.
                </p>
                <Button onClick={handleTune} disabled={formSubmitting}>
                  {formSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Tuning...
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-4 w-4 mr-2" />
                      Start Tuning
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setTuningProfile(null);
                setTuningResult(null);
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
