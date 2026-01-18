/**
 * Model Manager Component
 *
 * UI for managing ML models used by the runner:
 * - View available models and their download status
 * - Download models on demand
 * - Delete downloaded models
 * - View disk usage
 * - Show download progress
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  runnerClient,
  type ModelInfo,
  type ModelDiskUsageResponse,
} from "@/lib/runner-client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  Trash2,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface DownloadProgress {
  modelId: string;
  progress: number;
  status: "downloading" | "completed" | "failed";
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function ModelManager() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [diskUsage, setDiskUsage] = useState<ModelDiskUsageResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<
    Record<string, DownloadProgress>
  >({});

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [modelsResponse, usageResponse] = await Promise.all([
        runnerClient.listModels(),
        runnerClient.getModelsDiskUsage(),
      ]);

      if (!modelsResponse.success) {
        throw new Error(modelsResponse.error || "Failed to load models");
      }

      setModels(modelsResponse.models);
      setDiskUsage(usageResponse.success ? usageResponse : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadModels();
  }, [loadModels]);

  const handleDownload = async (modelId: string) => {
    setDownloadProgress((prev) => ({
      ...prev,
      [modelId]: { modelId, progress: 0, status: "downloading" },
    }));

    try {
      // Start download - progress is simulated since the API is synchronous
      // In a real implementation, you'd poll for progress or use SSE/WebSocket
      const progressInterval = setInterval(() => {
        setDownloadProgress((prev) => {
          const current = prev[modelId];
          if (!current || current.status !== "downloading") {
            clearInterval(progressInterval);
            return prev;
          }
          const newProgress = Math.min(current.progress + 5, 95);
          return {
            ...prev,
            [modelId]: { ...current, progress: newProgress },
          };
        });
      }, 500);

      const result = await runnerClient.downloadModel(modelId);

      clearInterval(progressInterval);

      if (result.success) {
        setDownloadProgress((prev) => ({
          ...prev,
          [modelId]: { modelId, progress: 100, status: "completed" },
        }));
        // Refresh models list
        await loadModels();
        // Clear progress after a delay
        setTimeout(() => {
          setDownloadProgress((prev) => {
            const next = { ...prev };
            delete next[modelId];
            return next;
          });
        }, 3000);
      } else {
        setDownloadProgress((prev) => ({
          ...prev,
          [modelId]: {
            modelId,
            progress: 0,
            status: "failed",
            error: result.error,
          },
        }));
      }
    } catch (err) {
      setDownloadProgress((prev) => ({
        ...prev,
        [modelId]: {
          modelId,
          progress: 0,
          status: "failed",
          error: err instanceof Error ? err.message : "Download failed",
        },
      }));
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      const result = await runnerClient.deleteModel(modelId);
      if (result.success) {
        await loadModels();
      } else {
        setError(result.error || "Failed to delete model");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete model");
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-muted-foreground">{error}</p>
            <Button onClick={loadModels} variant="outline">
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Disk Usage Summary */}
      {diskUsage && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-lg">Disk Usage</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={loadModels}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold">
                {formatBytes(diskUsage.total_bytes)}
              </span>
              <span className="text-sm text-muted-foreground">used</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground truncate">
              {diskUsage.models_dir}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Models List */}
      <Card>
        <CardHeader>
          <CardTitle>ML Models</CardTitle>
          <CardDescription>
            Models are downloaded on demand when needed for vision extraction,
            segmentation, and OCR.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {models.map((model) => {
              const progress = downloadProgress[model.id];
              const isDownloading = progress?.status === "downloading";
              const downloadFailed = progress?.status === "failed";

              return (
                <div
                  key={model.id}
                  className="flex items-center gap-4 rounded-lg border p-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{model.name}</span>
                      <Badge variant={model.available ? "default" : "secondary"}>
                        {model.available ? "Downloaded" : "Not Downloaded"}
                      </Badge>
                      <Badge variant="outline">{formatBytes(model.size_bytes)}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {model.description}
                    </p>

                    {/* Download Progress */}
                    {isDownloading && (
                      <div className="mt-2">
                        <Progress value={progress.progress} className="h-2" />
                        <p className="text-xs text-muted-foreground mt-1">
                          Downloading... {progress.progress}%
                        </p>
                      </div>
                    )}

                    {/* Download Error */}
                    {downloadFailed && (
                      <p className="text-sm text-destructive mt-2">
                        {progress.error || "Download failed"}
                      </p>
                    )}

                    {/* Download Success */}
                    {progress?.status === "completed" && (
                      <p className="text-sm text-green-600 mt-2 flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" />
                        Download completed
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {model.available ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="icon">
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Model?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    This will delete {model.name} (
                                    {formatBytes(model.size_bytes)}) from disk. You
                                    can re-download it later if needed.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(model.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TooltipTrigger>
                          <TooltipContent>Delete model</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleDownload(model.id)}
                              disabled={isDownloading}
                            >
                              {isDownloading ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Download model</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </div>
              );
            })}

            {models.length === 0 && (
              <p className="text-center text-muted-foreground py-8">
                No models available. Make sure the runner is connected.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
