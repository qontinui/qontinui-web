/**
 * `/sessions/*` route shape — trap 8 of
 * `2026-08-26-sessions-console-consolidation.md`.
 *
 * Phase 2 adds a DYNAMIC sibling, `/sessions/[key]`, to a namespace that
 * already holds a shipped STATIC one: `/sessions/repository` and
 * `/sessions/repository/[id]`, the permanent transcript corpus. Next.js App
 * Router resolves a static segment ahead of a dynamic sibling, so the
 * filesystem side is safe — and this file is what keeps it that way, because
 * three separate things could break it and none of them would fail a build:
 *
 * 1. **A redirect.** `next.config.mjs:221` records in terms that `redirects()`
 *    is matched BEFORE the filesystem, and a previous `/admin` entry shadowed a
 *    real page exactly this way. No source may match `/sessions/repository*`.
 * 2. **A second dynamic slug.** Next refuses two different slug names at one
 *    position (`[id]` beside `[key]`), which is why Phase 2 RENAMED the route
 *    rather than adding one.
 * 3. **The resolver itself**, if someone hands it the literal string.
 *
 * The page render at the end is the end-to-end form of #1 and #2: the module
 * at `/sessions/repository` still mounts after `[key]` landed.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import fs from "node:fs";
import path from "node:path";

import { isReservedSessionSegment } from "@/components/sessions/sessionKeyResolution";

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: { id: "u1" }, loading: false }),
}));

// The list fetches on mount; this file is about ROUTING, not the corpus.
vi.mock("@/components/session-repository", () => ({
  SessionRepositoryList: () => <div data-testid="stub-repository-list" />,
}));

import SessionRepositoryPage from "./repository/page";

const SESSIONS_DIR = path.resolve(__dirname);
const NEXT_CONFIG = path.resolve(__dirname, "../../../../next.config.mjs");

describe("the filesystem shape", () => {
  it("keeps the static repository routes beside the new dynamic sibling", () => {
    expect(fs.existsSync(path.join(SESSIONS_DIR, "repository/page.tsx"))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(SESSIONS_DIR, "repository/[id]/page.tsx"))
    ).toBe(true);
    expect(fs.existsSync(path.join(SESSIONS_DIR, "[key]/page.tsx"))).toBe(true);
  });

  it("has exactly ONE dynamic segment under /sessions", () => {
    // Next.js refuses two different slug names at one dynamic position
    // ("You cannot use different slug names for the same dynamic path"), which
    // is why Phase 2 renamed `[id]` to `[key]` instead of adding a sibling.
    const dynamic = fs
      .readdirSync(SESSIONS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith("["))
      .map((e) => e.name);
    expect(dynamic).toEqual(["[key]"]);
  });
});

describe("no redirect may shadow the static segment", () => {
  it("declares no redirect that would swallow /sessions/repository", () => {
    const config = fs.readFileSync(NEXT_CONFIG, "utf8");
    const offenders = redirectEntries(config).filter(
      (entry) =>
        matchesSessionsRepository(entry.source) && !preservesPath(entry)
    );
    expect(offenders).toEqual([]);
  });

  it("the scanner actually finds the redirects it is scanning", () => {
    // A test that reads a config with a broken regex passes for the wrong
    // reason. Pin the known entry so an emptied scan fails loudly.
    const entries = redirectEntries(
      fs.readFileSync(NEXT_CONFIG, "utf8")
    ).map((e) => e.source);
    expect(entries).toContain("/admin/coord/fleet");
  });

  it("would CATCH a redirect that shadowed the page", () => {
    // The failure this file exists to prevent, exercised against the matcher
    // rather than against the shipped config — otherwise the assertion above
    // is untested and would keep passing if the matcher stopped matching.
    expect(matchesSessionsRepository("/sessions/:key")).toBe(true);
    expect(matchesSessionsRepository("/sessions/:path*")).toBe(true);
    expect(matchesSessionsRepository("/sessions/repository")).toBe(true);
    expect(matchesSessionsRepository("/environments/sessions/:key")).toBe(
      false
    );
    expect(matchesSessionsRepository("/admin/agent-sessions")).toBe(false);
  });
});

describe("Phase 3's four 308s — the redirect TABLE, not just its safety", () => {
  /**
   * This is a shape assertion over the loaded config, not a browser check.
   * Plan §8 wants each 308 followed once with params; a headless box cannot
   * discharge that, and this is the honest substitute — it proves the entries
   * exist, are permanent, and map the params the plan's table names. It does
   * NOT prove Next serves them.
   */
  async function loadRedirects(): Promise<RedirectRule[]> {
    const mod = await import(/* @vite-ignore */ NEXT_CONFIG);
    const config = (mod as { default: NextLikeConfig }).default;
    return (await config.redirects()) as RedirectRule[];
  }

  function find(rules: RedirectRule[], source: string, hasLive = false) {
    return rules.find(
      (r) =>
        r.source === source &&
        Boolean(r.has?.some((h) => h.type === "query" && h.key === "live")) ===
          hasLive
    );
  }

  it("308s the two retired list routes onto /sessions", async () => {
    const rules = await loadRedirects();

    const admin = find(rules, "/admin/agent-sessions");
    expect(admin).toBeDefined();
    expect(admin!.destination).toBe("/sessions");
    expect(admin!.permanent).toBe(true);

    // `?device=` is NOT rewritten: Next passes unmatched query through, which
    // is exactly what `environments/machines/page.tsx` deep link needs.
    const envs = find(rules, "/environments/sessions");
    expect(envs).toBeDefined();
    expect(envs!.destination).toBe("/sessions");
    expect(envs!.permanent).toBe(true);
  });

  it("maps ?live=true onto the console's ?status=live tab", async () => {
    const rules = await loadRedirects();
    const live = find(rules, "/admin/agent-sessions", true);
    expect(live).toBeDefined();
    expect(live!.destination).toBe("/sessions?status=live");
    expect(live!.permanent).toBe(true);
    expect(live!.has).toEqual([{ type: "query", key: "live", value: "true" }]);

    // Ordering is load-bearing: the unconditional entry must come AFTER the
    // conditional one, or `?live=true` would match the catch-all first and
    // land on an unfiltered list.
    const conditional = rules.findIndex(
      (r) =>
        r.source === "/admin/agent-sessions" &&
        Boolean(r.has?.some((h) => h.key === "live"))
    );
    const catchAll = rules.findIndex(
      (r) => r.source === "/admin/agent-sessions" && r.has == null
    );
    expect(conditional).toBeGreaterThanOrEqual(0);
    expect(catchAll).toBeGreaterThan(conditional);
  });

  it("308s both detail routes onto /sessions/[key], closing the shipped 404", async () => {
    const rules = await loadRedirects();

    // §2.3.1: /admin/coord/agents/[agent_id] linked here and the route never
    // existed. Every click was a 404 for as long as the button shipped.
    const adminDetail = find(rules, "/admin/agent-sessions/:id");
    expect(adminDetail).toBeDefined();
    expect(adminDetail!.destination).toBe("/sessions/:id");
    expect(adminDetail!.permanent).toBe(true);

    const twinDetail = find(rules, "/environments/sessions/:key");
    expect(twinDetail).toBeDefined();
    expect(twinDetail!.destination).toBe("/sessions/:key");
    expect(twinDetail!.permanent).toBe(true);
  });

  it("routes every Phase 3 source AWAY from the repository corpus", async () => {
    const rules = await loadRedirects();
    const phase3 = rules.filter(
      (r) =>
        r.source.startsWith("/admin/agent-sessions") ||
        r.source.startsWith("/environments/sessions")
    );
    expect(phase3).toHaveLength(5); // 4 table rows + the ?live= arm
    for (const rule of phase3) {
      expect(matchesSessionsRepository(rule.source)).toBe(false);
    }
  });
});

