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
 * - **which pages are mounted, and read** — a ready route counts when a fiber
 *   in the checked view's React root renders that route's page module's own
 *   default export, and the check read what it rendered: at least one element
 *   or non-blank text, every DOM node of it (portals' included) connected and
 *   inside the element checks (a)–(e) read. A view that was unmounted,
 *   re-rendered to something else, rendered through a wrapper that drops it or
 *   inside an `OperatorOnly`, or that holds a stand-in mocked into the page's
 *   place, holds no such fiber; a page that rendered nothing, or portaled any
 *   of its output out of what the check read (into another document, an
 *   iframe's, too), is `unread`;
 * - **whether it is presenting** — the value of the nearest presentation-mode
 *   provider above each of the page's fibers, which is what the page's own
 *   `usePresentationMode()` returns;
 * - **how check (b) saw the UI Bridge** — `provider` only when the registry it
 *   read is the one `renderInPresentationMode` read back from THIS render's
 *   real `UIBridgeProvider`, and no other UI Bridge provider in the render's
 *   tree holds a registry of its own (`uiBridgeBinding.ts`);
 * - **which render it read** — one number per render's container, so the
 *   verdict can take each render's last check as what that render settled in.
 */

import { TestRunner } from "vitest";
import {
  FixedPresentationMode,
  PresentationModeProvider,
} from "@/components/presentation";
import {
  contextProvidedBy,
  contextValueAbove,
  fibersUnder,
  hostNodesUnder,
  reactRootOf,
  renders,
  type Fiber,
} from "./reactTree";
import {
  CHECKS_META_KEY,
  type PresentationCheckRecord,
} from "./readinessEvidence";
import { readinessTargetsOf, type LoadedTarget } from "./readinessTargets";
import { registryBinding, type BindableView } from "./uiBridgeBinding";

/** What the recorder reads of a view: its render's container, and how (b) observed. */
export type RecordedView = BindableView;

const RENDERS_KEY = Symbol.for("qontinui.presentationReadiness.renders");

interface RenderNumbers {
  readonly byContainer: WeakMap<Element, number>;
  next: number;
}

/**
 * The render numbers, by container. On `globalThis`, so two copies of this
 * module (after a `vi.resetModules()`) never give two renders one number.
 */
function renderNumbers(): RenderNumbers {
  const holder = globalThis as unknown as Record<
    symbol,
    RenderNumbers | undefined
  >;
  const existing = holder[RENDERS_KEY];
  if (existing !== undefined) return existing;
  const created: RenderNumbers = { byContainer: new WeakMap(), next: 1 };
  holder[RENDERS_KEY] = created;
  return created;
}

/** The number of the render whose container is `container`: the same for every check over it. */
function renderOf(container: Element | undefined): number | null {
  if (container === undefined) return null;
  const numbers = renderNumbers();
  const known = numbers.byContainer.get(container);
  if (known !== undefined) return known;
  const assigned = numbers.next;
  numbers.next += 1;
  numbers.byContainer.set(container, assigned);
  return assigned;
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

function isSomething(node: Node): boolean {
  return (
    node.nodeType === Node.ELEMENT_NODE ||
    (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim() !== "")
  );
}

/**
 * Whether the check, reading `read`, read everything `fiber` rendered: it
 * rendered something, and every DOM node of it is on the screen inside `read`.
 */
function outputRead(fiber: Fiber, read: Element): boolean {
  const nodes = hostNodesUnder(fiber);
  return (
    nodes.some(isSomething) &&
    nodes.every((node) => node.isConnected && read.contains(node))
  );
}

/**
 * What one check over `view`, reading the element `read`, saw of `targets`,
 * with `violations` found.
 */
export function presentationCheckRecord(
  view: RecordedView,
  violations: number,
  targets: readonly LoadedTarget[],
  read: Element
): PresentationCheckRecord {
  const presented: string[] = [];
  const operator: string[] = [];
  const unread: string[] = [];
  const root =
    view.container === undefined ? null : reactRootOf(view.container);
  if (root !== null && root.state === "mounted") {
    const fibers = fibersUnder(root.root);
    const modeContext = contextProvidedBy(fibers, [
      FixedPresentationMode,
      PresentationModeProvider,
    ]);
    for (const target of targets) {
      const mounts = fibers.filter((fiber) => renders(fiber, target.page));
      if (mounts.length === 0) continue;
      if (!mounts.every((fiber) => outputRead(fiber, read))) {
        unread.push(target.route);
        continue;
      }
      const presenting =
        modeContext !== null &&
        mounts.every((fiber) => presentsAt(fiber, modeContext));
      (presenting ? presented : operator).push(target.route);
    }
  }
  return {
    render: renderOf(view.container),
    presented,
    operator,
    unread,
    violations,
    registry: registryBinding(view).observation,
  };
}

function sameRecord(
  a: PresentationCheckRecord,
  b: PresentationCheckRecord
): boolean {
  return (
    a.render === b.render &&
    a.violations === b.violations &&
    a.registry === b.registry &&
    a.presented.join("\n") === b.presented.join("\n") &&
    a.operator.join("\n") === b.operator.join("\n") &&
    a.unread.join("\n") === b.unread.join("\n")
  );
}

/**
 * `checks` with `record` after them. A check that polls (`waitFor`) repeats
 * itself, so a record equal to the one before it — the same render, seen the
 * same way — is not added again; one of another render always is.
 */
export function appendCheck(
  checks: readonly PresentationCheckRecord[],
  record: PresentationCheckRecord
): PresentationCheckRecord[] {
  const last = checks.at(-1);
  return last !== undefined && sameRecord(last, record)
    ? [...checks]
    : [...checks, record];
}

/**
 * Record one check over `view`, which read the element `read` and found
 * `violations`, on the running test — when that test's file proves a ready
 * route.
 */
export function recordPresentationCheck(
  view: RecordedView,
  violations: number,
  read: Element
): void {
  const test = TestRunner.getCurrentTest();
  if (test === undefined) return;
  const targets = readinessTargetsOf(test.file.filepath);
  if (targets.length === 0) return;
  const record = presentationCheckRecord(view, violations, targets, read);
  test.meta[CHECKS_META_KEY] = appendCheck(
    test.meta[CHECKS_META_KEY] ?? [],
    record
  );
}
