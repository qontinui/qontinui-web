"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useExtractions, useDeleteExtraction } from "@/hooks/use-extractions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Globe,
  Clock,
  Trash2,
  ExternalLink,
  FileSearch,
  AlertCircle,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { DeleteConfirmationDialog } from "@/components/delete-confirmation-dialog";
import { useState } from "react";
import type { ExtractionSession } from "@/services/extraction-service";

export default function ExtractionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const { data: extractions = [], isLoading } = useExtractions(projectId || "");
  const deleteExtraction = useDeleteExtraction();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [extractionToDelete, setExtractionToDelete] =
    useState<ExtractionSession | null>(null);

  const getStatusColor = (status: ExtractionSession["status"]) => {
    switch (status) {
      case "completed":
        return "bg-brand-success/20 text-brand-success border-brand-success/30";
      case "running":
        return "bg-brand-primary/20 text-brand-primary border-brand-primary/30";
      case "pending":
        return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
      case "failed":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      default:
        return "bg-surface-raised/20 text-text-muted border-border-subtle/30";
    }
  };

  const getRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInHours = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60 * 60)
    );

    if (diffInHours < 1) return "Just now";
    if (diffInHours < 24) return `${diffInHours} hours ago`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return "1 day ago";
    return `${diffInDays} days ago`;
  };

  const formatUrls = (urls: string[]) => {
    if (urls.length === 0) return "No URLs";
    if (urls.length === 1) return urls[0];
    if (urls.length <= 3) return urls.join(", ");
    return `${urls.slice(0, 2).join(", ")} and ${urls.length - 2} more`;
  };

  const handleDeleteExtraction = (extraction: ExtractionSession) => {
    setExtractionToDelete(extraction);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!extractionToDelete || !projectId) return;

    try {
      await deleteExtraction.mutateAsync({
        extractionId: extractionToDelete.id,
        projectId,
      });
      toast.success("Extraction deleted successfully");
      setDeleteDialogOpen(false);
      setExtractionToDelete(null);
    } catch (error) {
      console.error("Failed to delete extraction:", error);
      toast.error("Failed to delete extraction");
    }
  };

  const handleViewExtraction = (extractionId: string) => {
    router.push(`/extractions/${extractionId}?project=${projectId}`);
  };

  if (!projectId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        <main className="p-6 max-w-7xl mx-auto">
          <Card className="bg-surface-raised/50 border-yellow-500/30 backdrop-blur-sm">
            <CardContent className="p-6 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-yellow-500" />
              <p className="text-text-secondary">
                Please select a project from the sidebar to view extractions.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        <main className="p-6 max-w-7xl mx-auto">
          <div className="text-center py-8 text-text-muted">
            Loading extractions...
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <main className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-3xl font-bold">Web Extractions</h1>
            <Link
              href={`/automation-builder/web-extraction?project=${projectId}`}
            >
              <Button className="bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30 hover:border-brand-primary/50">
                <Plus className="w-4 h-4 mr-2" />
                New Extraction
              </Button>
            </Link>
          </div>
          <p className="text-text-muted">
            View and manage UI extractions from web pages
          </p>
        </div>

        {/* Info Box */}
        <Card className="bg-surface-raised/50 border-brand-primary/30 backdrop-blur-sm mb-6">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-brand-primary flex-shrink-0 mt-0.5" />
            <div className="text-sm text-text-secondary">
              <p className="font-medium mb-1">
                Create extractions from the Web Extraction page or Runner
              </p>
              <p className="text-text-muted">
                Use the{" "}
                <Link
                  href={`/automation-builder/web-extraction?project=${projectId}`}
                  className="text-brand-primary hover:underline"
                >
                  Web Extraction page
                </Link>{" "}
                to configure and start extractions, or use the Qontinui Runner
                desktop application to browse websites and extract UI elements.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Extractions List */}
        {extractions.length === 0 ? (
          <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed backdrop-blur-sm">
            <CardContent className="p-12 text-center">
              <div className="w-16 h-16 bg-brand-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <FileSearch className="w-8 h-8 text-brand-primary" />
              </div>
              <h4 className="text-xl font-semibold mb-2 text-text-secondary">
                No extractions yet
              </h4>
              <p className="text-text-muted mb-6">
                Start a new extraction to discover UI elements and states from
                web pages
              </p>
              <Link
                href={`/automation-builder/web-extraction?project=${projectId}`}
              >
                <Button className="bg-brand-primary hover:bg-brand-primary/90 text-black">
                  <Plus className="w-4 h-4 mr-2" />
                  Start New Extraction
                </Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {extractions.map((extraction) => (
              <Card
                key={extraction.id}
                className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm hover:border-brand-primary/30 hover:shadow-[0_0_20px_rgba(0,217,255,0.05)] transition-all duration-300"
              >
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    {/* Main Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-3">
                        <Globe className="w-5 h-5 text-brand-primary flex-shrink-0" />
                        <h3 className="font-semibold text-lg truncate">
                          {formatUrls(extraction.source_urls)}
                        </h3>
                        <Badge className={getStatusColor(extraction.status)}>
                          {extraction.status}
                        </Badge>
                      </div>

                      {/* Stats */}
                      <div className="flex items-center gap-6 mb-3 text-sm">
                        {extraction.stats?.pages_extracted !== undefined && (
                          <div className="text-text-muted">
                            <span className="font-medium text-white">
                              {extraction.stats.pages_extracted}
                            </span>{" "}
                            pages
                          </div>
                        )}
                        {extraction.stats?.elements_found !== undefined && (
                          <div className="text-text-muted">
                            <span className="font-medium text-white">
                              {extraction.stats.elements_found}
                            </span>{" "}
                            elements
                          </div>
                        )}
                        {extraction.stats?.states_found !== undefined && (
                          <div className="text-text-muted">
                            <span className="font-medium text-white">
                              {extraction.stats.states_found}
                            </span>{" "}
                            states
                          </div>
                        )}
                      </div>

                      {/* Metadata */}
                      <div className="flex items-center gap-4 text-xs text-text-muted">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          <span>
                            Created {getRelativeTime(extraction.created_at)}
                          </span>
                        </div>
                        {extraction.completed_at && (
                          <div>
                            Completed {getRelativeTime(extraction.completed_at)}
                          </div>
                        )}
                      </div>

                      {/* Error Message */}
                      {extraction.error_message && (
                        <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded text-sm text-red-400">
                          {extraction.error_message}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleViewExtraction(extraction.id)}
                        className="bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/30 hover:border-brand-primary/50"
                      >
                        <ExternalLink className="w-4 h-4 mr-1" />
                        View
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDeleteExtraction(extraction)}
                        className="border-border-default hover:border-red-500 hover:text-red-400 bg-transparent"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmationDialog
        open={deleteDialogOpen}
        title="Delete Extraction"
        itemName={
          extractionToDelete
            ? formatUrls(extractionToDelete.source_urls) || ""
            : ""
        }
        description={`Are you sure you want to delete this extraction? This will permanently delete all extracted data and annotations. This action cannot be undone.`}
        onClose={() => {
          setDeleteDialogOpen(false);
          setExtractionToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
