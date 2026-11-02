import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * The amber notice the Dev Ops ▸ CI setting panels use for a failed read or a
 * write that could not be confirmed — shared by `GithubHostedCiPanel` and
 * `CiModelAccessPanel` so the two cannot drift.
 */
export function Notice({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2"
      data-testid={testId}
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <p className="text-xs text-amber-800 dark:text-amber-200">{children}</p>
    </div>
  );
}
