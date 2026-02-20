"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useProjects } from "@/hooks/use-projects";
import { usePendingDiscoveriesCount } from "@/hooks/useDiscoveries";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiscoveriesList } from "@/components/discoveries/DiscoveriesList";
import {
  ArrowLeft,
  Loader2,
  Sparkles,
  Clock,
  Check,
  X,
  FolderOpen,
} from "lucide-react";
import type { DiscoveryStatus } from "@/types/discoveries";

export default function DiscoveriesPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<DiscoveryStatus>("pending");
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const { data: projects = [] } = useProjects();
  const { data: pendingCount } = usePendingDiscoveriesCount();

  const handleBackToDashboard = () => {
    router.push("/build/workflows");
  };

  // Show loading while auth is checking
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2" />
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  // Don't render anything if no user (will redirect)
  if (!user) {
    router.push("/");
    return null;
  }

  const pendingCountValue = pendingCount?.count || 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBackToDashboard}
              className="text-text-muted hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Dashboard
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <Sparkles className="w-6 h-6 text-[#4ECDC4]" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#4ECDC4] to-brand-primary bg-clip-text text-transparent">
              Discoveries
            </h1>
            {pendingCountValue > 0 && (
              <Badge
                variant="outline"
                className="border-[#4ECDC4]/50 text-[#4ECDC4]"
              >
                {pendingCountValue} Pending
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-7xl mx-auto">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2">Review Discoveries</h2>
          <p className="text-text-muted">
            Review and approve discoveries detected by your runners during
            automation execution
          </p>
        </div>

        {/* Project Filter */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <FolderOpen size={14} />
            <span>Project:</span>
          </div>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[250px] bg-surface-canvas/50 border-border-default text-white">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent className="bg-surface-raised border-border-default">
              <SelectItem
                value="all"
                className="text-white hover:bg-surface-raised"
              >
                All Projects
              </SelectItem>
              {projects.map((project) => (
                <SelectItem
                  key={project.id}
                  value={project.id}
                  className="text-white hover:bg-surface-raised"
                >
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as DiscoveryStatus)}
          className="space-y-6"
        >
          <TabsList className="bg-surface-raised border border-border-subtle">
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="w-4 h-4" />
              Pending
              {pendingCountValue > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1 border-[#4ECDC4]/50 text-[#4ECDC4] text-xs"
                >
                  {pendingCountValue}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="accepted" className="gap-2">
              <Check className="w-4 h-4" />
              Accepted
            </TabsTrigger>
            <TabsTrigger value="rejected" className="gap-2">
              <X className="w-4 h-4" />
              Rejected
            </TabsTrigger>
          </TabsList>

          {/* Tab: Pending */}
          <TabsContent value="pending" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Pending Discoveries</h3>
                <p className="text-sm text-text-muted">
                  Review these discoveries and decide whether to accept or
                  reject them
                </p>
              </div>
            </div>
            <DiscoveriesList
              status="pending"
              projectId={
                selectedProject === "all" ? undefined : selectedProject
              }
            />
          </TabsContent>

          {/* Tab: Accepted */}
          <TabsContent value="accepted" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Accepted Discoveries</h3>
                <p className="text-sm text-text-muted">
                  Discoveries that have been reviewed and accepted
                </p>
              </div>
            </div>
            <DiscoveriesList
              status="accepted"
              projectId={
                selectedProject === "all" ? undefined : selectedProject
              }
            />
          </TabsContent>

          {/* Tab: Rejected */}
          <TabsContent value="rejected" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Rejected Discoveries</h3>
                <p className="text-sm text-text-muted">
                  Discoveries that have been reviewed and rejected
                </p>
              </div>
            </div>
            <DiscoveriesList
              status="rejected"
              projectId={
                selectedProject === "all" ? undefined : selectedProject
              }
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
