/**
 * reactTree — what a render's React root holds when the page check runs, read
 * from React DOM's own bookkeeping (plan `2026-10-23-console-presentation-spaces`
 * D3; used by `presentation.tsx` and `readinessRecorder.ts`).
 *
 * React DOM marks every container it renders into with a
 * `__reactContainer$<random>` property pointing at the root's first fiber, and
 * sets it to `null` when the root is unmounted. Each fiber names what it
 * renders (`type`, `elementType`), links to its first child, next sibling and
 * parent, and keeps the props it last rendered with (`memoizedProps`). These
 * are React internals — unchanged since React 17, and how React DevTools reads
 * a tree — so every reader here fails CLOSED: a container it cannot read has no
 * React root as far as it can tell, and the page check then reports the view
 * as not mounted instead of passing it.
 */

/** The part of a React fiber this module reads. */
export interface Fiber {
  readonly type: unknown;
  readonly elementType: unknown;
  readonly child: Fiber | null;
  readonly sibling: Fiber | null;
  readonly return: Fiber | null;
  readonly memoizedProps: unknown;
}

/**
 * What a container holds: no React root (`none` — never rendered into, or a
 * React this module cannot read), a root since unmounted, or a mounted root
 * and its current root fiber.
 */
export type ReactRootState =
  | { readonly state: "none" }
  | { readonly state: "unmounted" }
  | { readonly state: "mounted"; readonly root: Fiber };

const CONTAINER_KEY_PREFIX = "__reactContainer$";

function isFiber(value: unknown): value is Fiber {
  return (
    typeof value === "object" &&
    value !== null &&
    "child" in value &&
    "sibling" in value &&
    "return" in value &&
    "type" in value
  );
}

/** The React root `container` holds, as the page check finds it when it runs. */
export function reactRootOf(container: Element): ReactRootState {
  const key = Object.keys(container).find((k) =>
    k.startsWith(CONTAINER_KEY_PREFIX)
  );
  if (key === undefined) return { state: "none" };
  const marked: unknown = Reflect.get(container, key);
  if (marked === null || marked === undefined) return { state: "unmounted" };
  // The mark is the root's first fiber; its FiberRoot (`stateNode`) holds the
  // fiber that is current after every commit since.
  const fiberRoot: unknown =
    typeof marked === "object" ? Reflect.get(marked, "stateNode") : undefined;
  const current: unknown =
    typeof fiberRoot === "object" && fiberRoot !== null
      ? Reflect.get(fiberRoot, "current")
      : undefined;
  return isFiber(current)
    ? { state: "mounted", root: current }
    : { state: "none" };
}

/** Every fiber below `root`, depth first. */
export function fibersUnder(root: Fiber): Fiber[] {
  const out: Fiber[] = [];
  const stack: Fiber[] = root.child ? [root.child] : [];
  for (let fiber = stack.pop(); fiber !== undefined; fiber = stack.pop()) {
    out.push(fiber);
    if (fiber.sibling) stack.push(fiber.sibling);
    if (fiber.child) stack.push(fiber.child);
  }
  return out;
}

/**
 * Whether `fiber` renders `component` — a function or class component, or the
 * `memo` / `forwardRef` / `lazy` object a module exported (React keeps that
 * object as the fiber's `elementType`).
 */
export function renders(fiber: Fiber, component: unknown): boolean {
  return (
    component !== null &&
    component !== undefined &&
    (fiber.type === component || fiber.elementType === component)
  );
}

/** Whether `type` is a React context — what a `<Context.Provider>` fiber renders. */
export function isContext(type: unknown): boolean {
  return (
    typeof type === "object" &&
    type !== null &&
    Reflect.get(type, "$$typeof") === Symbol.for("react.context")
  );
}

/**
 * The value the nearest provider of `context` above `fiber` passes down — what
 * `useContext(context)` returns inside `fiber` — or `found: false` when no
 * provider is above it.
 */
export function contextValueAbove(
  fiber: Fiber,
  context: unknown
): { readonly found: boolean; readonly value: unknown } {
  for (let at = fiber.return; at !== null; at = at.return) {
    // React 19 renders `<Context.Provider>` as the context itself; React 18
    // as a provider object pointing back at it.
    const provides =
      at.type === context ||
      (typeof at.type === "object" &&
        at.type !== null &&
        Reflect.get(at.type, "_context") === context);
    if (provides) {
      const props = at.memoizedProps;
      return {
        found: true,
        value:
          typeof props === "object" && props !== null
            ? Reflect.get(props, "value")
            : undefined,
      };
    }
  }
  return { found: false, value: undefined };
}
