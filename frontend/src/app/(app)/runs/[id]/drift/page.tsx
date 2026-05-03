"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const DriftListContent = dynamic(
  () =>
    import("@/components/testing/drift/DriftListContent").then((m) => ({
      default: m.DriftListContent,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mx-auto mb-3" />
          Loading drift report...
        </div>
      </div>
    ),
  },
);

export default function DriftListPage() {
  const params = useParams();
  const runId = params.id ? String(params.id) : null;

  if (!runId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        No run ID provided
      </div>
    );
  }

  return <DriftListContent runId={runId} />;
}
