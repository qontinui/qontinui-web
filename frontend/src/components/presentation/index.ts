/**
 * presentation — the presentation lens over the operator console (plan
 * `2026-10-23-console-presentation-spaces`).
 *
 * D1: a presentation view is a LENS over the console, never a fork — the same
 * routes and the same data hooks, rendered with captions on, provenance on,
 * density down, controls off and redaction on. This barrel is every piece of
 * that lens. The pieces compose the console primitives
 * (`@/components/console`); nothing here fetches (D3.4).
 *
 * | Export | What it is |
 * |---|---|
 * | `PresentationLens` | what a layout mounts; the lens trees are the console layout and the digital-twin layout |
 * | `PresentationModeProvider`, `usePresentationMode`, `FixedPresentationMode` | the mode, resolved by D2's order (`?present=` wins, then the tab's choice, then the viewer's setting, then off); unresolved fails closed |
 * | `PresentationModeToggle` | the header control; the "Presentation mode" chip while presenting |
 * | `Caption` + `./captions` | captions from ONE registry composed of one file per lens surface (D5) |
 * | `LENS_SURFACES`, `TOUR_SURFACE` | the five lens pages in tour order, and the tour |
 * | `Provenance` | source + as-of beside a number; UNKNOWN when either is unknown |
 * | `HeadlineFigures` | a lens page's few screen-share-sized figures, each known with its as-of or UNKNOWN with the reason |
 * | `SectionCaption` | a section's caption plus one provenance chip per source behind its numbers |
 * | `OperatorOnly` | the boundary every write control sits inside (D3.2) |
 * | `RedactedText`, `useRedactor`, `PresentationScopeProvider` | free text only when provably first-party (D3.3); fails closed while the scope is unknown |
 * | `MachineName`, `useMachineName`, `useMachineAliaser` | "Machine A, B…" — one alias per machine across every panel and page (D3.3) |
 * | `CostFigure` | the only component that may render a per-task cost; never in presentation mode (D3.1) |
 * | `NAVIGATION_ONLY_PROPS` | marks a control whose press only changes what is displayed (D3.2) |
 *
 * The test helper that asserts a presentation-mode render is safe —
 * `renderInPresentationMode` / `expectPresentationSafe` — lives in
 * `src/test/presentation.tsx`.
 */

export { PresentationLens } from "./PresentationLens";

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

export { PresentationModeToggle } from "./PresentationModeToggle";
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

export { HeadlineFigures } from "./HeadlineFigures";
export type {
  HeadlineFigure,
  HeadlineFiguresProps,
  HeadlineValue,
} from "./HeadlineFigures";

export { SectionCaption } from "./SectionCaption";
export type { SectionCaptionProps, SectionSource } from "./SectionCaption";

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

export {
  COST_EQUIVALENT_LABEL,
  COST_WITHHELD_TEXT,
  CostFigure,
  coverageText,
  formatCostAmount,
} from "./CostFigure";
export type { CostCoverage, CostFigureProps, CostSource } from "./CostFigure";

export {
  NAVIGATION_ONLY_ATTRIBUTE,
  NAVIGATION_ONLY_PROPS,
} from "@/components/console/navigationOnly";
