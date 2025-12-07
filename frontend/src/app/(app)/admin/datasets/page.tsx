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

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { datasetService } from "@/services/dataset-service";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LayoutDashboard,
  Shield,
  Database,
  Upload,
  Eye,
  Trash2,
  Download,
  FolderOpen,
  ImageIcon,
  Tag,
  CheckCircle2,
  Clock,
  Plus,
} from "lucide-react";
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
import type { Dataset } from "@/types/dataset";

export default function DatasetsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportDialog, setShowImportDialog] = useState(false);
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
      router.push("/dashboard");
      return;
    }
  }, [user, authLoading, router]);

  // Load datasets
  useEffect(() => {
    if (!authLoading && user?.is_superuser) {
      loadDatasets();
    }
  }, [authLoading, user]);

  const loadDatasets = async () => {
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
  };

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
        return "bg-blue-500";
      case "manual_upload":
        return "bg-green-500";
      case "merged":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  // Don't render until auth is confirmed
  if (authLoading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user?.is_superuser) {
    return (
      <div className="container mx-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Admin Access Required
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              This page is only accessible to administrators.
            </p>
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard")}
              className="mt-4"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      {/* Navigation Links */}
      <div className="mb-6 flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={() => router.push("/dashboard")}
          className="hover:bg-primary/10"
        >
          <LayoutDashboard className="mr-2 h-4 w-4" />
          Dashboard
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push("/admin")}
          className="hover:bg-secondary/10"
        >
          <Shield className="mr-2 h-4 w-4" />
          Admin
        </Button>
        <Button variant="ghost" className="bg-accent/20">
          <Database className="mr-2 h-4 w-4" />
          Datasets
        </Button>
      </div>

      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2">Training Datasets</h1>
          <p className="text-muted-foreground">
            Manage and curate training datasets for GUI element detection models
          </p>
        </div>
        <Button onClick={() => setShowImportDialog(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Import Dataset
        </Button>
      </div>

      {/* Dataset Grid */}
      {loading ? (
        <div className="flex items-center justify-center min-h-[300px]">
          <p className="text-muted-foreground">Loading datasets...</p>
        </div>
      ) : datasets.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FolderOpen className="h-16 w-16 text-muted-foreground mb-4" />
            <h3 className="text-xl font-semibold mb-2">No datasets yet</h3>
            <p className="text-muted-foreground text-center mb-6 max-w-md">
              Import a dataset from the Training Data Exporter to get started.
              Datasets contain screenshots and annotations for training ML
              models.
            </p>
            <Button onClick={() => setShowImportDialog(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Import Your First Dataset
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {datasets.map((dataset) => {
            const progress = getReviewProgress(dataset);
            return (
              <Card
                key={dataset.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => router.push(`/admin/datasets/${dataset.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="truncate">{dataset.name}</CardTitle>
                      <CardDescription className="truncate mt-1">
                        {dataset.description || "No description"}
                      </CardDescription>
                    </div>
                    <Badge className={getSourceBadgeColor(dataset.source)}>
                      {dataset.source.replace("_", " ")}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {/* Statistics */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <ImageIcon className="h-4 w-4" />
                      </div>
                      <div className="text-2xl font-bold">
                        {dataset.total_images}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Images
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <Tag className="h-4 w-4" />
                      </div>
                      <div className="text-2xl font-bold">
                        {dataset.total_annotations}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Annotations
                      </div>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                        <CheckCircle2 className="h-4 w-4" />
                      </div>
                      <div className="text-2xl font-bold">
                        {dataset.reviewed_count}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Reviewed
                      </div>
                    </div>
                  </div>

                  {/* Review Progress */}
                  <div className="space-y-2 mb-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Review Progress
                      </span>
                      <span className="font-medium">{progress}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {/* Metadata */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>
                      Created{" "}
                      {new Date(dataset.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/admin/datasets/${dataset.id}`);
                      }}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        // TODO: Open export dialog
                        toast.info("Export coming soon");
                      }}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteConfirm(dataset);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <DatasetImportDialog
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onImportComplete={handleImportComplete}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deleteConfirm}
        onOpenChange={() => setDeleteConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Dataset</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This will
              permanently remove all {deleteConfirm?.total_images} images and{" "}
              {deleteConfirm?.total_annotations} annotations. This action cannot
              be undone.
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
  );
}
