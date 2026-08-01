"use client";

/**
 * /admin/coord/prompt-injections — Coord Prompt Injections audit log.
 *
 * Phase 4 of the "Unified Coord Prompt-Injection Audit Log" plan.
 *
 * A read-only table of every coord-originated prompt injection with the
 * session name per row and an expandable detail view showing the output
 * that triggered the injection and the exact prompt that was injected.
 *
 * Lives inside the coord operator console (`CoordLayout`), which already
 * enforces the auth gate and renders the console header + CoordNav. This
 * page renders a sub-header + the dashboard within the layout's `<main>`.
 *
 * Data: web backend `GET /api/v1/admin/prompt-injections[/{id}]` → coord
 * `GET /coord/prompt-injections[/{id}]`. The frontend never talks to coord
 * directly.
 */

import { ScrollText } from "lucide-react";
import PromptInjectionsDashboard from "@/components/admin/prompt-injections/PromptInjectionsDashboard";

export default function CoordPromptInjectionsPage() {
  return (
    <div className="p-6 space-y-4" data-testid="coord-prompt-injections-page">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-lg font-semibold">Coord Prompt Injections</h2>
          <p className="text-xs text-muted-foreground">
            Every coord-originated prompt injection — the triggering output and
            the exact prompt injected, per session.
          </p>
        </div>
      </div>

      <PromptInjectionsDashboard />
    </div>
  );
}
