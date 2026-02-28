"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { TestRunsList } from "@/components/testing/TestRunsList";
import { RequireProject } from "@/components/require-project";

export default function TestRunsPage() {
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
        <div className="text-lg text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Test Runs">
      <div
        className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden"
        data-ui-id="qa-runs-page"
      >
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <h1 className="text-lg font-semibold text-foreground">
            All Test Runs
          </h1>
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
