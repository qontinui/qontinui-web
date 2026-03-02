"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PackageRatings } from "@/components/marketplace/PackageRatings";
import { InstallDialog } from "@/components/marketplace/InstallDialog";
import {
  usePackageDetails,
  usePackageRatings,
  useRatePackage,
} from "@/hooks/useCodePackages";
import { useProjects } from "@/hooks/use-projects";
import { usePackageInstall } from "./_hooks/usePackageInstall";
import { PackageLoadingState } from "./_components/PackageLoadingState";
import { PackageNotFound } from "./_components/PackageNotFound";
import { PackageHeader } from "./_components/PackageHeader";
import { PackageDescription } from "./_components/PackageDescription";
import { PackageContentTabs } from "./_components/PackageContentTabs";
import { PackageSidebar } from "./_components/PackageSidebar";

export default function PackageDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;

  const [selectedTab, setSelectedTab] = useState<
    "readme" | "code" | "versions" | "dependencies"
  >("readme");

  const { data: pkg, isLoading } = usePackageDetails(slug);
  const { data: ratings } = usePackageRatings(pkg?.id || "", !!pkg?.id);
  const { data: projects } = useProjects();
  const ratePackageMutation = useRatePackage();

  const {
    installDialogOpen,
    setInstallDialogOpen,
    installStatus,
    installProgress,
    handleInstallClick,
    handleInstall,
  } = usePackageInstall(pkg?.id);

  const handleBack = () => {
    router.push("/marketplace");
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
    return <PackageLoadingState />;
  }

  if (!pkg) {
    return <PackageNotFound onBack={handleBack} />;
  }

  const hasSecurityIssues =
    pkg.latest_version.security_scan.scanned &&
    !pkg.latest_version.security_scan.passed;

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <PackageHeader
        pkg={pkg}
        hasSecurityIssues={hasSecurityIssues}
        onBack={handleBack}
        onInstallClick={handleInstallClick}
      />

      <div className="flex-1 overflow-y-auto p-6">
        <PackageDescription pkg={pkg} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <PackageContentTabs
              pkg={pkg}
              selectedTab={selectedTab}
              onTabChange={setSelectedTab}
            />

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

          <PackageSidebar pkg={pkg} />
        </div>
      </div>

      <InstallDialog
        open={installDialogOpen}
        onOpenChange={setInstallDialogOpen}
        package={pkg}
        projects={projects?.map((p) => ({ id: p.id, name: p.name })) || []}
        onInstall={handleInstall}
        installStatus={installStatus}
        installProgress={installProgress}
      />
    </div>
  );
}
