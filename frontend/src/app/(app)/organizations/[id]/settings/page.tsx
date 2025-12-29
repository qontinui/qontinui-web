"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { organizationService } from "@/services/service-factory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { ArrowLeft, Save, Trash2, Loader2, AlertTriangle } from "lucide-react";
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

      // Reload organization data
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
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <div className="text-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
            <p className="text-gray-400">Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <Card className="bg-[#1A1A1B]/50 border-red-500/50 backdrop-blur-sm">
            <CardContent className="p-8 text-center">
              <p className="text-red-400 mb-4">Organization not found</p>
              <Button
                onClick={() => router.push("/organizations")}
                variant="outline"
                className="border-gray-700 hover:border-[#00D9FF]"
              >
                Back to Organizations
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!isOwner) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
        <div className="p-6 max-w-7xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => router.push(`/organizations/${orgId}`)}
            className="mb-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organization
          </Button>

          <Card className="bg-[#1A1A1B]/50 border-yellow-500/50 backdrop-blur-sm">
            <CardContent className="p-8 text-center">
              <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-yellow-500" />
              <p className="text-yellow-400 mb-4">
                Only organization owners can access settings
              </p>
              <Button
                onClick={() => router.push(`/organizations/${orgId}`)}
                variant="outline"
                className="border-gray-700 hover:border-[#00D9FF]"
              >
                Back to Organization
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0A0A0B] via-[#0F0F10] to-[#0A0A0B] text-white">
      <div className="p-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Button
            variant="ghost"
            onClick={() => router.push(`/organizations/${orgId}`)}
            className="mb-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organization
          </Button>

          <h1 className="text-3xl font-bold mb-2">Organization Settings</h1>
          <p className="text-gray-400">{organization.name}</p>
        </div>

        {/* General Settings */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle>General Information</CardTitle>
            <CardDescription>
              Update your organization&apos;s basic information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Organization Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter organization name"
                className="bg-[#0A0A0B] border-gray-800 text-white"
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
                className="bg-[#0A0A0B] border-gray-800 text-white resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setName(organization.name);
                  setDescription(organization.description || "");
                }}
                disabled={!hasChanges || saving}
                className="border-gray-700"
              >
                Reset
              </Button>
              <Button
                onClick={handleSave}
                disabled={!hasChanges || !name.trim() || saving}
                className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
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
          </CardContent>
        </Card>

        {/* Organization Info */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle>Organization Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Organization ID</span>
              <span className="font-mono text-sm">{organization.id}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Created</span>
              <span>
                {new Date(organization.created_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-800">
              <span className="text-gray-400">Last Updated</span>
              <span>
                {new Date(organization.updated_at).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-400">Total Members</span>
              <span>{organization.member_count}</span>
            </div>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="bg-[#1A1A1B]/50 border-red-500/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-red-400">Danger Zone</CardTitle>
            <CardDescription>
              Irreversible actions - proceed with caution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 border border-red-500/30 rounded-lg bg-red-500/5">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <h4 className="font-semibold text-red-400 mb-1">
                    Delete Organization
                  </h4>
                  <p className="text-sm text-gray-400">
                    Permanently delete this organization and all associated
                    data. This action cannot be undone.
                  </p>
                </div>
              </div>
              <Button
                onClick={() => setDeleteDialogOpen(true)}
                variant="outline"
                className="border-red-500 text-red-400 hover:bg-red-500 hover:text-white mt-3"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete Organization
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent className="bg-[#1A1A1B] border-red-500/50 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-red-400">
                Delete Organization
              </AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                This action cannot be undone. This will permanently delete the
                organization
                <span className="font-semibold text-white">
                  {" "}
                  {organization.name}
                </span>
                , remove all members, and delete all associated projects and
                data.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="my-4">
              <Label htmlFor="delete-confirm" className="text-gray-400">
                Type{" "}
                <span className="font-semibold text-white">
                  {organization.name}
                </span>{" "}
                to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirmation}
                onChange={(e) => setDeleteConfirmation(e.target.value)}
                placeholder="Enter organization name"
                className="bg-[#0A0A0B] border-gray-800 text-white mt-2"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                className="border-gray-700"
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

        {/* Leave Organization Dialog */}
        <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
          <AlertDialogContent className="bg-[#1A1A1B] border-gray-800 text-white">
            <AlertDialogHeader>
              <AlertDialogTitle>Leave Organization</AlertDialogTitle>
              <AlertDialogDescription className="text-gray-400">
                Are you sure you want to leave this organization? You will lose
                access to all organization resources.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-gray-700" disabled={leaving}>
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
    </div>
  );
}
