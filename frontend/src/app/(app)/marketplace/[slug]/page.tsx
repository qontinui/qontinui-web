"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Download,
  Star,
  Calendar,
  Shield,
  ExternalLink,
  Flag,
  GitBranch,
  Package,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Code,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { PackageCodePreview } from "@/components/marketplace/PackageCodePreview";
import { PackageRatings } from "@/components/marketplace/PackageRatings";
import { InstallDialog } from "@/components/marketplace/InstallDialog";
import {
  usePackageDetails,
  usePackageRatings,
  useInstallPackage,
  useRatePackage,
} from "@/hooks/useCodePackages";
import { useProjects } from "@/hooks/use-projects";
import {
  formatDownloads,
  formatRating,
  getCategoryLabel,
  type InstallStatus,
} from "@/types/code-packages";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";

export default function PackageDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");
  const [selectedTab, setSelectedTab] = useState<
    "readme" | "code" | "versions" | "dependencies"
  >("readme");

  // Queries
  const { data: pkg, isLoading } = usePackageDetails(slug);
  const { data: ratings } = usePackageRatings(pkg?.id || "", !!pkg?.id);
  const { data: projects } = useProjects();

  // Mutations
  const installPackageMutation = useInstallPackage();
  const ratePackageMutation = useRatePackage();

  const handleBack = () => {
    router.push("/marketplace");
  };

  const handleInstallClick = () => {
    setInstallDialogOpen(true);
    setInstallStatus("idle");
  };

  const handleInstall = async (projectId: string, versionId?: string) => {
    if (!pkg) return;

    setInstallStatus("installing");

    try {
      await installPackageMutation.mutateAsync({
        package_id: pkg.id,
        version_id: versionId,
        project_id: projectId,
      });
      setInstallStatus("installed");
      setTimeout(() => {
        setInstallDialogOpen(false);
        setInstallStatus("idle");
      }, 2000);
    } catch (error) {
      console.error("[PackageDetailsPage] Failed to install package:", error);
      setInstallStatus("failed");
    }
  };

  const handleSubmitRating = async (rating: number, review?: string) => {
    if (!pkg) return;

    try {
      await ratePackageMutation.mutateAsync({
        package_id: pkg.id,
        rating,
        review,
      });
    } catch (error) {
      console.error("[PackageDetailsPage] Failed to submit rating:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading package details...</p>
        </div>
      </div>
    );
  }

  if (!pkg) {
    return (
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden items-center justify-center">
        <div className="text-center">
          <Package className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Package not found
          </h2>
          <p className="text-muted-foreground mb-6">
            The package you&apos;re looking for doesn&apos;t exist.
          </p>
          <Button onClick={handleBack} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Marketplace
          </Button>
        </div>
      </div>
    );
  }

  const hasSecurityIssues =
    pkg.latest_version.security_scan.scanned &&
    !pkg.latest_version.security_scan.passed;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <h1 className="text-lg font-semibold text-foreground">{pkg.name}</h1>
          {pkg.verified && (
            <div title="Verified by staff">
              <Shield className="w-4 h-4 text-primary flex-shrink-0" />
            </div>
          )}
          {pkg.featured && (
            <Badge className="bg-primary text-primary-foreground">
              Featured
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {pkg.deprecated && (
            <Alert variant="destructive" className="py-1 px-3">
              <AlertDescription className="text-sm">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Deprecated
                {pkg.deprecated_reason && `: ${pkg.deprecated_reason}`}
              </AlertDescription>
            </Alert>
          )}
          {hasSecurityIssues && (
            <Alert variant="destructive" className="py-1 px-3">
              <AlertDescription className="text-sm">
                <AlertTriangle className="w-3 h-3 inline mr-1" />
                Security issues detected
              </AlertDescription>
            </Alert>
          )}
          <Button
            onClick={handleInstallClick}
            disabled={pkg.deprecated || hasSecurityIssues}
            className="bg-primary"
          >
            <Download className="w-4 h-4 mr-2" />
            Install Package
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mb-6">
          <p className="text-sm text-muted-foreground mb-3">
            {pkg.description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{getCategoryLabel(pkg.category)}</Badge>
            {pkg.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            <span className="text-sm text-muted-foreground ml-2">
              by{" "}
              <span className="font-medium text-foreground">
                {pkg.author.username}
              </span>
              {pkg.author.verified && (
                <Shield className="w-3 h-3 text-primary inline ml-1" />
              )}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <Tabs
              value={selectedTab}
              onValueChange={(v) => setSelectedTab(v as typeof selectedTab)}
            >
              <TabsList className="bg-muted w-full">
                <TabsTrigger value="readme" className="flex-1">
                  <FileText className="w-4 h-4 mr-2" />
                  README
                </TabsTrigger>
                <TabsTrigger value="code" className="flex-1">
                  <Code className="w-4 h-4 mr-2" />
                  Code
                </TabsTrigger>
                <TabsTrigger value="versions" className="flex-1">
                  <GitBranch className="w-4 h-4 mr-2" />
                  Versions
                </TabsTrigger>
                <TabsTrigger value="dependencies" className="flex-1">
                  <Package className="w-4 h-4 mr-2" />
                  Dependencies
                </TabsTrigger>
              </TabsList>

              <TabsContent value="readme" className="mt-6">
                <Card className="bg-muted/50 border-border">
                  <CardContent className="p-6">
                    {pkg.latest_version.readme ? (
                      <div className="prose prose-invert prose-cyan max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {pkg.latest_version.readme}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <div className="text-center py-12 text-muted-foreground">
                        No README provided for this package.
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="code" className="mt-6">
                <PackageCodePreview
                  code={pkg.latest_version.code}
                  language="python"
                  fileName={`${pkg.slug}.py`}
                  maxHeight="600px"
                />
              </TabsContent>

              <TabsContent value="versions" className="mt-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Version History</CardTitle>
                    <CardDescription>
                      All published versions of this package
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {pkg.versions.map((version) => (
                        <div
                          key={version.id}
                          className="flex items-start justify-between p-4 bg-muted rounded-lg border border-border"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-foreground">
                                v{version.version}
                              </span>
                              {version.id === pkg.latest_version.id && (
                                <Badge variant="secondary">Latest</Badge>
                              )}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              Released{" "}
                              {formatDistanceToNow(
                                new Date(version.created_at),
                                { addSuffix: true }
                              )}
                            </div>
                            {version.changelog && (
                              <p className="text-sm text-muted-foreground mt-2">
                                {version.changelog}
                              </p>
                            )}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {formatDownloads(version.downloads)} downloads
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="dependencies" className="mt-6">
                <Card className="bg-muted/50 border-border">
                  <CardHeader>
                    <CardTitle>Dependencies</CardTitle>
                    <CardDescription>
                      Packages required by v{pkg.latest_version.version}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {pkg.latest_version.dependencies.length > 0 ? (
                      <div className="space-y-2">
                        {pkg.latest_version.dependencies.map((dep, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 bg-muted rounded-lg border border-border"
                          >
                            <div className="flex items-center gap-2">
                              <Package className="w-4 h-4 text-muted-foreground" />
                              <span className="font-medium text-foreground">
                                {dep.package_name}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {dep.version_constraint}
                              </Badge>
                              {dep.optional && (
                                <Badge variant="secondary" className="text-xs">
                                  Optional
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-muted-foreground">
                        No dependencies required
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Ratings & Reviews */}
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle>Ratings & Reviews</CardTitle>
              </CardHeader>
              <CardContent>
                <PackageRatings
                  packageId={pkg.id}
                  ratings={ratings || []}
                  averageRating={pkg.average_rating}
                  totalRatings={pkg.rating_count}
                  onSubmitRating={handleSubmitRating}
                  isSubmitting={ratePackageMutation.isPending}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Stats */}
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-base">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Download className="w-4 h-4" />
                    <span className="text-sm">Downloads</span>
                  </div>
                  <span className="font-semibold text-foreground">
                    {formatDownloads(pkg.total_downloads)}
                  </span>
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Star className="w-4 h-4" />
                    <span className="text-sm">Rating</span>
                  </div>
                  <span className="font-semibold text-foreground">
                    {formatRating(pkg.average_rating)} ({pkg.rating_count})
                  </span>
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GitBranch className="w-4 h-4" />
                    <span className="text-sm">Version</span>
                  </div>
                  <span className="font-mono text-sm font-semibold text-foreground">
                    v{pkg.latest_version.version}
                  </span>
                </div>
                <Separator className="bg-border" />
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    <span className="text-sm">Updated</span>
                  </div>
                  <span className="text-sm text-foreground">
                    {formatDistanceToNow(new Date(pkg.updated_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* License */}
            <Card className="bg-muted/50 border-border">
              <CardHeader>
                <CardTitle className="text-base">License</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline" className="text-sm">
                  {pkg.license}
                </Badge>
              </CardContent>
            </Card>

            {/* Links */}
            {(pkg.repository_url ||
              pkg.homepage_url ||
              pkg.documentation_url) && (
              <Card className="bg-muted/50 border-border">
                <CardHeader>
                  <CardTitle className="text-base">Links</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {pkg.repository_url && (
                    <a
                      href={pkg.repository_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Repository
                    </a>
                  )}
                  {pkg.homepage_url && (
                    <a
                      href={pkg.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Homepage
                    </a>
                  )}
                  {pkg.documentation_url && (
                    <a
                      href={pkg.documentation_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 text-sm text-primary hover:text-primary/80"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Documentation
                    </a>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Security Scan */}
            {pkg.latest_version.security_scan.scanned && (
              <Card
                className={cn(
                  "border-border",
                  pkg.latest_version.security_scan.passed
                    ? "bg-green-500/10 border-green-500/50"
                    : "bg-red-950/20 border-red-500/50"
                )}
              >
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    {pkg.latest_version.security_scan.passed ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Security Scan Passed
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-red-500" />
                        Security Issues Found
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                {!pkg.latest_version.security_scan.passed &&
                  pkg.latest_version.security_scan.issues && (
                    <CardContent className="space-y-2">
                      {pkg.latest_version.security_scan.issues.map(
                        (issue, index) => (
                          <div key={index} className="text-sm">
                            <Badge variant="destructive" className="mr-2">
                              {issue.severity}
                            </Badge>
                            <span className="text-muted-foreground">
                              {issue.description}
                            </span>
                          </div>
                        )
                      )}
                    </CardContent>
                  )}
              </Card>
            )}

            {/* Report Button */}
            <Button variant="outline" className="w-full" size="sm">
              <Flag className="w-4 h-4 mr-2" />
              Report Package
            </Button>
          </div>
        </div>
      </div>

      {/* Install Dialog */}
      <InstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        package={pkg}
        projects={projects?.map((p) => ({ id: p.id, name: p.name })) || []}
        onInstall={handleInstall}
        installStatus={installStatus}
        installProgress={
          installStatus === "installing"
            ? 50
            : installStatus === "installed"
              ? 100
              : 0
        }
      />
    </div>
  );
}
