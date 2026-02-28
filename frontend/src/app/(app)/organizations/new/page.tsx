"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Building2, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function NewOrganizationPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { createOrg } = useOrganization();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (name) {
      const generatedSlug = name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .trim();
      setSlug(generatedSlug);
    } else {
      setSlug("");
    }
  }, [name]);

  const handleCreate = async () => {
    if (!name.trim()) {
      toast.error("Please enter an organization name");
      return;
    }

    setCreating(true);
    try {
      const newOrg = await createOrg(name, description || undefined);
      toast.success("Organization created successfully");
      router.push(`/organizations/${newOrg.id}`);
    } catch (err: unknown) {
      console.error("Failed to create organization:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to create organization"
      );
    } finally {
      setCreating(false);
    }
  };

  const handleCancel = () => {
    router.push("/organizations");
  };

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

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Create New Organization</h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">
                Organization Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Acme Corporation"
                className="bg-background border-border mt-1.5"
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1">
                This will be the display name for your organization
              </p>
            </div>

            <div>
              <Label htmlFor="slug">Organization Slug</Label>
              <div className="relative mt-1.5">
                <Input
                  id="slug"
                  value={slug}
                  readOnly
                  placeholder="auto-generated-from-name"
                  className="bg-muted/50 border-border text-muted-foreground cursor-not-allowed"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Sparkles className="w-4 h-4 text-primary" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Automatically generated from the organization name
              </p>
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what your organization does..."
                rows={4}
                className="bg-background border-border resize-none mt-1.5"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Help team members understand the purpose of this organization
              </p>
            </div>
          </div>

          <div className="border border-border rounded-lg p-4 bg-muted/50">
            <h4 className="text-sm font-medium mb-2 text-primary">
              What happens next?
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>You&apos;ll be set as the organization owner</li>
              <li>You can invite team members to collaborate</li>
              <li>All projects can be shared with your organization</li>
              <li>You can manage roles and permissions for members</li>
            </ul>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={creating}
              className="border-border"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || creating}
              className="bg-primary text-primary-foreground min-w-[150px]"
            >
              {creating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Building2 className="w-4 h-4 mr-2" />
                  Create Organization
                </>
              )}
            </Button>
          </div>

          {name && (
            <div className="border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-3">
                Preview
              </p>
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center text-lg font-bold text-primary">
                  {name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold">{name}</h3>
                  {description && (
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {description}
                    </p>
                  )}
                  <div className="flex gap-4 text-xs text-muted-foreground mt-2">
                    <span>0 projects</span>
                    <span>1 member (you)</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
