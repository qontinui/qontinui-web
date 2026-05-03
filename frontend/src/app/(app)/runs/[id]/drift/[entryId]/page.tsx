"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";

const DriftEntryDetail = dynamic(
  () =>
    import("@/components/testing/drift/DriftEntryDetail").then((m) => ({
      default: m.DriftEntryDetail,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin mx-auto mb-3" />
          Loading drift entry...
        </div>
      </div>
    ),
  },
);

export default function DriftEntryPage() {
  const params = useParams();
  const runId = params.id ? String(params.id) : null;
  const entryId = params.entryId ? String(params.entryId) : null;

  if (!runId || !entryId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Invalid drift entry route
      </div>
    );
  }

  return <DriftEntryDetail runId={runId} entryId={entryId} />;
}
