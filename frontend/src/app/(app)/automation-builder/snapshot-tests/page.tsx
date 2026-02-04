"use client";

import { Suspense } from "react";
import { RequireProject } from "@/components/require-project";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { SnapshotTestGenerator } from "@/components/test-generators/SnapshotTestGenerator";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-neutral-500 text-sm">Loading...</div>
    </div>
  );
}

function SnapshotTestsContent() {
  const { isLoading } = useProjectLoader();

  if (isLoading) return <LoadingFallback />;

  return <SnapshotTestGenerator />;
}

export default function SnapshotTestsPage() {
  return (
    <RequireProject pageName="Snapshot Test Generator">
      <Suspense fallback={<LoadingFallback />}>
        <SnapshotTestsContent />
      </Suspense>
    </RequireProject>
  );
}
