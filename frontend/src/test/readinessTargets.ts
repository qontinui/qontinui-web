/**
 * readinessTargets — the pages a proof file must render, loaded before its
 * tests run (the worker half of `readinessEvidence.ts`, which says what
 * counts).
 *
 * `setup.ts` runs {@link loadReadinessTargets} before each test file's tests.
 * For a file the readiness reporter names as a ready route's proof, it loads
 * each such route's page module with `vi.importActual` ({@link loadTargets})
 * — the module itself, never a mock the file put in its place; for a page the
 * file imports unmocked, the very instance it renders — and keeps its default
 * export, so the page check can tell the page's own component from a
 * stand-in (`readinessRecorder.ts`). For any other file it does nothing, and
 * when the reporter is not in the run it finds no targets at all.
 *
 * It imports no app module, deliberately: a module the setup file loads is
 * evaluated before the test file registers its `vi.mock` calls, so it would
 * keep its real dependencies and defeat those mocks.
 */

import { relative, sep } from "node:path";
import { expect, inject, vi } from "vitest";
import {
  READINESS_PROVIDE_KEY,
  type ProvidedReadiness,
} from "./readinessEvidence";

/** A ready route the running file proves, and its page module's own default export. */
export interface LoadedTarget {
  readonly route: string;
  readonly page: unknown;
}

const STORE_KEY = Symbol.for("qontinui.presentationReadiness.loadedTargets");

/**
 * The loaded targets, by absolute test file. On `globalThis`, so the store the
 * setup file fills is the one the page check reads, even after a
 * `vi.resetModules()` gives the check a fresh copy of this module.
 */
function store(): Map<string, readonly LoadedTarget[]> {
  const holder = globalThis as unknown as Record<
    symbol,
    Map<string, readonly LoadedTarget[]> | undefined
  >;
  const existing = holder[STORE_KEY];
  if (existing !== undefined) return existing;
  const created = new Map<string, readonly LoadedTarget[]>();
  holder[STORE_KEY] = created;
  return created;
}

function isComponent(value: unknown): boolean {
  return (
    typeof value === "function" || (typeof value === "object" && value !== null)
  );
}

/**
 * The ready routes `provided` names `testPath` (absolute) as the proof of,
 * each with its page module's own default export, loaded with
 * `vi.importActual`: the module itself, never a mock the test file put in
 * its place. Throws when a page module fails to load or exports no component
 * as its default, so a proof cannot run over nothing.
 */
export async function loadTargets(
  provided: ProvidedReadiness,
  testPath: string
): Promise<LoadedTarget[]> {
  const file = relative(provided.srcDir, testPath).split(sep).join("/");
  const loaded: LoadedTarget[] = [];
  for (const target of provided.targets) {
    if (target.provenBy !== file || target.pageFile === null) continue;
    let page: unknown;
    try {
      page = (await vi.importActual<{ default?: unknown }>(target.pageFile))
        .default;
    } catch (error) {
      throw new Error(
        `presentation readiness: ${target.route}'s page module (${target.pageFile}) failed to load, so this proof cannot render it: ${String(error)}`,
        { cause: error }
      );
    }
    if (!isComponent(page)) {
      throw new Error(
        `presentation readiness: ${target.route}'s page module (${target.pageFile}) has no default export to render`
      );
    }
    loaded.push({ route: target.route, page });
  }
  return loaded;
}

/** Load the page modules of the ready routes the running test file proves (see the module doc). */
export async function loadReadinessTargets(): Promise<void> {
  // Undefined when the reporter is not in this run.
  const provided = inject(READINESS_PROVIDE_KEY) as
    | ProvidedReadiness
    | undefined;
  const testPath = expect.getState().testPath;
  if (provided === undefined || testPath === undefined) return;
  const loaded = await loadTargets(provided, testPath);
  if (loaded.length > 0) store().set(testPath, loaded);
}

/** The ready routes `testFile` (absolute) proves, with their pages; empty for any other file. */
export function readinessTargetsOf(testFile: string): readonly LoadedTarget[] {
  return store().get(testFile) ?? [];
}
