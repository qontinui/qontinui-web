/**
 * uiBridgeBinding — whether check (b) read the UI Bridge registry the checked
 * render registers with (plan `2026-10-23-console-presentation-spaces` D3.2;
 * used by `presentation.tsx` and `readinessRecorder.ts`).
 *
 * Every `UIBridgeProvider` creates a registry of its own, and the SDK's
 * registration hooks (`useUIComponent`, `useUIElement`) register with the
 * NEAREST provider above them. `renderInPresentationMode` wraps the render in
 * the real provider and reads its registry back; check (b) then reads that
 * registry. Two things can make that read miss what the page registers while
 * finding nothing to object to:
 *
 * - **another render's registry** — a view assembled from two renders
 *   (`{ ...pageView, uiBridge: otherView.uiBridge }`): check (b) reads the
 *   other render's registry while checks (a), (c)–(f) read the page;
 * - **a provider of the render's own** — a caller's `wrapper`, or the page
 *   itself, mounting another `UIBridgeProvider`: everything below it registers
 *   there, and the registry the helper read back holds none of it.
 *
 * So the helper records, for every registry it reads back, the render it read
 * it from — that render's container, the raw registry and the provider
 * component it mounted ({@link markProviderReadBack}) — and
 * {@link registryBinding} checks a view against it as the check runs: the
 * view must be that render (same container), and every UI Bridge provider in
 * the render's React tree must carry that registry. Check (b) fails a view
 * that is not, and a readiness record claims the real provider only for a
 * view that is.
 */

import type { RegistryObservation } from "./readinessEvidence";
import {
  contextProvidedBy,
  fibersUnder,
  providedValue,
  providesContext,
  reactRootOf,
} from "./reactTree";

/** What `renderInPresentationMode` read back from the real provider, and from which render. */
export interface ProviderReadBack {
  /** The render's own container — RTL's `container`. */
  readonly container: Element;
  /** The provider's registry, as its context passed it down. */
  readonly registry: object;
  /** The `UIBridgeProvider` component the render mounted. */
  readonly provider: unknown;
}

const READ_BACKS = new WeakMap<object, ProviderReadBack>();

/** Records that `observed` is the registry the helper read back from `readBack`'s render. */
export function markProviderReadBack(
  observed: object,
  readBack: ProviderReadBack
): void {
  READ_BACKS.set(observed, readBack);
}

/** What check (b) and the record read of a view. */
export interface BindableView {
  readonly container?: Element;
  readonly uiBridge: object;
}

/** How check (b) saw the UI Bridge for one view, as the check runs. */
export interface RegistryBinding {
  /**
   * - `provider` — the registry the helper read back from THIS render's real
   *   provider, and the only UI Bridge registry in the render's tree;
   * - `another-render` — a read-back from a render other than this view's;
   * - `another-provider` — this render's read-back, but its tree also holds a
   *   UI Bridge provider whose registry check (b) did not read;
   * - `unbound` — a read-back that cannot be tied to the render's tree: a
   *   view without a container (a statement about the document), a root that
   *   is not mounted, or a tree in which the helper's provider is not found;
   * - `caller` / `unobservable` — the test supplied a registry view, or said
   *   the registry cannot be observed.
   */
  readonly observation: RegistryObservation;
  /**
   * Why check (b) cannot have read what this render registers — the detail of
   * the violation it reports — or `null`. `null` also for a view check (b)
   * cannot tie to a render by design (no container) and for a root that is
   * not mounted, which check (f) reports itself.
   */
  readonly unread: string | null;
}

function registryOf(contextValue: unknown): unknown {
  return typeof contextValue === "object" && contextValue !== null
    ? Reflect.get(contextValue, "registry")
    : undefined;
}

/** See {@link RegistryBinding}. */
export function registryBinding(view: BindableView): RegistryBinding {
  const readBack = READ_BACKS.get(view.uiBridge);
  if (readBack === undefined) {
    return {
      observation: "registry" in view.uiBridge ? "caller" : "unobservable",
      unread: null,
    };
  }
  if (view.container === undefined) {
    return { observation: "unbound", unread: null };
  }
  if (view.container !== readBack.container) {
    return {
      observation: "another-render",
      unread:
        "check (b) read the UI Bridge registry of another render, not this view's — a view assembled from two renders — so nothing this render registers was read",
    };
  }
  const root = reactRootOf(view.container);
  if (root.state !== "mounted") return { observation: "unbound", unread: null };
  const fibers = fibersUnder(root.root);
  const context = contextProvidedBy(fibers, [readBack.provider]);
  if (context === null) {
    return {
      observation: "unbound",
      unread:
        "check (b) cannot find, in this render's React tree, the UIBridgeProvider its registry came from, so it cannot tell that it read what the render registers",
    };
  }
  const foreign = fibers.filter(
    (fiber) =>
      providesContext(fiber, context) &&
      registryOf(providedValue(fiber)) !== readBack.registry
  ).length;
  if (foreign > 0) {
    return {
      observation: "another-provider",
      unread: `this render mounts ${foreign === 1 ? "a UIBridgeProvider" : `${foreign} UIBridgeProviders`} of its own (in the caller's wrapper or the page), so what is registered below ${foreign === 1 ? "it goes to a registry" : "them goes to registries"} check (b) does not read — drop the extra provider; the helper mounts the real one`,
    };
  }
  return { observation: "provider", unread: null };
}
