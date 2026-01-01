"use client";

/**
 * AI Contexts Page
 *
 * Central repository for managing AI contexts used in automation workflows.
 * Contexts are markdown snippets that get injected into AI prompts based on
 * auto-include rules (task mentions, action types, error patterns, file patterns).
 *
 * Allows users to:
 * - Browse and organize project contexts
 * - Create new contexts with categories and tags
 * - Edit context content and auto-include rules
 * - Delete unused contexts
 * - Search and filter by name, category, or tags
 */

import { Suspense } from "react";
import { ContextsManager } from "@/components/contexts-manager";
import { RequireProject } from "@/components/require-project";
import { Loader2 } from "lucide-react";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
    </div>
  );
}

export default function ContextsPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="AI Contexts">
        <ContextsManager />
      </RequireProject>
    </Suspense>
  );
}
