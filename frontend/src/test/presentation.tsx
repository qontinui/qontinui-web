/**
 * Presentation-mode test helper — render a surface in presentation mode, and
 * assert it is safe to show an outsider (plan
 * `2026-10-23-console-presentation-spaces` D3).
 *
 * A lens page is shown in presentation mode only once it is registered as
 * presentation-ready, and the registration names the page test that proves
 * it — a presentation-mode render built on this helper
 * (`components/presentation/presentationReadiness.ts`):
 *
 *     const view = renderInPresentationMode(<DevOpsPage />, {
 *       scope: { status: "ready", scope: { firstPartyOwners: ["acme"], confidentialTerms: [] } },
 *     });
 *     await screen.findByTestId("coord-devops-health-strip");
 *     expectPresentationSafe(view, {
 *       captions: ["dev-ops.page"],
 *       forbidden: ["build-host-1", "0b9d6a54"], // the fixture's real names
 *     });
 *
 * `expectPresentationSafe` fails, listing every offender, on:
 *
 * - **(a) an enabled control** — a `button`, `input`, `select`, `textarea`,
 *   `[contenteditable]` or ARIA widget that is not disabled and is not
 *   navigation-only. Navigation-only means: carries `NAVIGATION_ONLY_PROPS`
 *   (`data-presentation-nav`), or is a link (`a[href]`, `role="link"`), a tab
 *   (`role="tab"`), or a pure disclosure — a BUTTON with `aria-expanded` and
 *   no `aria-haspopup`. Opening a menu or a dialog is not a pure disclosure,
 *   because what it opens can write; neither is a `combobox` (the UI kit's
 *   Select trigger), whose list is a choice that can write. Hidden content is
 *   scanned too: a control one click away is still in front of the audience.
 *   The one other allowance is a presenter safety control
 *   (`presenterSafetyProps`, `components/console/presenterSafety.ts`) naming
 *   one of the CLOSED list `PRESENTER_SAFETY_CONTROLS` — stopping the AI
 *   co-pilot or a recording, and the session-expiry prompt. A marker naming
 *   anything else is itself a violation, so an exemption cannot be minted at
 *   a call site. And a link is navigation only while it keeps the
 *   presentation: an `a[href]` to a lens page (this origin, `LENS_TREES`)
 *   whose URL does not carry `?present=1` is a `presentation-dropping-link` —
 *   opened in a new tab it would show the operator view. Build its href with
 *   `usePresentationHref`.
 * - **(b) a write registration** — a mounted UI Bridge component action, or a
 *   connected element's custom action, whose declared `effect` is `write` or
 *   `destructive`, or that declares NO effect: unclassified is not safe (D3.2:
 *   "UI Bridge registrations on lens pages declare `effect`").
 * - **(c) a cost** — `CostFigure`'s operator-mode figure, the "list-price
 *   equivalent" label, or any currency figure (`$12`, `€0.40`, `3 USD`) in
 *   text or in a `title` / `aria-label` / `alt` / `placeholder` / input value.
 * - **(d) a missing caption** — each key in `options.captions` must render.
 * - **(e) an identity** — an email address (personal data) or a UUID (an
 *   internal identifier) in text or in a `title` / `aria-label` / `alt` /
 *   `placeholder` / input value, always; and any of `options.forbidden` — the
 *   fixture's hostnames, device ids, other parties' names — anywhere, matched
 *   ignoring case. A page test passes the real names its fixture holds, so the
 *   check sees exactly what the lens was meant to hide (D3.3).
 * - **(f) a view that is not on the screen** — checks (a)–(e) look for what
 *   is shown, so over nothing they pass whatever the page would render. A
 *   render's view (one carrying its `container`, as `renderInPresentationMode`
 *   returns it) fails when, as the check runs, its React root has been
 *   unmounted (`unmount()`), its container is not inside the document the
 *   check reads (cleaned up, or rendered somewhere detached), or the container
 *   holds nothing but the helper's own sentinel — a `wrapper` that drops its
 *   children, an `OperatorOnly` around the whole render, a page that rendered
 *   nothing. A view without a `container` is a statement about the document,
 *   and is read as the document.
 *
 * ## How (b) observes the registry
 *
 * By default the render is wrapped in the REAL `UIBridgeProvider` and its
 * registry is read back — which is the only way to see what an automated walk
 * would see. A test file that mocks `@qontinui/ui-bridge/react` cannot do
 * that, so it must say how instead: pass `uiBridge: { registry }` (a view over
 * whatever its mock recorded) or `uiBridge: { unobservable: "<reason>" }`.
 * Neither is defaulted, so a mocked bridge can never make (b) pass by seeing
 * nothing. A PARTIAL mock — the real provider kept, the registration hooks
 * stubbed (`{ ...importOriginal(), useUIComponent: … }`) — would leave the
 * provider's registry real but empty, so the render also mounts a sentinel
 * that registers one component and one element through the SDK's own hooks,
 * and throws unless the registry recorded both. The sentinels are left out of
 * the checks.
 *
 * The render is a `FixedPresentationMode` lens with the given presentation
 * scope (default UNKNOWN, as production has until a scope provider says
 * otherwise: every `RedactedText` withholds). Supply the caller's own
 * providers through `wrapper`, as with RTL's `render`.
 *
 * ## What a check records for readiness
 *
 * In a test file that proves a presentation-ready route, every run of
 * `findPresentationViolations` (and so of `expectPresentationSafe`) also
 * records on the running test what it saw — whether the route's own page
 * component was mounted in the view, under a presenting lens; how many
 * violations it found; whether (b) read the real provider's registry
 * (`readinessRecorder.ts`). The run, not this file, then decides whether the
 * route is proven (`readinessEvidence.ts`). Elsewhere a check records nothing.
 */

