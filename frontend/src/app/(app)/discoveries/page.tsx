"use client";

import { useState } from "react";
import { useProjects } from "@/hooks/use-projects";
import { usePendingDiscoveriesCount } from "@/hooks/useDiscoveries";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DiscoveriesList } from "@/components/discoveries/DiscoveriesList";
import { Clock, Check, X, FolderOpen } from "lucide-react";
import type { DiscoveryStatus } from "@/types/discoveries";

export default function DiscoveriesPage() {
  const [activeTab, setActiveTab] = useState<DiscoveryStatus>("pending");
  const [selectedProject, setSelectedProject] = useState<string>("all");

  const { data: projects = [] } = useProjects();
  const { data: pendingCount } = usePendingDiscoveriesCount();

  const pendingCountValue = pendingCount?.count || 0;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-foreground">Discoveries</h1>
          {pendingCountValue > 0 && (
            <Badge variant="outline">{pendingCountValue} Pending</Badge>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground">
            Review and approve discoveries detected by your runners during
            automation execution
          </p>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderOpen size={14} />
            <span>Project:</span>
          </div>
          <Select value={selectedProject} onValueChange={setSelectedProject}>
            <SelectTrigger className="w-[250px]">
              <SelectValue placeholder="Select project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Projects</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as DiscoveryStatus)}
          className="space-y-6"
        >
          <TabsList>
            <TabsTrigger value="pending" className="gap-2">
              <Clock className="w-4 h-4" />
              Pending
              {pendingCountValue > 0 && (
                <Badge variant="outline" className="ml-1 text-xs">
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

          <TabsContent value="pending" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Pending Discoveries</h3>
                <p className="text-sm text-muted-foreground">
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

          <TabsContent value="accepted" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Accepted Discoveries</h3>
                <p className="text-sm text-muted-foreground">
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

          <TabsContent value="rejected" className="space-y-6">
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-semibold">Rejected Discoveries</h3>
                <p className="text-sm text-muted-foreground">
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
