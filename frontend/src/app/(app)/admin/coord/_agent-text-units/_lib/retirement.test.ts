/**
 * `/settings/agent-commands` is retired — asserted, not asserted-in-prose.
 *
 * Plan `2026-08-20-fleet-served-agent-skills.md` Phase 3 is explicit that the
 * old account-only editor goes in the SAME change that adds the console pages:
 * two editors over one corpus is how the two diverge, and the settings page
 * could not express the fleet-default layer at all.
 *
 * A `redirects()` entry in `next.config.mjs` is a claim. These three
 * assertions are the evidence: the redirect resolves at the shape Next.js will
 * consume, nothing is left mounted at the old path for it to be shadowed by
 * (`redirects()` is matched before the filesystem, so a surviving `page.tsx`
 * would be dead code rather than a live second editor — but a dead second copy
 * of the editor is exactly what "they diverge" starts from), and the settings
 * nav no longer offers it.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FRONTEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../.."
);

describe("/settings/agent-commands retirement", () => {
  it("308-redirects the old route to the console page", async () => {
    const config = (await import("../../../../../../../next.config.mjs")).default;
    const redirects = await config.redirects();
    const entry = redirects.find(
      (r: { source: string }) => r.source === "/settings/agent-commands"
    );
    expect(entry, "no redirect declared for /settings/agent-commands").toBeDefined();
    expect(entry.destination).toBe("/admin/coord/agent-commands");
    // `permanent: true` is a 308 — the old path is gone for good, not moved
    // for a release.
    expect(entry.permanent).toBe(true);
    // Host-scoped or method-scoped conditions would silently narrow it.
    expect(entry.has).toBeUndefined();
  });

  it("leaves nothing mounted at the old route", () => {
    expect(
      existsSync(path.join(FRONTEND_ROOT, "src/app/(app)/settings/agent-commands"))
    ).toBe(false);
  });

  it("drops the old settings nav entry", () => {
    const layout = readFileSync(
      path.join(FRONTEND_ROOT, "src/app/(app)/settings/layout.tsx"),
      "utf8"
    );
    expect(layout).not.toContain('route: "/settings/agent-commands"');
    expect(layout).not.toContain('id: "settings-agent-commands"');
  });
});
