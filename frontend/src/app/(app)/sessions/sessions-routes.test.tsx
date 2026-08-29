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