import type { ComponentType, ReactElement, ReactNode } from "react";
import {
  render,
  type RenderOptions,
  type RenderResult,
} from "@testing-library/react";
import { expect } from "vitest";
import * as uiBridgeReact from "@qontinui/ui-bridge/react";
import {
  COST_EQUIVALENT_LABEL,
  FixedPresentationMode,
  NAVIGATION_ONLY_ATTRIBUTE,
  PRESENTATION_SCOPE_UNKNOWN,
  PRESENTER_SAFETY_ATTRIBUTE,
  PRESENT_PARAM,
  PresentationScopeProvider,
  isLensTreePath,
  isPresenterSafetyControl,
  type CaptionKey,
  type PresentationScopeState,
} from "@/components/presentation";
import { CURRENCY_FIGURE } from "./currencyTokens";
import { reactRootOf } from "./reactTree";
import {
  markProviderObservation,
  recordPresentationCheck,
} from "./readinessRecorder";

/** The part of a UI Bridge registry check (b) reads. */
export interface UiBridgeRegistryView {
  getAllComponents(): ReadonlyArray<{
    readonly id: string;
    readonly mounted?: boolean;
    readonly actions?: ReadonlyArray<{
      readonly id: string;
      readonly effect?: string;
    }>;
  }>;
  getAllElements(): ReadonlyArray<{
    readonly id: string;
    readonly element?: Element | null;
    readonly customActions?: Readonly<
      Record<string, { readonly id: string; readonly effect?: string }>
    >;
  }>;
}

/** How check (b) is to observe UI Bridge registrations. */
export type UiBridgeObservation =
  | "provider"
  | { readonly registry: UiBridgeRegistryView }
  | { readonly unobservable: string };

/** What a render ended up observing for check (b). */
export type UiBridgeObserved =
  | { readonly registry: UiBridgeRegistryView }
  | { readonly unobservable: string };

export interface PresentationRenderOptions extends Omit<
  RenderOptions,
  "wrapper" | "queries"
> {
  /** The presentation scope. Default UNKNOWN — everything redacts. */
  scope?: PresentationScopeState;
  /** See the module doc. Default `"provider"`, the real SDK. */
  uiBridge?: UiBridgeObservation;
  /** The caller's own providers (a QueryClientProvider, a mocked context …). */
  wrapper?: ComponentType<{ children: ReactNode }>;
}