describe("the resolver never treats the literal segment as a session key", () => {
  it("refuses 'repository'", () => {
    expect(isReservedSessionSegment("repository")).toBe(true);
  });
});

describe("/sessions/repository still resolves after [key] landed", () => {
  it("renders the repository page", () => {
    render(<SessionRepositoryPage />);
    expect(screen.getByText("Session Repository")).toBeInTheDocument();
    expect(screen.getByTestId("stub-repository-list")).toBeInTheDocument();
  });
});

interface RedirectEntry {
  source: string;
  destination: string;
}

/** One entry as `redirects()` actually returns it. */
interface RedirectRule {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: Array<{ type: string; key?: string; value?: string }>;
}

interface NextLikeConfig {
  redirects: () => Promise<unknown>;
}

/**
 * The `source` / `destination` pairs declared inside `redirects()` — and ONLY
 * those. `headers()` and `rewrites()` in the same file also carry a `source`,
 * and neither shadows the filesystem, so scanning the whole file would report
 * them as route hazards they are not.
 */
function redirectEntries(config: string): RedirectEntry[] {
  const start = config.indexOf("async redirects()");
  if (start < 0) return [];
  const end = config.indexOf("async headers()", start);
  const body = config.slice(start, end < 0 ? undefined : end);
  const entries: RedirectEntry[] = [];
  const re = /source:\s*'([^']+)'[\s\S]*?destination:\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    entries.push({ source: match[1], destination: match[2] });
  }
  return entries;
}

/**
 * Does this redirect land the request back on the same path?
 *
 * The host-canonicalisation entry (`/:path*` → `https://qontinui.io/:path*`,
 * scoped by a `has: host`) matches every route in the app and shadows none of
 * them: it moves the ORIGIN and keeps the path. A path-preserving redirect is
 * not a route hazard; one that rewrites the path is.
 */
function preservesPath(entry: RedirectEntry): boolean {
  const spread = entry.source.match(/:[A-Za-z0-9_]+\*/)?.[0];
  return spread != null && entry.destination.includes(spread);
}

/**
 * Would this `redirects()` source capture `/sessions/repository`?
 *
 * Next's matcher is path-to-regexp: `:param` matches one segment, `:param*`
 * and `:path*` match the rest. This translation is deliberately GENEROUS —
 * anything that could plausibly match counts as a match — because a false
 * alarm here costs one review comment and a miss costs a shipped 308 over a
 * live page.
 */
function matchesSessionsRepository(source: string): boolean {
  const pattern =
    "^" +
    source
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:[A-Za-z0-9_]+\*/g, ".*")
      .replace(/:[A-Za-z0-9_]+/g, "[^/]+") +
    "$";
  const re = new RegExp(pattern);
  return re.test("/sessions/repository") || re.test("/sessions/repository/abc");
}
