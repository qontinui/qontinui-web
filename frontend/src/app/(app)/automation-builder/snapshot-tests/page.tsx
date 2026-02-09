"use client";

import { Suspense } from "react";
import { SnapshotTestGenerator } from "@/components/test-generators/SnapshotTestGenerator";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-neutral-500 text-sm">Loading...</div>
    </div>
  );
}

export default function SnapshotTestsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <SnapshotTestGenerator />
    </Suspense>
  );
}
