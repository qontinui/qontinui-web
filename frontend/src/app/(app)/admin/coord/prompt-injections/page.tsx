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
 *
 * ## Console style (Phase 3 Wave 5)
 *
 * This route landed after the console plan was authored and was missing from
 * its census (§4 correction), which classed it **R9 + R3 only** — no list of
 * its own, and the dashboard's table already satisfies D2/R5.
 *
 * R9 here is the page body (`p-3 sm:p-6 space-y-4`, was a flat `p-6`) and the
 * two-line sub-header, which becomes one line: the console shell
 * (`coord/layout.tsx`) already renders the title bar, so a stacked
 * heading-plus-paragraph was a second title plus a caption above a table.
 * The caption survives as inline muted text on the same line, because it says
 * something the heading does not — that both the TRIGGER and the INJECTED
 * PROMPT are here, which is the reason to open the page.
 *
 * R3 is a no-op on this surface, deliberately: the palette encodes who must
 * act, and a read-only audit log of injections that already happened asks
 * nothing of anybody. There is no kind→attention table here because there is
 * no severity to audit — which is a decision, not an omission.
 */

import { ScrollText } from "lucide-react";
import PromptInjectionsDashboard from "@/components/admin/prompt-injections/PromptInjectionsDashboard";

export default function CoordPromptInjectionsPage() {
  return (
    <div
      className="p-3 sm:p-6 space-y-4"
      data-testid="coord-prompt-injections-page"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <ScrollText
          className="h-4 w-4 shrink-0 self-center text-muted-foreground"
          aria-hidden
        />
        <h2 className="text-sm font-semibold">Coord Prompt Injections</h2>
        <p className="text-xs text-muted-foreground">
          Every coord-originated prompt injection — the triggering output and
          the exact prompt injected, per session.
        </p>
      </div>

      <PromptInjectionsDashboard />
    </div>
  );
}
