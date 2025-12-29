"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useOrganization } from "@/hooks/useOrganization";
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
import { ArrowLeft, Building2, Loader2, Sparkles } from "lucide-react";
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

  // Auto-generate slug from name
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
      toast.error((err instanceof Error ? err.message : "Failed to create organization"));
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
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4 text-[#00D9FF]" />
          <div className="text-lg text-muted-foreground">Loading...</div>
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
            onClick={handleCancel}
            className="mb-4 text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Organizations
          </Button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 bg-gradient-to-br from-[#00D9FF] to-[#BD00FF] rounded-lg flex items-center justify-center">
              <Building2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Create New Organization</h1>
              <p className="text-gray-400">
                Set up a new organization for your team
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm mb-6">
          <CardHeader>
            <CardTitle>Organization Details</CardTitle>
            <CardDescription>
              Enter the basic information for your new organization
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Name */}
            <div>
              <Label htmlFor="name">
                Organization Name <span className="text-red-400">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Acme Corporation"
                className="bg-[#0A0A0B] border-gray-800 text-white"
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                This will be the display name for your organization
              </p>
            </div>

            {/* Slug (Auto-generated, read-only display) */}
            <div>
              <Label htmlFor="slug">Organization Slug</Label>
              <div className="relative">
                <Input
                  id="slug"
                  value={slug}
                  readOnly
                  placeholder="auto-generated-from-name"
                  className="bg-[#0A0A0B]/50 border-gray-800 text-gray-400 cursor-not-allowed"
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Sparkles className="w-4 h-4 text-[#BD00FF]" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Automatically generated from the organization name
              </p>
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what your organization does..."
                rows={4}
                className="bg-[#0A0A0B] border-gray-800 text-white resize-none"
              />
              <p className="text-xs text-gray-500 mt-1">
                Help team members understand the purpose of this organization
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Info Card */}
        <Card className="bg-[#1A1A1B]/50 border-[#00D9FF]/30 backdrop-blur-sm mb-6">
          <CardContent className="p-6">
            <div className="flex gap-3">
              <div className="w-10 h-10 bg-[#00D9FF]/20 rounded-lg flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-5 h-5 text-[#00D9FF]" />
              </div>
              <div>
                <h4 className="font-semibold mb-1 text-[#00D9FF]">
                  What happens next?
                </h4>
                <ul className="text-sm text-gray-400 space-y-1">
                  <li>• You&apos;ll be set as the organization owner</li>
                  <li>• You can invite team members to collaborate</li>
                  <li>• All projects can be shared with your organization</li>
                  <li>• You can manage roles and permissions for members</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={creating}
            className="border-gray-700"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black font-medium min-w-[150px]"
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

        {/* Preview */}
        {name && (
          <Card className="bg-[#1A1A1B]/30 border-gray-800/30 backdrop-blur-sm mt-8">
            <CardHeader>
              <CardTitle className="text-lg text-gray-400">Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="p-4 border border-gray-800/50 rounded-lg bg-[#0A0A0B]/50">
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-[#00D9FF] to-[#BD00FF] rounded-lg flex items-center justify-center text-xl font-bold">
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold mb-1">{name}</h3>
                    {description && (
                      <p className="text-gray-400 text-sm">{description}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-4 text-sm text-gray-500">
                  <div className="flex items-center gap-1">
                    <Building2 className="w-4 h-4" />
                    <span>0 projects</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span>1 member (you)</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
