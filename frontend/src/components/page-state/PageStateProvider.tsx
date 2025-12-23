/**
 * PageStateProvider
 *
 * Provides page state hydration for child components.
 * Shows a loading skeleton while hydrating from IndexedDB.
 */

"use client";

import React from "react";
import { useImageExtractionPageState } from "@/stores/page-state";
import { Loader2 } from "lucide-react";

interface PageStateProviderProps {
  pageId: "image-extraction" | "pattern-tests" | "pattern-optimization";
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Default loading skeleton
 */
function DefaultSkeleton() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading page state...</p>
      </div>
    </div>
  );
}

/**
 * Image Extraction specific provider
 */
function ImageExtractionProvider({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isHydrating, isHydrated, hydrationError } =
    useImageExtractionPageState();

  if (isHydrating && !isHydrated) {
    return <>{fallback || <DefaultSkeleton />}</>;
  }

  if (hydrationError) {
    console.warn("Page state hydration error:", hydrationError);
    // Continue with default state on error
  }

  return <>{children}</>;
}

/**
 * Main PageStateProvider component
 *
 * Usage:
 * ```tsx
 * <PageStateProvider pageId="image-extraction">
 *   <ImageExtractionTab />
 * </PageStateProvider>
 * ```
 */
export function PageStateProvider({
  pageId,
  children,
  fallback,
}: PageStateProviderProps) {
  switch (pageId) {
    case "image-extraction":
      return (
        <ImageExtractionProvider fallback={fallback}>
          {children}
        </ImageExtractionProvider>
      );

    case "pattern-tests":
      // TODO: Implement pattern tests provider
      return <>{children}</>;

    case "pattern-optimization":
      // TODO: Implement pattern optimization provider
      return <>{children}</>;

    default:
      return <>{children}</>;
  }
}

/**
 * HOC for wrapping page components with state provider
 */
export function withPageState<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  pageId: PageStateProviderProps["pageId"]
) {
  return function WithPageStateComponent(props: P) {
    return (
      <PageStateProvider pageId={pageId}>
        <WrappedComponent {...props} />
      </PageStateProvider>
    );
  };
}
