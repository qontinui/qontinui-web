"use client";

import { Suspense } from "react";
import { RequireProject } from "@/components/require-project";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { NavigationTestGenerator } from "@/components/test-generators/NavigationTestGenerator";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-neutral-500 text-sm">Loading...</div>
    </div>
  );
}

function NavigationTestsContent() {
  const { isLoading } = useProjectLoader();

  if (isLoading) return <LoadingFallback />;

  return <NavigationTestGenerator />;
}

export default function NavigationTestsPage() {
  return (
    <RequireProject pageName="Navigation Test Generator">
      <Suspense fallback={<LoadingFallback />}>
        <NavigationTestsContent />
      </Suspense>
    </RequireProject>
  );
}