export type PresentationRenderResult = RenderResult & {
  readonly uiBridge: UiBridgeObserved;
};

/** What the checks read: where to look, and the registry observation. */
export interface PresentationView {
  /** Where checks (a)–(e) look; default `document.body`, so portals are read too. */
  readonly baseElement?: Element;
  /**
   * The render's own container — RTL's `container`, which
   * `renderInPresentationMode`'s result carries. With it, check (f) reads
   * whether the render is still on the screen. Without it, the view is a
   * statement about the document, and is read as the document.
   */
  readonly container?: Element;
  readonly uiBridge: UiBridgeObserved;
}

export type PresentationViolationKind =
  | "unmounted-view"
  | "empty-view"
  | "enabled-control"
  | "presentation-dropping-link"
  | "write-registration"
  | "undeclared-registration"
  | "cost-figure"
  | "cost-label"
  | "currency-figure"
  | "missing-caption"
  | "identifier"
  | "foreign-identity";

export interface PresentationViolation {
  readonly kind: PresentationViolationKind;
  readonly detail: string;
}

export interface PresentationSafetyOptions {
  /** Caption keys that must render (`data-presentation-caption`). */
  readonly captions?: readonly CaptionKey[];
  /**
   * Strings the render must not show anywhere — the fixture's hostnames,
   * device ids, other parties' names. Matched ignoring case, in text and in
   * the text attributes.
   */
  readonly forbidden?: readonly string[];
}

interface BridgeModule {
  readonly Provider: ComponentType<{ children: ReactNode }>;
  readonly useBridge: () => { readonly registry?: unknown } | null;
}

/** The ids the helper's own sentinel registrations carry. */
const SENTINEL_COMPONENT_ID = "presentation-helper.sentinel-component";
const SENTINEL_ELEMENT_ID = "presentation-helper.sentinel-element";
const SENTINEL_IDS: ReadonlySet<string> = new Set([
  SENTINEL_COMPONENT_ID,
  SENTINEL_ELEMENT_ID,
]);
/** The attribute on the sentinel's element: not the page, so check (f) skips it. */
const SENTINEL_ATTRIBUTE = "data-presentation-sentinel";

/** The real SDK, or `null` when the test file mocked it away. */
function realBridge(): BridgeModule | null {
  try {
    const Provider = uiBridgeReact.UIBridgeProvider as unknown;
    const useBridge = uiBridgeReact.useUIBridgeOptional as unknown;
    if (typeof Provider !== "function" || typeof useBridge !== "function") {
      return null;
    }
    return {
      Provider: Provider as BridgeModule["Provider"],
      useBridge: useBridge as BridgeModule["useBridge"],
    };
  } catch {
    // A vitest module mock throws on an export its factory did not define.
    return null;
  }
}

/**
 * Registers one component and one element through the SDK's hooks, as any
 * page would. If either never reaches the registry, the hooks are not the
 * SDK's — a partial mock — and nothing the page registers would reach it
 * either.
 */
function BridgeSentinel() {
  uiBridgeReact.useUIComponent({
    id: SENTINEL_COMPONENT_ID,
    name: "Presentation helper sentinel",
    actions: [
      {
        id: "observe",
        label: "Observe",
        effect: "read",
        handler: async () => true,
      },
    ],
  });
  const { ref } = uiBridgeReact.useUIElement({
    id: SENTINEL_ELEMENT_ID,
    label: "Presentation helper sentinel",
    type: "button",
  });
  return <span ref={ref} hidden {...{ [SENTINEL_ATTRIBUTE]: "" }} />;
}

/** `registry` without the helper's own sentinel registrations. */
function withoutSentinels(
  registry: UiBridgeRegistryView
): UiBridgeRegistryView {
  return {
    getAllComponents: () =>
      registry.getAllComponents().filter((c) => !SENTINEL_IDS.has(c.id)),
    getAllElements: () =>
      registry.getAllElements().filter((e) => !SENTINEL_IDS.has(e.id)),
  };
}

