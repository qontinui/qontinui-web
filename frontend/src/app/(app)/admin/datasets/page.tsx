"use client";

/**
 * Dataset List Page
 *
 * Shows all imported training datasets with options to:
 * - View dataset details and annotations
 * - Import new datasets from Training Data Exporter output
 * - Export datasets to various formats
 * - Delete datasets
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Upload, Eye, Trash2, Download, FolderOpen, Plus } from "lucide-react";
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
import { DatasetImportDialog } from "@/components/datasets/DatasetImportDialog";
import { DatasetExportDialog } from "@/components/datasets/DatasetExportDialog";
import type { Dataset } from "@/types/dataset";

export default function DatasetsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [exportDataset, setExportDataset] = useState<Dataset | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Auth protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
      return;
    }

    if (!authLoading && user && !user.is_superuser) {
      toast.error("Access denied - Admin privileges required");
      router.push("/build/workflows");
      return;
    }
  }, [user, authLoading, router]);

  const loadDatasets = useCallback(async () => {
    setLoading(true);
    try {
      const data = await datasetService.listDatasets();
      setDatasets(data);
    } catch (error) {
      console.error("Error loading datasets:", error);
      toast.error("Failed to load datasets");
    } finally {
      setLoading(false);
    }
  }, []);

  // Load datasets
  useEffect(() => {
    if (!authLoading && user?.is_superuser) {
      loadDatasets();
    }
  }, [authLoading, user, loadDatasets]);

  const handleDelete = async () => {
    if (!deleteConfirm) return;

    setDeleting(true);
    try {
      await datasetService.deleteDataset(deleteConfirm.id);
      setDatasets((prev) => prev.filter((d) => d.id !== deleteConfirm.id));
      toast.success(`Deleted "${deleteConfirm.name}"`);
    } catch (error) {
      console.error("Error deleting dataset:", error);
      toast.error("Failed to delete dataset");
    } finally {
      setDeleting(false);
      setDeleteConfirm(null);
    }
  };

  const handleImportComplete = () => {
    setShowImportDialog(false);
    loadDatasets();
  };

  const getReviewProgress = (dataset: Dataset) => {
    if (dataset.total_images === 0) return 0;
    return Math.round((dataset.reviewed_count / dataset.total_images) * 100);
  };

  const getSourceBadgeColor = (source: string) => {
    switch (source) {
      case "runner_export":
        return "bg-primary";
      case "manual_upload":
        return "bg-green-500";
      case "merged":
        return "bg-primary";
      default:
        return "bg-muted";
    }
  };

  // Don't render until auth is confirmed
  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return null;
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/admin/architecture")}
          >
            Admin
          </Button>
          <span className="text-muted-foreground">/</span>
          <h1 className="text-lg font-semibold">Training Datasets</h1>
        </div>
        <Button size="sm" onClick={() => setShowImportDialog(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import Dataset
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            Loading datasets...
          </div>
        ) : datasets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No datasets yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md text-sm">
              Import a dataset from the Training Data Exporter to get started.
              Datasets contain screenshots and annotations for training ML
              models.
            </p>
            <Button onClick={() => setShowImportDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Import Your First Dataset
            </Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2 font-medium">Dataset</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium text-right">Images</th>
                <th className="px-3 py-2 font-medium text-right">
                  Annotations
                </th>
                <th className="px-3 py-2 font-medium text-right">Reviewed</th>
                <th className="px-3 py-2 font-medium">Progress</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-6 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {datasets.map((dataset) => {
                const progress = getReviewProgress(dataset);
                return (
                  <tr
                    key={dataset.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/admin/datasets/${dataset.id}`)}
                  >
                    <td className="px-6 py-2.5">
                      <div>
                        <span className="font-medium">{dataset.name}</span>
                        <div className="text-xs text-muted-foreground truncate max-w-xs">
                          {dataset.description || "No description"}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge
                        className={`${getSourceBadgeColor(dataset.source)} text-xs`}
                        data-content-role="badge"
                        data-content-label="dataset-source"
                      >
                        {dataset.source.replace("_", " ")}
                      </Badge>
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums"
                      data-content-role="metric"
                      data-content-label="total-images"
                    >
                      {dataset.total_images}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums"
                      data-content-role="metric"
                      data-content-label="total-annotations"
                    >
                      {dataset.total_annotations}
                    </td>
                    <td
                      className="px-3 py-2.5 text-right tabular-nums"
                      data-content-role="metric"
                      data-content-label="reviewed-count"
                    >
                      {dataset.reviewed_count}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Progress value={progress} className="h-1.5 w-16" />
                        <span
                          className="text-xs tabular-nums text-muted-foreground"
                          data-content-role="metric"
                          data-content-label="review-progress"
                        >
                          {progress}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {new Date(dataset.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-2.5">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/admin/datasets/${dataset.id}`);
                          }}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExportDataset(dataset);
                          }}
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(dataset);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Import Dialog */}
        <DatasetImportDialog
          open={showImportDialog}
          onOpenChange={setShowImportDialog}
          onImportComplete={handleImportComplete}
        />

        {/* Export Dialog */}
        {exportDataset && (
          <DatasetExportDialog
            open={!!exportDataset}
            onOpenChange={(open) => !open && setExportDataset(null)}
            datasetId={exportDataset.id}
            datasetName={exportDataset.name}
          />
        )}

        {/* Delete Confirmation */}
        <AlertDialog
          open={!!deleteConfirm}
          onOpenChange={() => setDeleteConfirm(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete &quot;{deleteConfirm?.name}
                &quot;? This will permanently remove all{" "}
                {deleteConfirm?.total_images} images and{" "}
                {deleteConfirm?.total_annotations} annotations. This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDelete}
                disabled={deleting}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
