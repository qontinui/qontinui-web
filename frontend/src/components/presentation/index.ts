/**
 * presentation — the presentation lens over the operator console (plan
 * `2026-10-23-console-presentation-spaces`).
 *
 * D1: a presentation view is a LENS over the console, never a fork — the same
 * routes and the same data hooks, rendered with captions on, provenance on,
 * density down, controls off and redaction on. This barrel is every piece of
 * that lens. The pieces compose the console primitives
 * (`@/components/console`); nothing here fetches except the scope loader,
 * once, while presenting (D3.4).
 *
 * | Export | What it is |
 * |---|---|
 * | `PresentationLens` | what a layout mounts; the lens trees (`LENS_TREES`) are the console layout and the digital-twin layout |
 * | `PresentationShell` | the app shell's one mode provider, enabled on a lens-tree route, so the sidebar beside a lens page is in its mode |
 * | `PresentationPage`, `PRESENTATION_READY_ROUTES` | the gate around a lens page's body: in presentation mode a page renders only when registered as ready with the test that proves it; any other page is withheld (D3 fails closed) |
 * | `PresentationModeProvider`, `usePresentationMode`, `FixedPresentationMode` | the mode, resolved by D2's order (`?present=` wins, then the tab's choice, then the viewer's setting, then off); unresolved fails closed |
 * | `PresentationModeToggle` | the header control; the "Presentation mode" chip while presenting |
 * | `Caption` + `./captions` | captions from ONE registry composed of one file per lens surface (D5) |
 * | `LENS_SURFACES`, `TOUR_SURFACE` | the five lens pages in tour order, and the tour |
 * | `Provenance` | source + as-of beside a number; UNKNOWN when either is unknown |
 * | `OperatorOnly` | the boundary every write control sits inside (D3.2) |
 * | `RedactedText`, `useRedactor`, `PresentationScopeProvider` | free text only when provably first-party (D3.3); fails closed while the scope is unknown |
 * | `usePresentationScope`, `defaultPresentationScopeStore` | the tenant's scope, read from `GET /api/v1/presentation/scope` only while presenting — the lens's one read (D3.4) |
 * | `MachineName`, `useMachineName`, `useMachineAliaser` | "Machine A, B…" — one alias per machine across every panel and page (D3.3) |
 * | `CostFigure` | the only component that may render a per-task cost; never in presentation mode (D3.1) |
 * | `NAVIGATION_ONLY_PROPS` | marks a control whose press only changes what is displayed (D3.2) |
 * | `presenterSafetyProps`, `PRESENTER_SAFETY_CONTROLS` | marks one of the presenter's own safety controls — the closed list of controls besides navigation that presentation mode keeps live (D3.2) |
 *
 * The test helper that asserts a presentation-mode render is safe —
 * `renderInPresentationMode` / `expectPresentationSafe` — lives in
 * `src/test/presentation.tsx`.
 */

export { PresentationLens } from "./PresentationLens";
export { PresentationShell } from "./PresentationShell";
export type { PresentationShellProps } from "./PresentationShell";

export {
  PresentationPage,
  WITHHELD_PAGE_TEXT,
  WITHHELD_PAGE_TITLE,
} from "./PresentationPage";
export type { PresentationPageProps } from "./PresentationPage";

export {
  LENS_TREES,
  PRESENTATION_READY_ROUTES,
  isLensTreePath,
  isPresentationReady,
  normalizePath,
  routeMatches,
} from "./presentationReadiness";
export type { PresentationReadyRoute } from "./presentationReadiness";

export {
  FixedPresentationMode,
  PresentationModeProvider,
  usePresentationMode,
} from "./PresentationModeProvider";
export type {
  FixedPresentationModeProps,
  PresentationModeProviderProps,
  PresentationModeValue,
} from "./PresentationModeProvider";

export {
  PRESENTATION_TOGGLE_TITLE_OFF,
  PRESENTATION_TOGGLE_TITLE_ON,
  PresentationModeToggle,
} from "./PresentationModeToggle";
export type { PresentationModeToggleProps } from "./PresentationModeToggle";

export {
  PRESENT_PARAM,
  decodeChoice,
  encodeChoice,
  parsePresentParam,
  resolvePresentationMode,
} from "./presentationModeResolution";
export type {
  PresentationModeInputs,
  PresentationModeSource,
  ResolvedPresentationMode,
  StoredChoice,
} from "./presentationModeResolution";

