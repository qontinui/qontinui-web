"use client";

export const dynamic = "force-dynamic";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { DeficiencyList } from "@/components/testing/DeficiencyList";
import { RequireProject } from "@/components/require-project";
import { ArrowLeft } from "lucide-react";

function QADeficienciesPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");
  const testRunId = searchParams.get("run");

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
    <RequireProject pageName="Deficiencies">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/qa-dashboard")}
              data-testid="qa-deficiencies-page-back-btn"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <h1 className="text-lg font-semibold text-foreground">
              Deficiency Management
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">
              Track and manage deficiencies found during testing across all
              projects
            </p>
          </div>

          <DeficiencyList
            projectId={projectId || undefined}
            testRunId={testRunId || undefined}
          />
        </main>
      </div>
    </RequireProject>
  );
}

export default function DeficienciesPage() {
  return (
    <Suspense fallback={null}>
      <QADeficienciesPageContent />
    </Suspense>
  );
}
