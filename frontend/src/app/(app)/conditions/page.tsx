"use client";

/**
 * /conditions — regression tests as condition groups.
 *
 * Any authenticated user manages "condition groups": each group is a
 * regression test made of natural-language conditions ("no duplicate menu
 * items") run against a target URL, on demand or on a schedule. Conditions can
 * be added, edited, reordered, moved between groups, and their pass/fail run
 * history reviewed. Data is served by the backend proxy at
 * `/api/v1/conditions/*`.
 *
 * A regular `(app)` page (not an admin/coord surface): it talks only to the
 * always-registered `httpClient`, so it mounts for any tenant member.
 */

import { ListChecks } from "lucide-react";
import { GroupList } from "./_components/GroupList";
import { useActiveProjectName } from "./_hooks/useActiveProjectName";

export default function ConditionsPage() {
  // Groups belong to ONE project (the sidebar selection), so the page says
  // which. No name is shown while it is unknown — never a raw id.
  const projectName = useActiveProjectName();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 p-6">
        <div className="flex items-start gap-3">
          <ListChecks className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h1 className="text-lg font-semibold">Regression Tests</h1>
              {projectName && (
                <span
                  className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
                  data-testid="conditions-project"
                  title="Regression tests belong to the project selected in the sidebar"
                >
                  Project: {projectName}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Accumulate natural-language checks into condition groups. Each
              group is a regression test you can run on demand or on a schedule
              against a target URL — building up a suite of “what must always be
              true” for your app.
            </p>
          </div>
        </div>

        <GroupList />
      </div>
    </div>
  );
}
