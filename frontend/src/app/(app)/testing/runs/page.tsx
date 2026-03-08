"use client";

export const dynamic = "force-dynamic";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { TestRunsList } from "@/components/testing/TestRunsList";
import { RequireProject } from "@/components/require-project";
import { ArrowLeft } from "lucide-react";

function TestRunsPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  if (authLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div
          data-content-role="status"
          data-content-label="loading state"
          className="text-lg text-muted-foreground"
        >
          Loading...
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Test Runs">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/testing")}
              data-testid="testing-page-runs-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <h1 className="text-lg font-semibold text-foreground">
              All Test Runs
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">
              View all historical test runs for this project
            </p>
          </div>

          <TestRunsList projectId={projectId || undefined} />
        </main>
      </div>
    </RequireProject>
  );
}

export default function TestRunsPage() {
  return (
    <Suspense fallback={null}>
      <TestRunsPageContent />
    </Suspense>
  );
}
