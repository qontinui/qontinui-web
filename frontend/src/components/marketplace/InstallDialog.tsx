"use client";

import React, { useState } from "react";
import { Check, X, Package, ChevronRight, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { usePackageVersions } from "@/hooks/useCodePackages";
import { UNKNOWN_SCAN, scanDisplay } from "@/types/code-packages";
import type {
  CodePackage,
  PackageDependency,
  InstallStatus,
} from "@/types/code-packages";
import {
  SCAN_STATUS_BRIDGE_ID,
  SCAN_TONE_SURFACE,
  SCAN_TONE_TEXT,
  ScanIcon,
  ScanIssueList,
} from "./ScanStatus";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  package: CodePackage;
  projects: Array<{ id: string; name: string }>;
  selectedProjectId?: string;
  onInstall: (projectId: string, versionId?: string) => void;
  installStatus?: InstallStatus;
  installProgress?: number;
  error?: string;
}

export function InstallDialog({
  open,
  onOpenChange,
  package: pkg,
  projects,
  selectedProjectId: initialProjectId,
  onInstall,
  installStatus = "idle",
  installProgress = 0,
  error,
}: InstallDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialProjectId || projects[0]?.id || ""
  );
  // The served versions, newest first. The selection defaults to the newest
  // (`versions[0]`) until the user picks another.
  const versionsQuery = usePackageVersions(pkg.id, open);
  const versions = versionsQuery.data ?? [];
  const [pickedVersionId, setPickedVersionId] = useState<string | undefined>();
  const selectedVersion =
    versions.find((v) => v.id === pickedVersionId) ?? versions[0];
  const latestVersionId = versions[0]?.id;

  const versionsLoading = versionsQuery.isPending && open;
  const versionsFailed = versionsQuery.isError;
  const noPublishedVersion = versionsQuery.isSuccess && versions.length === 0;

  // A version whose scan cannot be read, and a version list that could not be
  // loaded, both render as `unknown` — never as a pass.
  const scan = scanDisplay(selectedVersion?.security_scan ?? UNKNOWN_SCAN);
  const showScan = !!selectedVersion || versionsFailed;
  const hasDependencies = (selectedVersion?.dependencies.length ?? 0) > 0;

  const handleInstall = () => {
    if (selectedProjectId && selectedVersion) {
      onInstall(selectedProjectId, selectedVersion.id);
    }
  };

  const getStatusMessage = () => {
    switch (installStatus) {
      case "installing":
        return "Installing package...";
      case "installed":
        return "Package installed successfully!";
      case "failed":
        return "Installation failed";
      case "updating":
        return "Updating package...";
      default:
        return "";
    }
  };

  const isInstalling =
    installStatus === "installing" || installStatus === "updating";
  const isComplete = installStatus === "installed";
  const isFailed = installStatus === "failed";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-brand-primary" />
            Install Package
          </DialogTitle>
          <DialogDescription>
            Configure installation settings for{" "}
            <span className="font-semibold">{pkg.name}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Project Selection */}
          <div className="space-y-2">
            <label
              htmlFor="project"
              className="text-sm font-medium text-text-secondary"
            >
              Install to Project
            </label>
            <Select
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
              disabled={isInstalling || isComplete}
            >
              <SelectTrigger
                id="project"
                className="bg-surface-canvas/50 border-border-default"
              >
                <SelectValue placeholder="Select a project..." />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Version Selection */}
          <div className="space-y-2">
            <label
              htmlFor="version"
              className="text-sm font-medium text-text-secondary"
            >
              Version
            </label>
            {versionsLoading && (
              <div className="text-sm text-text-muted">Loading versions...</div>
            )}
            {noPublishedVersion && (
              <div
                className="text-sm text-text-muted"
                data-ui-bridge-id="marketplace.no-published-version"
              >
                No published version
              </div>
            )}
            {selectedVersion && (
              <Select
                value={selectedVersion.id}
                onValueChange={setPickedVersionId}
                disabled={isInstalling || isComplete}
              >
                <SelectTrigger
                  id="version"
                  className="bg-surface-canvas/50 border-border-default"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {versions.map((version) => (
                    <SelectItem key={version.id} value={version.id}>
                      v{version.version}
                      {version.id === latestVersionId && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Latest
                        </Badge>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Dependencies */}
          {selectedVersion && hasDependencies && (
            <div className="space-y-2">
              <div className="text-sm font-medium text-text-secondary">
                Dependencies ({selectedVersion.dependencies.length})
              </div>
              <div className="p-3 bg-surface-canvas/30 rounded-lg border border-border-subtle space-y-2">
                {selectedVersion.dependencies.map((dep, index) => (
                  <DependencyItem key={index} dependency={dep} />
                ))}
              </div>
            </div>
          )}

          {/* Security Scan Results — the served status of the selected version */}
          {showScan && (
            <Alert
              variant={scan.tone === "danger" ? "destructive" : "default"}
              className={cn(
                scan.tone !== "danger" && SCAN_TONE_SURFACE[scan.tone]
              )}
              data-ui-bridge-id={SCAN_STATUS_BRIDGE_ID}
              data-scan-status={scan.status}
            >
              <AlertDescription className="flex items-start gap-2">
                <ScanIcon display={scan} className="mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div
                    className={cn(
                      "font-medium",
                      scan.tone !== "danger" && SCAN_TONE_TEXT[scan.tone]
                    )}
                  >
                    {scan.label}
                  </div>
                  {versionsFailed ? (
                    <div className="text-xs text-text-muted">
                      The package versions could not be loaded
                    </div>
                  ) : (
                    scan.detail && (
                      <div className="text-xs text-text-muted">
                        {scan.detail}
                      </div>
                    )
                  )}
                  {selectedVersion && (
                    <ScanIssueList
                      issues={selectedVersion.security_scan.issues}
                    />
                  )}
                  {scan.status === "unknown" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void versionsQuery.refetch()}
                      disabled={versionsQuery.isFetching}
                    >
                      <RefreshCw className="w-3 h-3 mr-2" />
                      Retry
                    </Button>
                  )}
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Installation Progress */}
          {isInstalling && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-text-muted">{getStatusMessage()}</span>
                <span className="text-text-muted">{installProgress}%</span>
              </div>
              <Progress value={installProgress} className="h-2" />
            </div>
          )}

          {/* Success Message */}
          {isComplete && (
            <Alert className="border-green-500/50 bg-green-950/20">
              <AlertDescription className="flex items-center gap-2">
                <Check className="w-4 h-4 text-green-500" />
                <span className="text-green-500 font-medium">
                  {getStatusMessage()}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Error Message */}
          {isFailed && error && (
            <Alert variant="destructive">
              <AlertDescription className="flex items-start gap-2">
                <X className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <div className="font-medium">{getStatusMessage()}</div>
                  <div className="text-xs">{error}</div>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isInstalling}
          >
            {isComplete ? "Close" : "Cancel"}
          </Button>
          {!isComplete && (
            <Button
              onClick={handleInstall}
              disabled={
                !selectedProjectId ||
                isInstalling ||
                !selectedVersion ||
                scan.blocksInstall
              }
              className="bg-gradient-to-r from-brand-primary to-brand-secondary"
            >
              {isInstalling ? (
                <>
                  <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Installing...
                </>
              ) : (
                "Install Package"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DependencyItem({ dependency }: { dependency: PackageDependency }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <ChevronRight className="w-3 h-3 text-text-muted" />
      <span className="text-text-secondary">{dependency.package_name}</span>
      <Badge variant="outline" className="text-xs">
        {dependency.version_constraint}
      </Badge>
      {dependency.optional && (
        <Badge variant="secondary" className="text-xs">
          Optional
        </Badge>
      )}
    </div>
  );
}