export {
  PRESENTATION_MODE_STORAGE_KEY,
  UNREADABLE_SNAPSHOT,
  createPresentationModeStore,
  decodeStoreSnapshot,
  defaultPresentationModeStore,
} from "./presentationModeStore";
export type {
  PresentationModeStore,
  PresentationModeStoreOptions,
  RecordChoiceOptions,
  StorageGetter,
  StoredChoices,
} from "./presentationModeStore";

export { Caption, CaptionCopy } from "./Caption";
export type { CaptionProps } from "./Caption";

export {
  CAPTIONS,
  CAPTION_SURFACES,
  captionEntry,
  captionSegments,
  copy,
  isCaptionKey,
  term,
} from "./captions";
export type {
  CaptionEntry,
  CaptionKey,
  CaptionSegment,
  CaptionSurfaceId,
  CaptionTermSegment,
  CaptionText,
  SurfaceCaptions,
} from "./captions";

export {
  LENS_SURFACES,
  TOUR_SURFACE,
  lensSurfaceForPath,
  presentationHref,
} from "./lensSurfaces";
export type { LensSurface, LensSurfaceId } from "./lensSurfaces";

export {
  PROVENANCE_UNKNOWN,
  Provenance,
  provenanceInstant,
} from "./Provenance";
export type { ProvenanceProps } from "./Provenance";

export {
  PRESENTATION_CLOCK_TICK_MS,
  usePresentationClock,
} from "./presentationClock";

export { OperatorOnly } from "./OperatorOnly";
export type { OperatorOnlyProps } from "./OperatorOnly";

export {
  PRESENTATION_SCOPE_UNKNOWN,
  PresentationScopeProvider,
  usePresentationScopeState,
} from "./presentationScope";
export type {
  PresentationScope,
  PresentationScopeProviderProps,
  PresentationScopeState,
} from "./presentationScope";

export {
  PRESENTATION_SCOPE_MAX_AGE_MS,
  PRESENTATION_SCOPE_RETRY_MS,
  createPresentationScopeStore,
  defaultPresentationScopeStore,
  presentationScopeStateOf,
  usePresentationScope,
  usePresentationScopeSnapshot,
} from "./presentationScopeLoader";
export type {
  PresentationScopeSnapshot,
  PresentationScopeStore,
  PresentationScopeStoreOptions,
} from "./presentationScopeLoader";

export {
  WITHHELD,
  containsConfidentialTerm,
  describeRedacted,
  normalizeForMatch,
  redactionVerdict,
  repoOwnerOf,
} from "./redaction";
export type {
  RedactionDescriptor,
  RedactionInput,
  RedactionReason,
  RedactionVerdict,
} from "./redaction";

export { RedactedText, useRedactor } from "./RedactedText";
export type { RedactedTextProps, RedactorItem } from "./RedactedText";

export {
  MACHINE_ALIAS_STORAGE_KEY,
  MachineAliasRegistry,
  UNIDENTIFIED_MACHINE,
  aliasLabel,
  aliasLetters,
  machineIdentityKeys,
  sessionMachineAliases,
} from "./machineAliases";
export type {
  MachineAliasRegistryOptions,
  MachineIdentity,
} from "./machineAliases";

export {
  MachineName,
  SERVER_MACHINE_ALIAS,
  UNKNOWN_MACHINE_NAME,
  useMachineAliaser,
  useMachineName,
} from "./MachineName";
export type { MachineNameProps } from "./MachineName";

// `formatCostAmount` is deliberately NOT exported here: it formats a figure
// WITHOUT the label, so only `CostFigure` may call it (`costRenderScan.ts`
// fails an import of it, under any name, anywhere else).
export {
  COST_EQUIVALENT_LABEL,
  COST_WITHHELD_TEXT,
  CostFigure,
  coverageText,
} from "./CostFigure";
export type { CostCoverage, CostFigureProps, CostSource } from "./CostFigure";

export {
  NAVIGATION_ONLY_ATTRIBUTE,
  NAVIGATION_ONLY_PROPS,
} from "@/components/console/navigationOnly";

export {
  PRESENTER_SAFETY_ATTRIBUTE,
  PRESENTER_SAFETY_CONTROLS,
  isPresenterSafetyControl,
  presenterSafetyProps,
} from "@/components/console/presenterSafety";
export type { PresenterSafetyControl } from "@/components/console/presenterSafety";
