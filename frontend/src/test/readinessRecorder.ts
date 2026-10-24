/**
 * readinessRecorder — the page check's own record of what it saw, written on
 * the running test (the check half of `readinessEvidence.ts`, which says what
 * counts).
 *
 * `findPresentationViolations` calls {@link recordPresentationCheck} each time
 * it runs. In a test file that proves a ready route (`readinessTargets.ts`
 * loaded the route's page for it), that adds one
 * {@link PresentationCheckRecord} to the running test's
 * `meta.presentationChecks`; anywhere else it does nothing. What the record
 * says is read from the render itself, as it stands when the check runs:
 *
 * - **which pages are mounted** — a ready route counts when a fiber in the
 *   checked view's React root renders that route's page module's own default
 *   export. A view that was unmounted, re-rendered to something else, rendered
 *   through a wrapper that drops it or inside an `OperatorOnly`, or that holds
 *   a stand-in mocked into the page's place, holds no such fiber;
 * - **whether it is presenting** — the value of the nearest presentation-mode
 *   provider above that fiber, which is what the page's own
 *   `usePresentationMode()` returns;
 * - **how check (b) saw the UI Bridge** — `provider` only for the registry
 *   `renderInPresentationMode` read back from the real `UIBridgeProvider`
 *   (marked by {@link markProviderObservation}), `caller` for a registry view a
 *   test supplied, `unobservable` otherwise.
 */

import { TestRunner } from "vitest";
import {
  FixedPresentationMode,
  PresentationModeProvider,
} from "@/components/presentation";
import {
  contextValueAbove,
  fibersUnder,
  isContext,
  reactRootOf,
  renders,
  type Fiber,
} from "./reactTree";
import {
  CHECKS_META_KEY,
  type PresentationCheckRecord,
  type RegistryObservation,
} from "./readinessEvidence";
import { readinessTargetsOf, type LoadedTarget } from "./readinessTargets";

/** What the recorder reads of a view: its render's container, and how (b) observed. */
export interface RecordedView {
  readonly container?: Element;
  readonly uiBridge: object;
}

const PROVIDER_OBSERVATIONS = new WeakSet<object>();

/** Marks `observed` as the real provider's registry, read back by the helper itself. */
export function markProviderObservation(observed: object): void {
  PROVIDER_OBSERVATIONS.add(observed);
}

function registryObservation(observed: object): RegistryObservation {
  if (PROVIDER_OBSERVATIONS.has(observed)) return "provider";
  return "registry" in observed ? "caller" : "unobservable";
}

/** The context the lens's mode travels in: what the lens components render first. */
function modeContextIn(fibers: readonly Fiber[]): unknown {
  for (const fiber of fibers) {
    if (
      !renders(fiber, FixedPresentationMode) &&
      !renders(fiber, PresentationModeProvider)
    ) {
      continue;
    }
    const provider = fiber.child?.type;
    if (isContext(provider)) return provider;
    // React 18: the provider object points back at its context.
    const context: unknown =
      typeof provider === "object" && provider !== null
        ? Reflect.get(provider, "_context")
        : undefined;
    if (isContext(context)) return context;
  }
  return null;
}

function presentsAt(fiber: Fiber, modeContext: unknown): boolean {
  const { found, value } = contextValueAbove(fiber, modeContext);
  return (
    found &&
    typeof value === "object" &&
    value !== null &&
    Reflect.get(value, "presenting") === true
  );
}

/** What one check over `view` saw of `targets`, with `violations` found. */
export function presentationCheckRecord(
  view: RecordedView,
  violations: number,
  targets: readonly LoadedTarget[]
): PresentationCheckRecord {
  const presented: string[] = [];
  const operator: string[] = [];
  const root =
    view.container === undefined ? null : reactRootOf(view.container);
  if (root !== null && root.state === "mounted") {
    const fibers = fibersUnder(root.root);
    const modeContext = modeContextIn(fibers);
    for (const target of targets) {
      const mounts = fibers.filter((fiber) => renders(fiber, target.page));
      if (mounts.length === 0) continue;
      const presenting =
        modeContext !== null &&
        mounts.some((fiber) => presentsAt(fiber, modeContext));
      (presenting ? presented : operator).push(target.route);
    }
  }
  return {
    presented,
    operator,
    violations,
    registry: registryObservation(view.uiBridge),
  };
}

function sameRecord(
  a: PresentationCheckRecord,
  b: PresentationCheckRecord
): boolean {
  return (
    a.violations === b.violations &&
    a.registry === b.registry &&
    a.presented.join("\n") === b.presented.join("\n") &&
    a.operator.join("\n") === b.operator.join("\n")
  );
}

/**
 * Record one check over `view`, which found `violations`, on the running test
 * — when that test's file proves a ready route. A check that polls (`waitFor`)
 * repeats itself; a record equal to the one before it is not added again.
 */
export function recordPresentationCheck(
  view: RecordedView,
  violations: number
): void {
  const test = TestRunner.getCurrentTest();
  if (test === undefined) return;
  const targets = readinessTargetsOf(test.file.filepath);
  if (targets.length === 0) return;
  const record = presentationCheckRecord(view, violations, targets);
  const checks = test.meta[CHECKS_META_KEY] ?? [];
  const last = checks.at(-1);
  if (last === undefined || !sameRecord(last, record)) checks.push(record);
  test.meta[CHECKS_META_KEY] = checks;
}
