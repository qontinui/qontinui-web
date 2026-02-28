/**
 * USAGE EXAMPLE - Deficiency Management Dashboard
 *
 * This example shows how to integrate all deficiency components
 * into a complete deficiency management dashboard.
 *
 * NOT FOR PRODUCTION - This is a reference implementation
 */

"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Filter as FilterIcon } from "lucide-react";
import {
  DeficiencyDetails,
  DeficiencyFilters,
  DeficiencyExport,
} from "@/components/testing/deficiencies";
import {
  Deficiency,
  DeficiencyComment,
  DeficiencyActivity,
  DeficiencyFilters as Filters,
  DeficiencyStatus,
  DeficiencyExportOptions,
  SEVERITY_CONFIG,
  STATUS_CONFIG,
} from "@/types/deficiency";
import { User } from "@/types/auth-types";

export function DeficiencyDashboard() {
  const queryClient = useQueryClient();

  // State
  const [selectedDeficiency, setSelectedDeficiency] =
    useState<Deficiency | null>(null);
  const [filters, setFilters] = useState<Filters>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Fetch deficiencies from API
  const { data: deficiencies = [], isLoading: loading } = useQuery({
    queryKey: ["deficiencies", filters],
    queryFn: async () => {
      const queryParams = new URLSearchParams();
      if (filters.search) queryParams.append("search", filters.search);
      if (filters.severity)
        queryParams.append("severity", filters.severity.join(","));
      if (filters.status)
        queryParams.append("status", filters.status.join(","));
      if (filters.assigned_to)
        queryParams.append("assigned_to", filters.assigned_to.join(","));
      if (filters.date_from) queryParams.append("date_from", filters.date_from);
      if (filters.date_to) queryParams.append("date_to", filters.date_to);

      const response = await fetch(`/api/deficiencies?${queryParams}`);
      return (await response.json()) as Deficiency[];
    },
    staleTime: 30000,
  });

  // Fetch users for assignment
  const { data: users = [] } = useQuery({
    queryKey: ["deficiency-users"],
    queryFn: async () => {
      const response = await fetch("/api/users");
      return (await response.json()) as User[];
    },
    staleTime: 60000,
  });

  // Derive tags from deficiencies
  const tags = Array.from(new Set(deficiencies.flatMap((d) => d.tags))).sort();

  // Fetch comments and activities when deficiency is selected
  const { data: deficiencyDetails } = useQuery({
    queryKey: ["deficiency-details", selectedDeficiency?.id],
    queryFn: async () => {
      const [commentsRes, activitiesRes] = await Promise.all([
        fetch(`/api/deficiencies/${selectedDeficiency!.id}/comments`),
        fetch(`/api/deficiencies/${selectedDeficiency!.id}/activities`),
      ]);

      const commentsData = (await commentsRes.json()) as DeficiencyComment[];
      const activitiesData =
        (await activitiesRes.json()) as DeficiencyActivity[];

      return { comments: commentsData, activities: activitiesData };
    },
    enabled: !!selectedDeficiency,
    staleTime: 10000,
  });

  const comments = deficiencyDetails?.comments ?? [];
  const activities = deficiencyDetails?.activities ?? [];

  // Handlers
  const handleStatusChange = async (newStatus: DeficiencyStatus) => {
    if (!selectedDeficiency) return;

    try {
      const response = await fetch(
        `/api/deficiencies/${selectedDeficiency.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        }
      );

      if (response.ok) {
        const updated = await response.json();
        setSelectedDeficiency(updated);
        queryClient.invalidateQueries({ queryKey: ["deficiencies"] });
      }
    } catch (error) {
      console.error("Failed to update status:", error);
      throw error;
    }
  };

  const handleAssignmentChange = async (userId: string | null) => {
    if (!selectedDeficiency) return;

    try {
      const response = await fetch(
        `/api/deficiencies/${selectedDeficiency.id}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        }
      );

      if (response.ok) {
        const updated = await response.json();
        setSelectedDeficiency(updated);
        queryClient.invalidateQueries({ queryKey: ["deficiencies"] });
      }
    } catch (error) {
      console.error("Failed to assign deficiency:", error);
      throw error;
    }
  };

  const handleCommentAdd = async (
    content: string,
    mentions: string[],
    attachments: File[]
  ) => {
    if (!selectedDeficiency) return;

    try {
      const formData = new FormData();
      formData.append("content", content);
      formData.append("mentions", JSON.stringify(mentions));
      attachments.forEach((file) => formData.append("attachments", file));

      const response = await fetch(
        `/api/deficiencies/${selectedDeficiency.id}/comments`,
        {
          method: "POST",
          body: formData,
        }
      );

      if (response.ok) {
        queryClient.invalidateQueries({
          queryKey: ["deficiency-details", selectedDeficiency.id],
        });
      }
    } catch (error) {
      console.error("Failed to add comment:", error);
      throw error;
    }
  };

  const handleExport = async (options: DeficiencyExportOptions) => {
    try {
      const response = await fetch("/api/deficiencies/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...options,
          filters,
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `deficiencies-${Date.now()}.${options.format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error("Failed to export:", error);
      throw error;
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Deficiency Management</h1>
          <p className="text-muted-foreground">
            Track and manage bugs discovered during testing
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setFiltersOpen(!filtersOpen)}
          >
            <FilterIcon className="h-4 w-4 mr-2" />
            Filters
          </Button>
          <Button onClick={() => setExportOpen(true)}>Export</Button>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            New Deficiency
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Sidebar: Filters */}
        {filtersOpen && (
          <aside className="w-80">
            <DeficiencyFilters
              filters={filters}
              onFiltersChange={setFilters}
              availableUsers={users.map((u) => ({
                id: u.id,
                name: u.full_name || u.username,
              }))}
              availableTags={tags}
            />
          </aside>
        )}

        {/* Main: Deficiency List */}
        <main className="flex-1">
          {loading ? (
            <div className="text-center py-12">Loading...</div>
          ) : deficiencies.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No deficiencies found</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {deficiencies.map((deficiency) => {
                const severityConfig = SEVERITY_CONFIG[deficiency.severity];
                const statusConfig = STATUS_CONFIG[deficiency.status];

                return (
                  <Card
                    key={deficiency.id}
                    className="cursor-pointer hover:border-primary transition-colors"
                    onClick={() => setSelectedDeficiency(deficiency)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <CardTitle className="text-lg">
                          {deficiency.title}
                        </CardTitle>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <Badge className={severityConfig.bgColor}>
                            {severityConfig.label}
                          </Badge>
                          <Badge className={statusConfig.bgColor}>
                            {statusConfig.label}
                          </Badge>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2">
                        {deficiency.description}
                      </p>
                      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                        <span>ID: {deficiency.id.slice(0, 8)}</span>
                        <span>
                          Created:{" "}
                          {new Date(deficiency.created_at).toLocaleDateString()}
                        </span>
                        {deficiency.assigned_to_user_id && (
                          <span>Assigned</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </main>
      </div>

      {/* Details Modal */}
      {selectedDeficiency && (
        <DeficiencyDetails
          deficiency={selectedDeficiency}
          comments={comments}
          activities={activities}
          open={!!selectedDeficiency}
          onOpenChange={(open) => !open && setSelectedDeficiency(null)}
          onStatusChange={(newStatus) =>
            handleStatusChange(newStatus as DeficiencyStatus)
          }
          onAssignmentChange={handleAssignmentChange}
          onCommentAdd={handleCommentAdd}
          onExport={() => setExportOpen(true)}
        />
      )}

      {/* Export Dialog */}
      <DeficiencyExport
        open={exportOpen}
        onOpenChange={setExportOpen}
        onExport={handleExport}
      />
    </div>
  );
}
