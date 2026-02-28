"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Save, Trash2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Organization } from "@/types/collaboration";

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const orgId = params?.id as string;

  const { user, loading: authLoading } = useAuth();
  const { updateOrg, deleteOrg, leaveOrg } = useOrganization();

  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!orgId || !user) return;

    const loadData = async () => {
      setLoading(true);

      try {
        const org = await organizationService.getOrganization(orgId);
        setOrganization(org);
        setName(org.name);
        setDescription(org.description || "");
      } catch (err) {
        console.error("Failed to load organization:", err);
        toast.error("Failed to load organization");
        router.push("/organizations");
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [orgId, user, router]);

  const handleSave = async () => {
    if (!orgId || !name.trim()) return;

    setSaving(true);
    try {
      await updateOrg(orgId, name, description);
      toast.success("Organization updated successfully");

      const org = await organizationService.getOrganization(orgId);
      setOrganization(org);
    } catch (err: unknown) {
      console.error("Failed to update organization:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to update organization"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!orgId || deleteConfirmation !== organization?.name) return;

    setDeleting(true);
    try {
      await deleteOrg(orgId);
      toast.success("Organization deleted successfully");
      router.push("/organizations");
    } catch (err: unknown) {
      console.error("Failed to delete organization:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to delete organization"
      );
      setDeleting(false);
    }
  };

  const handleLeave = async () => {
    if (!orgId) return;

    setLeaving(true);
    try {
      await leaveOrg(orgId);
      toast.success("You have left the organization");
      router.push("/organizations");
    } catch (err: unknown) {
      console.error("Failed to leave organization:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to leave organization"
      );
      setLeaving(false);
    }
  };

  const isOwner = organization?.owner_id === user?.id;
  const hasChanges =
    name !== organization?.name ||
    description !== (organization?.description || "");

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-primary" />
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-red-400 mb-4">Organization not found</p>
            <Button
              onClick={() => router.push("/organizations")}
              variant="outline"
              className="border-border hover:border-primary"
            >
              Back to Organizations
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3 text-yellow-500" />
            <p className="text-yellow-400 mb-4">
              Only organization owners can access settings
            </p>
            <Button
              onClick={() => router.push(`/organizations/${orgId}`)}
              variant="outline"
              className="border-border hover:border-primary"
            >
              Back to Organization
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div>
          <h1 className="text-lg font-semibold">Organization Settings</h1>
          <p className="text-xs text-muted-foreground">{organization.name}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-8">
          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-medium">General Information</h2>
              <p className="text-xs text-muted-foreground">
                Update your organization&apos;s basic information
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter organization name"
                  className="bg-background border-border mt-1.5"
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Enter organization description"
                  rows={4}
                  className="bg-background border-border resize-none mt-1.5"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setName(organization.name);
                    setDescription(organization.description || "");
                  }}
                  disabled={!hasChanges || saving}
                  className="border-border"
                >
                  Reset
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={!hasChanges || !name.trim() || saving}
                  className="bg-primary text-primary-foreground"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Save Changes
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>

          <div className="border-t border-border" />

          <section className="space-y-3">
            <h2 className="text-sm font-medium">Organization Information</h2>
            <div className="space-y-0 divide-y divide-border border border-border rounded-lg">
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Organization ID
                </span>
                <span className="font-mono text-xs">{organization.id}</span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">Created</span>
                <span className="text-sm">
                  {new Date(organization.created_at).toLocaleDateString(
                    "en-US",
                    {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }
                  )}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Last Updated
                </span>
                <span className="text-sm">
                  {new Date(organization.updated_at).toLocaleDateString(
                    "en-US",
                    {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    }
                  )}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Total Members
                </span>
                <span className="text-sm">{organization.member_count}</span>
              </div>
            </div>
          </section>

          <div className="border-t border-border" />

          <section className="space-y-4">
            <div>
              <h2 className="text-sm font-medium text-red-400">Danger Zone</h2>
              <p className="text-xs text-muted-foreground">
                Irreversible actions - proceed with caution
              </p>
            </div>
            <div className="border border-red-500/30 rounded-lg p-4">
              <h4 className="text-sm font-medium text-red-400 mb-1">
                Delete Organization
              </h4>
              <p className="text-xs text-muted-foreground mb-3">
                Permanently delete this organization and all associated data.
                This action cannot be undone.
              </p>
              <Button
                onClick={() => setDeleteDialogOpen(true)}
                variant="outline"
                size="sm"
                className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Organization
              </Button>
            </div>
          </section>
        </div>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="bg-background border-red-500/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-400">
              Delete Organization
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This action cannot be undone. This will permanently delete the
              organization
              <span className="font-semibold text-foreground">
                {" "}
                {organization.name}
              </span>
              , remove all members, and delete all associated projects and data.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="my-4">
            <Label htmlFor="delete-confirm" className="text-muted-foreground">
              Type{" "}
              <span className="font-semibold text-foreground">
                {organization.name}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="delete-confirm"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="Enter organization name"
              className="bg-background border-border mt-2"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              className="border-border"
              disabled={deleting}
              onClick={() => setDeleteConfirmation("")}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteConfirmation !== organization.name || deleting}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Organization
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <AlertDialogContent className="bg-background border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>Leave Organization</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Are you sure you want to leave this organization? You will lose
              access to all organization resources.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-border" disabled={leaving}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleLeave}
              disabled={leaving}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              {leaving ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Leaving...
                </>
              ) : (
                "Leave Organization"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
