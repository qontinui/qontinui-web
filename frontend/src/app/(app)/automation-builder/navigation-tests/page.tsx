"use client";

import { Suspense } from "react";
import { NavigationTestGenerator } from "@/components/test-generators/NavigationTestGenerator";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-neutral-500 text-sm">Loading...</div>
    </div>
  );
}

export default function NavigationTestsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <NavigationTestGenerator />
    </Suspense>
  );
}