function isRegistryView(value: unknown): value is UiBridgeRegistryView {
  const r = value as Partial<UiBridgeRegistryView> | null;
  return (
    !!r &&
    typeof r.getAllComponents === "function" &&
    typeof r.getAllElements === "function"
  );
}

/**
 * Render `ui` in presentation mode. Returns RTL's result plus how check (b)
 * observed the UI Bridge registry.
 */
export function renderInPresentationMode(
  ui: ReactElement,
  options: PresentationRenderOptions = {}
): PresentationRenderResult {
  const {
    scope = PRESENTATION_SCOPE_UNKNOWN,
    uiBridge = "provider",
    wrapper: CallerWrapper,
    ...renderOptions
  } = options;

  const bridge = uiBridge === "provider" ? realBridge() : null;
  if (uiBridge === "provider" && bridge === null) {
    throw new Error(
      "renderInPresentationMode: @qontinui/ui-bridge/react is mocked in this test file, " +
        "so the real registry cannot be read for check (b). Pass " +
        "`uiBridge: { registry }` (a view over what your mock recorded) or " +
        '`uiBridge: { unobservable: "<why>" }`.'
    );
  }

  const probe: { registry: UiBridgeRegistryView | null } = { registry: null };

  function RegistryProbe({
    useBridge,
  }: {
    useBridge: BridgeModule["useBridge"];
  }) {
    const context = useBridge();
    const registry = context?.registry;
    probe.registry = isRegistryView(registry) ? registry : null;
    return null;
  }

  function Wrapper({ children }: { children: ReactNode }) {
    const lens = (
      <FixedPresentationMode presenting>
        <PresentationScopeProvider state={scope}>
          {CallerWrapper ? <CallerWrapper>{children}</CallerWrapper> : children}
        </PresentationScopeProvider>
      </FixedPresentationMode>
    );
    if (!bridge) return lens;
    const Provider = bridge.Provider;
    return (
      <Provider>
        <RegistryProbe useBridge={bridge.useBridge} />
        <BridgeSentinel />
        {lens}
      </Provider>
    );
  }

  const result = render(ui, { ...renderOptions, wrapper: Wrapper });

  let observed: UiBridgeObserved;
  if (uiBridge === "provider") {
    const registry = probe.registry;
    if (registry === null) {
      throw new Error(
        "renderInPresentationMode: the UIBridgeProvider exposed no registry, so check (b) " +
          "would see nothing. Pass `uiBridge: { registry }` or `uiBridge: { unobservable }`."
      );
    }
    const sawComponent = registry
      .getAllComponents()
      .some((c) => c.id === SENTINEL_COMPONENT_ID);
    const sawElement = registry
      .getAllElements()
      .some((e) => e.id === SENTINEL_ELEMENT_ID);
    if (!sawComponent || !sawElement) {
      throw new Error(
        "renderInPresentationMode: the UI Bridge registry did not record the helper's own " +
          "sentinel registrations, so the SDK's registration hooks are stubbed in this test " +
          "file (a partial mock of @qontinui/ui-bridge/react) and check (b) would see " +
          "nothing. Pass `uiBridge: { registry }` or `uiBridge: { unobservable }`."
      );
    }
    observed = { registry: withoutSentinels(registry) };
    markProviderObservation(observed);
  } else {
    observed = uiBridge;
  }
  return Object.assign(result, { uiBridge: observed });
}

// ---------------------------------------------------------------------------
// (f) the view is on the screen
// ---------------------------------------------------------------------------

/** Whether `container` holds nothing but the helper's sentinel and blank text. */
function rendersNothing(container: Element): boolean {
  for (const node of container.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.textContent ?? "").trim() !== "") return false;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (!(node as Element).hasAttribute(SENTINEL_ATTRIBUTE)) return false;
    }
  }
  return true;
}

/**
 * Why the render `view` is not on the screen as the check runs; empty when it
 * is, or when the view carries no container (a statement about the document).
 */
