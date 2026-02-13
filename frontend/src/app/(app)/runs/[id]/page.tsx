"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const RunDetailContent = dynamic(
  () =>
    import("@/components/run-detail/RunDetailContent").then((m) => ({
      default: m.RunDetailContent,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <div className="text-center text-text-muted">
          <Loader2 className="size-6 animate-spin mx-auto mb-3" />
          Loading run details...
        </div>
      </div>
    ),
  }
);

export default function RunDetailPage() {
  const params = useParams();
  const runId = params.id ? String(params.id) : null;

  if (!runId) {
    return (
      <div className="min-h-screen flex items-center justify-center text-text-muted">
        No run ID provided
      </div>
    );
  }

  return <RunDetailContent runId={runId} />;
}
