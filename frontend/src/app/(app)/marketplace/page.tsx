"use client";

import React, { useState, useCallback } from "react";
import { TrendingUp, Package, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { PackageCard } from "@/components/marketplace/PackageCard";
import { PackageSearchBar } from "@/components/marketplace/PackageSearchBar";
import { InstallDialog } from "@/components/marketplace/InstallDialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  usePackages,
  usePopularPackages,
  useInstalledPackages,
  useInstallPackage,
} from "@/hooks/useCodePackages";
import { useProjects } from "@/hooks/use-projects";
import type {
  SearchFilters,
  CodePackage,
  InstallStatus,
} from "@/types/code-packages";
import { RequireProject } from "@/components/require-project";

export default function MarketplacePage() {
  const router = useRouter();
  const [searchFilters, setSearchFilters] = useState<SearchFilters>({
    sort_by: "popular",
    page: 1,
    limit: 20,
  });
  const [selectedTab, setSelectedTab] = useState<
    "all" | "popular" | "installed"
  >("all");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [selectedPackage, setSelectedPackage] = useState<CodePackage | null>(
    null
  );
  const [installStatus, setInstallStatus] = useState<InstallStatus>("idle");

  // Queries
  const { data: searchResult, isLoading: isLoadingSearch } =
    usePackages(searchFilters);
  const { data: popularPackages, isLoading: isLoadingPopular } =
    usePopularPackages();
  const { data: projects } = useProjects();
  const { data: installedPackages } = useInstalledPackages(
    projects?.[0]?.id || "",
    !!projects?.[0]?.id
  );

  // Mutations
  const installPackageMutation = useInstallPackage();

  const handleSearch = useCallback((filters: SearchFilters) => {
    setSearchFilters((prev) => ({
      ...prev,
      ...filters,
      page: 1, // Reset to first page on new search
    }));
  }, []);

  const handleInstallClick = (pkg: CodePackage) => {
    setSelectedPackage(pkg);
    setInstallDialogOpen(true);
    setInstallStatus("idle");
  };

  const handleInstall = async (projectId: string, versionId?: string) => {
    if (!selectedPackage) return;

    setInstallStatus("installing");

    try {
      await installPackageMutation.mutateAsync({
        package_id: selectedPackage.id,
        version_id: versionId,
        project_id: projectId,
      });
      setInstallStatus("installed");
      setTimeout(() => {
        setInstallDialogOpen(false);
        setInstallStatus("idle");
      }, 2000);
    } catch (error) {
      console.error("[MarketplacePage] Failed to install package:", error);
      setInstallStatus("failed");
    }
  };

  const handleViewDetails = (pkg: CodePackage) => {
    router.push(`/marketplace/${pkg.slug}`);
  };

  const handlePublishClick = () => {
    router.push("/marketplace/publish");
  };

  const isPackageInstalled = (packageId: string) => {
    return (
      installedPackages?.some((install) => install.package_id === packageId) ||
      false
    );
  };

  const displayedPackages =
    selectedTab === "popular"
      ? popularPackages || []
      : selectedTab === "installed"
        ? installedPackages?.map((install) => install.package) || []
        : searchResult?.packages || [];

  const isLoading =
    selectedTab === "popular" ? isLoadingPopular : isLoadingSearch;

  return (
    <RequireProject pageName="Marketplace">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-foreground">
              Marketplace
            </h1>
            <span className="text-sm text-muted-foreground">
              Discover and share automation packages
            </span>
          </div>
          <Button onClick={handlePublishClick} className="bg-primary">
            <Package className="w-4 h-4 mr-2" />
            Publish Package
          </Button>
        </div>

        <div className="px-6 py-3 border-b border-border shrink-0">
          <PackageSearchBar
            onSearch={handleSearch}
            initialFilters={searchFilters}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <Tabs
            value={selectedTab}
            onValueChange={(v) => setSelectedTab(v as typeof selectedTab)}
          >
            <div className="flex items-center justify-between mb-6">
              <TabsList className="bg-muted">
                <TabsTrigger value="all" className="gap-2">
                  <Package className="w-4 h-4" />
                  All Packages
                  {searchResult && (
                    <Badge variant="secondary" className="ml-1">
                      {searchResult.total}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="popular" className="gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Popular
                  {popularPackages && (
                    <Badge variant="secondary" className="ml-1">
                      {popularPackages.length}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger value="installed" className="gap-2">
                  <Sparkles className="w-4 h-4" />
                  Installed
                  {installedPackages && (
                    <Badge variant="secondary" className="ml-1">
                      {installedPackages.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="all" className="mt-0">
              <PackageGrid
                packages={displayedPackages}
                isLoading={isLoading}
                onInstall={handleInstallClick}
                onViewDetails={handleViewDetails}
                isPackageInstalled={isPackageInstalled}
              />
            </TabsContent>

            <TabsContent value="popular" className="mt-0">
              <PackageGrid
                packages={displayedPackages}
                isLoading={isLoading}
                onInstall={handleInstallClick}
                onViewDetails={handleViewDetails}
                isPackageInstalled={isPackageInstalled}
              />
            </TabsContent>

            <TabsContent value="installed" className="mt-0">
              <PackageGrid
                packages={displayedPackages}
                isLoading={isLoading}
                onInstall={handleInstallClick}
                onViewDetails={handleViewDetails}
                isPackageInstalled={isPackageInstalled}
              />
            </TabsContent>
          </Tabs>

          {selectedTab === "all" &&
            searchResult &&
            searchResult.total_pages > 1 && (
              <div className="flex items-center justify-center gap-2 mt-8">
                <Button
                  variant="outline"
                  onClick={() =>
                    setSearchFilters((prev) => ({
                      ...prev,
                      page: (prev.page || 1) - 1,
                    }))
                  }
                  disabled={searchResult.page <= 1}
                >
                  Previous
                </Button>
                <div className="text-sm text-muted-foreground">
                  Page {searchResult.page} of {searchResult.total_pages}
                </div>
                <Button
                  variant="outline"
                  onClick={() =>
                    setSearchFilters((prev) => ({
                      ...prev,
                      page: (prev.page || 1) + 1,
                    }))
                  }
                  disabled={searchResult.page >= searchResult.total_pages}
                >
                  Next
                </Button>
              </div>
            )}
        </div>

        {selectedPackage && (
          <InstallDialog
            open={installDialogOpen}
            onOpenChange={setInstallDialogOpen}
            package={selectedPackage}
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
        )}
      </div>
    </RequireProject>
  );
}

interface PackageGridProps {
  packages: CodePackage[];
  isLoading: boolean;
  onInstall: (pkg: CodePackage) => void;
  onViewDetails: (pkg: CodePackage) => void;
  isPackageInstalled: (packageId: string) => boolean;
}

function PackageGrid({
  packages,
  isLoading,
  onInstall,
  onViewDetails,
  isPackageInstalled,
}: PackageGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {[...Array(6)].map((_, i) => (
          <div
            key={i}
            className="h-64 bg-muted/50 rounded-lg border border-border animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (packages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Package className="w-16 h-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold text-muted-foreground mb-2">
          No packages found
        </h3>
        <p className="text-muted-foreground">
          Try adjusting your search filters or check back later for new
          packages.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {packages.map((pkg) => (
        <PackageCard
          key={pkg.id}
          package={pkg}
          onInstall={onInstall}
          onViewDetails={onViewDetails}
          isInstalled={isPackageInstalled(pkg.id)}
        />
      ))}
    </div>
  );
}