function mountViolations(
  view: PresentationView,
  root: Element
): PresentationViolation[] {
  const container = view.container;
  if (container === undefined) return [];
  if (!container.isConnected || !root.contains(container)) {
    return [
      {
        kind: "unmounted-view",
        detail:
          "the view's container is not inside the document the check reads, so none of it is on the screen — it was cleaned up, or rendered into a detached element",
      },
    ];
  }
  const reactRoot = reactRootOf(container);
  if (reactRoot.state !== "mounted") {
    return [
      {
        kind: "unmounted-view",
        detail:
          reactRoot.state === "unmounted"
            ? "the view was unmounted before the check ran (`unmount()`), so nothing it rendered is on the screen"
            : "the view's container holds no React root this check can read, so what it shows cannot be told apart from nothing",
      },
    ];
  }
  if (rendersNothing(container)) {
    return [
      {
        kind: "empty-view",
        detail:
          "the view renders nothing but the helper's own sentinel — a wrapper that drops its children, an OperatorOnly around the whole render, or a page that rendered nothing — so the checks would pass whatever the page shows",
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// (a) enabled controls
// ---------------------------------------------------------------------------

const WIDGET_ROLES = [
  "button",
  "link",
  "checkbox",
  "switch",
  "radio",
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "treeitem",
];

const CONTROL_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "a[href]",
  "[contenteditable]",
  ...WIDGET_ROLES.map((role) => `[role="${role}"]`),
].join(",");

const READ_ONLY_INPUT_TYPES = new Set([
  "text",
  "search",
  "email",
  "url",
  "tel",
  "number",
  "password",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

/** Why `el` may stay live in presentation mode, or `null` when it may not. */
function controlAllowance(el: Element): string | null {
  if (el.hasAttribute(NAVIGATION_ONLY_ATTRIBUTE)) return "navigation-only";
  const safety = el.getAttribute(PRESENTER_SAFETY_ATTRIBUTE);
  if (isPresenterSafetyControl(safety)) return `presenter safety: ${safety}`;
  const tag = el.tagName.toLowerCase();
  if (tag === "input" && (el as HTMLInputElement).type === "hidden")
    return "hidden input";
  if (el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") {
    return "disabled";
  }
  if (el.getAttribute("contenteditable") === "false") return "not editable";
  if (
    (tag === "textarea" && (el as HTMLTextAreaElement).readOnly) ||
    (tag === "input" &&
      (el as HTMLInputElement).readOnly &&
      READ_ONLY_INPUT_TYPES.has((el as HTMLInputElement).type))
  ) {
    return "read-only";
  }
  const role = el.getAttribute("role");
  if (role === "link" || (tag === "a" && role === null)) return "link";
  if (role === "tab") return "tab";
  if (tag === "summary") return "disclosure";
  const popup = el.getAttribute("aria-haspopup");
  if (
    el.hasAttribute("aria-expanded") &&
    (popup === null || popup === "false") &&
    // A combobox (a Radix Select trigger: `aria-expanded`, no
    // `aria-haspopup`) opens a list whose choice can write.
    (role === null || role === "button")
  ) {
    return "disclosure";
  }
  return null;
}

function describeElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role");
  const name =
    el.getAttribute("aria-label") ??
    (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const testId = el.getAttribute("data-testid");
  return [
    `<${tag}${role ? ` role="${role}"` : ""}>`,
    name ? `"${name}"` : "(no name)",
    testId ? `data-testid=${testId}` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The lens page `link` opens WITHOUT the presentation — this origin, a lens
 * tree, and a URL not carrying `?present=1` — or `null` when it keeps it (or
 * leaves the lens, where there is no presentation to keep).
 */
function presentationDroppedBy(link: Element): string | null {
  const href = link.getAttribute("href");
  if (href === null) return null;
  const base = link.ownerDocument.baseURI;
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin) return null;
  if (!isLensTreePath(url.pathname)) return null;
  return url.searchParams.get(PRESENT_PARAM) === "1" ? null : url.pathname;
}

function controlViolations(root: Element): PresentationViolation[] {
  const out: PresentationViolation[] = [];
  for (const link of root.querySelectorAll("a[href]")) {
    const dropped = presentationDroppedBy(link);
    if (dropped !== null) {
      out.push({
        kind: "presentation-dropping-link",
        detail: `${describeElement(link)} links to the lens page ${dropped} without ?${PRESENT_PARAM}=1, so opened in a new tab it shows the operator view — build its href with usePresentationHref`,
      });
    }
  }
  const marked = `[${PRESENTER_SAFETY_ATTRIBUTE}]`;
  for (const el of root.querySelectorAll(`${CONTROL_SELECTOR},${marked}`)) {
    // A safety marker naming a control the closed list does not hold claims
    // an exemption nobody granted — on any element, control or not.
    const safety = el.getAttribute(PRESENTER_SAFETY_ATTRIBUTE);
    if (safety !== null && !isPresenterSafetyControl(safety)) {
      out.push({
        kind: "enabled-control",
        detail: `${describeElement(el)} claims presenter-safety control "${safety}", which PRESENTER_SAFETY_CONTROLS does not list`,
      });
      continue;
    }
    if (el.matches(CONTROL_SELECTOR) && controlAllowance(el) === null) {
      out.push({
        kind: "enabled-control",
        detail: `${describeElement(el)} is an enabled control that is not navigation-only`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (b) UI Bridge registrations
// ---------------------------------------------------------------------------

function effectViolation(
  owner: string,
  actionId: string,
  effect: string | undefined
): PresentationViolation | null {
  if (effect === "write" || effect === "destructive") {
    return {
      kind: "write-registration",
      detail: `${owner} action "${actionId}" declares effect "${effect}"`,
    };
  }
  if (effect !== "read") {
    return {
      kind: "undeclared-registration",
      detail: `${owner} action "${actionId}" declares no effect — unclassified is not safe`,
    };
  }
  return null;
}

function registrationViolations(
  observed: UiBridgeObserved
): PresentationViolation[] {
  if (!("registry" in observed)) return [];
  const out: PresentationViolation[] = [];
  for (const component of observed.registry.getAllComponents()) {
    if (component.mounted === false) continue;
    for (const action of component.actions ?? []) {
      const v = effectViolation(
        `UI Bridge component "${component.id}"`,
        action.id,
        action.effect
      );
      if (v) out.push(v);
    }
  }
  for (const element of observed.registry.getAllElements()) {
    if (element.element && !element.element.isConnected) continue;
    for (const action of Object.values(element.customActions ?? {})) {
      const v = effectViolation(
        `UI Bridge element "${element.id}"`,
        action.id,
        action.effect
      );
      if (v) out.push(v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (c) cost
// ---------------------------------------------------------------------------

/**
 * A currency symbol or ISO code next to a number, either order: `$12`,
 * `$.50`, `€-3`, `12 USD`, `12,00 €` and `12¢`. Built in `currencyTokens.ts`
 * from the one currency vocabulary the source scan (`costRenderScan.ts`)
 * reads too, and re-exported here for the callers that import it from this
 * helper.
 */
export { CURRENCY_FIGURE };
const COST_LABEL_FRAGMENT = "list-price equivalent";

const TEXT_ATTRIBUTES = [
  "title",
  "aria-label",
  "aria-description",
  "alt",
  "placeholder",
];

function textNodes(root: Element): Array<{ text: string; owner: Element }> {
  const out: Array<{ text: string; owner: Element }> = [];
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT
  );
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (text.trim() && node.parentElement)
      out.push({ text, owner: node.parentElement });
  }
  for (const el of root.querySelectorAll("*")) {
    for (const attr of TEXT_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (value) out.push({ text: value, owner: el });
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      if (el.value) out.push({ text: el.value, owner: el });
    }
  }
  return out;
}

function costViolations(root: Element): PresentationViolation[] {
  const out: PresentationViolation[] = [];
  for (const el of root.querySelectorAll('[data-cost-figure="figure"]')) {
    out.push({
      kind: "cost-figure",
      detail: `${describeElement(el)} is a CostFigure rendering its figure`,
    });
  }
  const label = COST_LABEL_FRAGMENT.toLowerCase();
  let anyCurrency = false;
  for (const { text, owner } of textNodes(root)) {
    if (
      text.toLowerCase().includes(label) ||
      text.includes(COST_EQUIVALENT_LABEL)
    ) {
      out.push({
        kind: "cost-label",
        detail: `${describeElement(owner)} carries the cost label "${COST_EQUIVALENT_LABEL}"`,
      });
    }
    const match = CURRENCY_FIGURE.exec(text);
    if (match) {
      anyCurrency = true;
      out.push({
        kind: "currency-figure",
        detail: `${describeElement(owner)} shows a currency figure ("${text.trim().slice(0, 60)}")`,
      });
    }
  }
  // A figure split across elements ("$" in one span, "12" in the next) is in
  // no single text node, but it is on the screen.
  if (!anyCurrency && CURRENCY_FIGURE.test(root.textContent ?? "")) {
    out.push({
      kind: "currency-figure",
      detail: "a currency figure is rendered across adjacent elements",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// (d) captions
// ---------------------------------------------------------------------------

function captionViolations(
  root: Element,
  captions: readonly CaptionKey[]
): PresentationViolation[] {
  return captions
    .filter(
      (key) => !root.querySelector(`[data-presentation-caption="${key}"]`)
    )
    .map((key) => ({
      kind: "missing-caption" as const,
      detail: `caption "${key}" did not render`,
    }));
}

// ---------------------------------------------------------------------------
// (e) identities
// ---------------------------------------------------------------------------

/** An email address — personal data an evaluator is never shown. */
const EMAIL =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
/** A UUID — an internal identifier (device, session, tenant, agent ids). */
const UUID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

function identityViolations(
  root: Element,
  forbidden: readonly string[]
): PresentationViolation[] {
  const out: PresentationViolation[] = [];
  const needles = forbidden
    .map((f) => f.trim())
    .filter(Boolean)
    .map((f) => ({ f, lower: f.toLowerCase() }));
  const found = new Set<string>();
  for (const { text, owner } of textNodes(root)) {
    const where = describeElement(owner);
    if (EMAIL.test(text)) {
      out.push({
        kind: "identifier",
        detail: `${where} shows an email address — personal data`,
      });
    }
    if (UUID.test(text)) {
      out.push({
        kind: "identifier",
        detail: `${where} shows an internal identifier (a UUID)`,
      });
    }
    const lower = text.toLowerCase();
    for (const { f, lower: needle } of needles) {
      if (lower.includes(needle)) {
        found.add(needle);
        out.push({ kind: "foreign-identity", detail: `${where} shows "${f}"` });
      }
    }
  }
  // A name split across elements is in no single text node, but it is on the
  // screen.
  const whole = (root.textContent ?? "").toLowerCase();
  for (const { f, lower: needle } of needles) {
    if (!found.has(needle) && whole.includes(needle)) {
      out.push({
        kind: "foreign-identity",
        detail: `"${f}" is rendered across adjacent elements`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

/** Every way the render is not safe to show; empty when it is. */
export function findPresentationViolations(
  view: PresentationView,
  options: PresentationSafetyOptions = {}
): PresentationViolation[] {
  const root = view.baseElement ?? document.body;
  const violations = [
    ...mountViolations(view, root),
    ...controlViolations(root),
    ...registrationViolations(view.uiBridge),
    ...costViolations(root),
    ...captionViolations(root, options.captions ?? []),
    ...identityViolations(root, options.forbidden ?? []),
  ];
  // The readiness evidence: in a ready route's proof, what this check saw.
  recordPresentationCheck(view, violations.length);
  return violations;
}

/** One line per violation, for an assertion message. */
export function describeViolation(v: PresentationViolation): string {
  return `[${v.kind}] ${v.detail}`;
}

/** Fails the test, listing every violation, unless the render is safe to show. */
export function expectPresentationSafe(
  view: PresentationView,
  options: PresentationSafetyOptions = {}
): void {
  expect(
    findPresentationViolations(view, options).map(describeViolation),
    "this presentation-mode render is not safe to show an outsider"
  ).toEqual([]);
}
