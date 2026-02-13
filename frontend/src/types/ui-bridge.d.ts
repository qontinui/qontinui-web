/**
 * Type declarations for @qontinui/ui-bridge subpath imports.
 *
 * The ui-bridge package is linked via file: protocol but may not have
 * its dist/ directory built. These declarations allow TypeScript to
 * resolve the subpath imports without requiring a build step.
 */

// =============================================================================
// @qontinui/ui-bridge/core
// =============================================================================
declare module "@qontinui/ui-bridge/core" {
  export interface ElementState {
    visible: boolean;
    enabled: boolean;
    focused: boolean;
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    value?: string;
    checked?: boolean;
    selectedOptions?: string[];
    textContent?: string;
    innerHTML?: string;
    computedStyles?: {
      display: string;
      visibility: string;
      opacity: string;
      pointerEvents: string;
    };
  }

  export type ElementType =
    | "button"
    | "input"
    | "select"
    | "checkbox"
    | "radio"
    | "link"
    | "form"
    | "textarea"
    | "menu"
    | "menuitem"
    | "tab"
    | "dialog"
    | "custom"
    | "switch"
    | "slider"
    | "combobox"
    | "listbox"
    | "option"
    | "textbox"
    | "generic";

  export interface UIBridgeFeatures {
    renderLog?: boolean;
    control?: boolean;
    debug?: boolean;
  }

  export interface UIBridgeConfig {
    serverPort?: number;
    apiPath?: string;
    websocket?: boolean;
    websocketPort?: number;
    logFilePath?: string;
    maxLogEntries?: number;
    verbose?: boolean;
  }

  export interface UIState {
    id: string;
    name: string;
    elements: string[];
    activeWhen?: () => boolean;
    blocking?: boolean;
    blocks?: string[];
    group?: string;
    pathCost?: number;
    metadata?: Record<string, unknown>;
  }

  export interface UIStateGroup {
    id: string;
    name: string;
    states: string[];
  }

  export interface UITransition {
    id: string;
    name: string;
    fromStates: string[];
    activateStates: string[];
    exitStates: string[];
    activateGroups?: string[];
    exitGroups?: string[];
    actions?: unknown[];
    pathCost?: number;
    staysVisible?: boolean;
  }

  export interface PathResult {
    found: boolean;
    transitions: string[];
    totalCost: number;
    targetStates: string[];
    estimatedSteps: number;
  }

  export interface TransitionResult {
    success: boolean;
    activatedStates: string[];
    deactivatedStates: string[];
    error?: string;
    failedPhase?: string;
    durationMs: number;
  }

  export interface NavigationResult {
    success: boolean;
    path: PathResult;
    executedTransitions: string[];
    finalActiveStates: string[];
    error?: string;
    durationMs: number;
  }

  export interface StateSnapshot {
    timestamp: number;
    activeStates: string[];
    states: UIState[];
    groups: UIStateGroup[];
    transitions: UITransition[];
  }

  export class UIBridgeWSClient {
    constructor(config: unknown);
  }
  export function createWSClient(config: unknown): UIBridgeWSClient;
}

// =============================================================================
// @qontinui/ui-bridge/react
// =============================================================================
declare module "@qontinui/ui-bridge/react" {
  import type { ReactNode } from "react";

  export interface UIBridgeProviderProps {
    children: ReactNode;
    features?: {
      renderLog?: boolean;
      control?: boolean;
      debug?: boolean;
    };
    config?: {
      serverPort?: number;
      apiPath?: string;
      websocket?: boolean;
      websocketPort?: number;
      logFilePath?: string;
      maxLogEntries?: number;
      verbose?: boolean;
    };
  }

  export interface UIBridgeContextValue {
    registry: unknown;
    features: {
      renderLog?: boolean;
      control?: boolean;
      debug?: boolean;
    };
    config: unknown;
    renderLog?: {
      captureSnapshot: (metadata?: Record<string, unknown>) => Promise<void>;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export function UIBridgeProvider(props: UIBridgeProviderProps): ReactNode;
  export function useUIBridgeContext(): UIBridgeContextValue;
  export function useUIBridgeOptional(): UIBridgeContextValue | null;

  export interface RegisteredElementInfo {
    id: string;
    type: string;
    label?: string;
    actions: string[];
    getState: () => import("@qontinui/ui-bridge/core").ElementState;
    getIdentifier: () => unknown;
    mounted: boolean;
    aliases?: string[];
    description?: string;
    semanticType?: string;
    purpose?: string;
    element: HTMLElement;
    [key: string]: unknown;
  }

  export interface UseUIBridgeReturn {
    registry: unknown;
    features: unknown;
    config: unknown;
    elements: RegisteredElementInfo[];
    getElement: (id: string) => RegisteredElementInfo | undefined;
    [key: string]: unknown;
  }

  export function useUIBridge(): UseUIBridgeReturn;
  export function useUIBridgeRequired(): UseUIBridgeReturn;

  export interface AutoRegisterProviderProps {
    children: ReactNode;
    enabled?: boolean;
    idStrategy?: string;
    rootSelector?: string;
    debounceMs?: number;
    excludeSelectors?: string[];
    [key: string]: unknown;
  }

  export function AutoRegisterProvider(
    props: AutoRegisterProviderProps
  ): ReactNode;
  export function useUIAnnotation(
    elementId: string,
    annotation: unknown
  ): void;
}

// =============================================================================
// @qontinui/ui-bridge/control
// =============================================================================
declare module "@qontinui/ui-bridge/control" {
  import type { ElementState } from "@qontinui/ui-bridge/core";

  export interface ControlActionRequest {
    action: string;
    params?: Record<string, unknown>;
    waitOptions?: unknown;
    requestId?: string;
    captureAfter?: boolean;
    retryOptions?: {
      maxRetries: number;
      retryDelay: number;
      retryOn?: ("timeout" | "notFound" | "disabled" | "error")[];
    };
  }

  export interface ControlActionResponse {
    success: boolean;
    elementState?: ElementState;
    result?: unknown;
    error?: string;
    stack?: string;
    durationMs: number;
    timestamp: number;
    requestId?: string;
    snapshot?: unknown;
    retryCount?: number;
    waitDurationMs?: number;
  }

  export interface ComponentActionRequest {
    action: string;
    params?: Record<string, unknown>;
    requestId?: string;
  }

  export interface ComponentActionResponse {
    success: boolean;
    result?: unknown;
    error?: string;
    stack?: string;
    durationMs: number;
    timestamp: number;
    requestId?: string;
  }

  export interface FindRequest {
    root?: string;
    interactiveOnly?: boolean;
    includeHidden?: boolean;
    limit?: number;
    types?: string[];
    selector?: string;
  }

  export interface DiscoveredElement {
    id: string;
    type: string;
    label?: string;
    tagName: string;
    role?: string;
    accessibleName?: string;
    actions: string[];
    state: ElementState;
    registered: boolean;
  }

  export interface FindResponse {
    elements: DiscoveredElement[];
    total: number;
    durationMs: number;
    timestamp: number;
  }

  export interface WorkflowRunRequest {
    params?: Record<string, unknown>;
    requestId?: string;
    startStep?: string;
    stopStep?: string;
    stepTimeout?: number;
    workflowTimeout?: number;
  }

  export type WorkflowRunStatus =
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";

  export interface WorkflowRunResponse {
    workflowId: string;
    runId: string;
    status: WorkflowRunStatus;
    steps: unknown[];
    currentStep?: number;
    totalSteps: number;
    success?: boolean;
    error?: string;
    startedAt: number;
    completedAt?: number;
    durationMs?: number;
  }

  export interface ControlSnapshot {
    timestamp: number;
    elements: Array<{
      id: string;
      type: string;
      label?: string;
      actions: string[];
      state: ElementState;
    }>;
    components: Array<{
      id: string;
      name: string;
      actions: string[];
    }>;
    workflows: Array<{
      id: string;
      name: string;
      stepCount: number;
    }>;
    activeRuns: Array<{
      runId: string;
      workflowId: string;
      status: WorkflowRunStatus;
      currentStep: number;
      totalSteps: number;
    }>;
  }

  export class DefaultActionExecutor {
    constructor(registry: unknown);
  }
  export function createActionExecutor(registry: unknown): DefaultActionExecutor;

  export class DefaultWorkflowEngine {
    constructor(registry: unknown);
  }
  export function createWorkflowEngine(
    registry: unknown
  ): DefaultWorkflowEngine;
}

// =============================================================================
// @qontinui/ui-bridge/server
// =============================================================================
declare module "@qontinui/ui-bridge/server" {
  import type {
    ControlActionRequest,
    ControlActionResponse,
    ComponentActionRequest,
    ComponentActionResponse,
    FindRequest,
    FindResponse,
    ControlSnapshot,
    WorkflowRunRequest,
    WorkflowRunResponse,
  } from "@qontinui/ui-bridge/control";
  import type { RenderLogEntry, RenderLogEntryType } from "@qontinui/ui-bridge/render-log";
  import type {
    SearchCriteria,
    SearchResponse,
    NLActionRequest,
    NLActionResponse,
    AssertionRequest,
    AssertionResult,
    BatchAssertionRequest,
    BatchAssertionResult,
    SemanticSnapshot,
    SemanticDiff,
    SemanticSearchCriteria,
    SemanticSearchResponse,
  } from "@qontinui/ui-bridge/ai";
  import type {
    ElementAnnotation,
    AnnotationConfig,
    AnnotationCoverage,
  } from "@qontinui/ui-bridge/annotations";

  export interface APIResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    code?: string;
    timestamp: number;
  }

  export interface RenderLogQuery {
    type?: RenderLogEntryType;
    since?: number;
    until?: number;
    limit?: number;
  }

  export interface UIBridgeServerHandlers {
    getRenderLog: (
      query?: RenderLogQuery
    ) => Promise<APIResponse<RenderLogEntry[]>>;
    clearRenderLog: () => Promise<APIResponse<void>>;
    captureSnapshot: () => Promise<APIResponse<unknown>>;
    getRenderLogPath: () => Promise<APIResponse<{ path: string }>>;
    getElements: () => Promise<APIResponse<ControlSnapshot["elements"]>>;
    getElement: (
      id: string
    ) => Promise<APIResponse<ControlSnapshot["elements"][0]>>;
    getElementState: (id: string) => Promise<APIResponse<unknown>>;
    executeElementAction: (
      id: string,
      request: ControlActionRequest
    ) => Promise<APIResponse<ControlActionResponse>>;
    getComponents: () => Promise<APIResponse<ControlSnapshot["components"]>>;
    getComponent: (
      id: string
    ) => Promise<APIResponse<ControlSnapshot["components"][0]>>;
    getComponentState: (
      id: string
    ) => Promise<
      APIResponse<{
        state: Record<string, unknown>;
        computed: Record<string, unknown>;
        timestamp: number;
      }>
    >;
    executeComponentAction: (
      id: string,
      request: ComponentActionRequest
    ) => Promise<APIResponse<ComponentActionResponse>>;
    find: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
    discover: (request?: FindRequest) => Promise<APIResponse<FindResponse>>;
    getControlSnapshot: () => Promise<APIResponse<ControlSnapshot>>;
    getWorkflows: () => Promise<APIResponse<ControlSnapshot["workflows"]>>;
    runWorkflow: (
      id: string,
      request?: WorkflowRunRequest
    ) => Promise<APIResponse<WorkflowRunResponse>>;
    getWorkflowStatus: (
      runId: string
    ) => Promise<APIResponse<WorkflowRunResponse>>;
    getActionHistory: (limit?: number) => Promise<APIResponse<unknown[]>>;
    getMetrics: () => Promise<APIResponse<unknown>>;
    highlightElement: (id: string) => Promise<APIResponse<void>>;
    getElementTree: () => Promise<APIResponse<unknown>>;
    aiSearch: (
      criteria: SearchCriteria
    ) => Promise<APIResponse<SearchResponse>>;
    aiExecute: (
      request: NLActionRequest
    ) => Promise<APIResponse<NLActionResponse>>;
    aiAssert: (
      request: AssertionRequest
    ) => Promise<APIResponse<AssertionResult>>;
    aiAssertBatch: (
      request: BatchAssertionRequest
    ) => Promise<APIResponse<BatchAssertionResult>>;
    getSemanticSnapshot: () => Promise<APIResponse<SemanticSnapshot>>;
    getSemanticDiff: (
      since?: number
    ) => Promise<APIResponse<SemanticDiff | null>>;
    getPageSummary: () => Promise<APIResponse<string>>;
    aiSemanticSearch: (
      criteria: SemanticSearchCriteria
    ) => Promise<APIResponse<SemanticSearchResponse>>;
    getAnnotations: () => Promise<
      APIResponse<Record<string, ElementAnnotation>>
    >;
    getAnnotation: (id: string) => Promise<APIResponse<ElementAnnotation>>;
    setAnnotation: (
      id: string,
      annotation: ElementAnnotation
    ) => Promise<APIResponse<ElementAnnotation>>;
    deleteAnnotation: (id: string) => Promise<APIResponse<void>>;
    importAnnotations: (
      config: AnnotationConfig
    ) => Promise<APIResponse<{ count: number }>>;
    exportAnnotations: () => Promise<APIResponse<AnnotationConfig>>;
    getAnnotationCoverage: () => Promise<APIResponse<AnnotationCoverage>>;
  }

  export interface RegistryLike {
    [key: string]: unknown;
  }

  export interface ActionExecutorLike {
    [key: string]: unknown;
  }

  export interface CreateHandlersConfig {
    registry: RegistryLike;
    actionExecutor?: ActionExecutorLike;
    [key: string]: unknown;
  }

  export function createHandlers(config: CreateHandlersConfig): UIBridgeServerHandlers;
  export function createAIHandlers(config: CreateHandlersConfig): Partial<UIBridgeServerHandlers>;
}

// =============================================================================
// @qontinui/ui-bridge/server/nextjs
// =============================================================================
declare module "@qontinui/ui-bridge/server/nextjs" {
  import type { UIBridgeServerHandlers } from "@qontinui/ui-bridge/server";

  export interface NextJSAdapterConfig {
    handlers: UIBridgeServerHandlers;
    basePath?: string;
    [key: string]: unknown;
  }

  export type NextRouteHandler = (
    request: Request,
    context: unknown
  ) => Promise<Response>;

  export function createNextRouteHandlers(
    handlers: unknown,
    options?: Record<string, unknown>
  ): { GET: NextRouteHandler; POST: NextRouteHandler; PUT: NextRouteHandler; DELETE: NextRouteHandler };

  export function createRenderLogHandlers(
    config: unknown
  ): Record<string, unknown>;
  export function createControlHandlers(
    config: unknown
  ): Record<string, unknown>;
  export function createDebugHandlers(
    config: unknown
  ): Record<string, unknown>;
}

// =============================================================================
// @qontinui/ui-bridge/render-log
// =============================================================================
declare module "@qontinui/ui-bridge/render-log" {
  export type RenderLogEntryType =
    | "snapshot"
    | "change"
    | "navigation"
    | "interaction"
    | "error";

  export interface RenderLogEntry {
    id: string;
    type: RenderLogEntryType;
    timestamp: number;
    data: unknown;
  }

  export interface SnapshotEntry extends RenderLogEntry {
    type: "snapshot";
  }

  export interface ChangeEntry extends RenderLogEntry {
    type: "change";
  }

  export interface NavigationEntry extends RenderLogEntry {
    type: "navigation";
  }

  export interface InteractionEntry extends RenderLogEntry {
    type: "interaction";
  }

  export interface ErrorEntry extends RenderLogEntry {
    type: "error";
  }

  export interface RenderLogStorage {
    [key: string]: unknown;
  }

  export interface RenderLogOptions {
    maxEntries?: number;
    [key: string]: unknown;
  }

  export class RenderLogManager {
    constructor(options?: RenderLogOptions);
  }

  export class InMemoryRenderLogStorage implements RenderLogStorage {
    [key: string]: unknown;
  }

  export function createRenderLogManager(
    options?: RenderLogOptions
  ): RenderLogManager;

  export interface CapturedElement {
    [key: string]: unknown;
  }

  export interface DOMSnapshot {
    [key: string]: unknown;
  }

  export interface DOMChange {
    [key: string]: unknown;
  }

  export interface CaptureOptions {
    [key: string]: unknown;
  }

  export function captureDOMSnapshot(options?: CaptureOptions): DOMSnapshot;
  export function captureInteractiveElements(
    root?: Element
  ): CapturedElement[];

  export class DOMChangeObserver {
    constructor(callback: (changes: DOMChange[]) => void);
  }
}

// =============================================================================
// @qontinui/ui-bridge/annotations
// =============================================================================
declare module "@qontinui/ui-bridge/annotations" {
  export interface ElementAnnotation {
    elementId: string;
    label?: string;
    description?: string;
    category?: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface AnnotationConfig {
    version: string;
    annotations: Record<string, ElementAnnotation>;
    metadata?: Record<string, unknown>;
  }

  export interface AnnotationCoverage {
    totalElements: number;
    annotatedElements: number;
    coveragePercent: number;
    byCategory: Record<string, number>;
  }

  export type AnnotationEventType = "add" | "update" | "remove" | "clear";

  export interface AnnotationEvent {
    type: AnnotationEventType;
    elementId?: string;
    annotation?: ElementAnnotation;
    timestamp: number;
  }

  export const ANNOTATION_CONFIG_VERSION: string;

  export type AnnotationListener = (event: AnnotationEvent) => void;

  export class AnnotationStore {
    get(id: string): ElementAnnotation | undefined;
    set(id: string, annotation: ElementAnnotation): void;
    delete(id: string): boolean;
    getAll(): Record<string, ElementAnnotation>;
    clear(): void;
    subscribe(listener: AnnotationListener): () => void;
    getCoverage(totalElements: number): AnnotationCoverage;
    importConfig(config: AnnotationConfig): number;
    exportConfig(): AnnotationConfig;
  }

  export function getGlobalAnnotationStore(): AnnotationStore;
  export function resetGlobalAnnotationStore(): void;
}

// =============================================================================
// @qontinui/ui-bridge/ai
// =============================================================================
declare module "@qontinui/ui-bridge/ai" {
  import type { ElementState } from "@qontinui/ui-bridge/core";

  export interface SearchCriteria {
    text?: string;
    textContent?: string;
    textContains?: string;
    accessibleName?: string;
    role?: string;
    type?: string;
    near?: string;
    within?: string;
    fuzzy?: boolean;
    fuzzyThreshold?: number;
    idPattern?: string;
    selector?: string;
    placeholder?: string;
    title?: string;
    dataAttributes?: Record<string, string>;
  }

  export interface SearchResult {
    element: AIDiscoveredElement;
    confidence: number;
    matchReasons: string[];
    scores: {
      text?: number;
      accessibility?: number;
      role?: number;
      spatial?: number;
      fuzzy?: number;
    };
  }

  export interface SearchResponse {
    results: SearchResult[];
    bestMatch: SearchResult | null;
    scannedCount: number;
    durationMs: number;
    criteria: SearchCriteria;
    timestamp: number;
  }

  export interface AIDiscoveredElement {
    id: string;
    type: string;
    label?: string;
    tagName: string;
    role?: string;
    accessibleName?: string;
    actions: string[];
    state: ElementState;
    registered: boolean;
    description: string;
    aliases: string[];
    purpose?: string;
    parentContext?: string;
    suggestedActions: string[];
    semanticType?: string;
    labelText?: string;
    placeholder?: string;
    title?: string;
    ariaDescription?: string;
  }

  export interface AIFindResponse {
    elements: AIDiscoveredElement[];
    summary: string;
    forms?: FormAnalysis[];
    pageContext: PageContext;
    durationMs: number;
    timestamp: number;
  }

  export interface PageContext {
    url: string;
    title: string;
    pageType?: string;
    activeModals: string[];
    focusedElement?: string;
    navigation?: string[];
  }

  export interface FormAnalysis {
    id: string;
    name?: string;
    purpose?: string;
    fields: FormFieldAnalysis[];
    isValid: boolean;
    submitButton?: string;
    cancelButton?: string;
  }

  export interface FormFieldAnalysis {
    id: string;
    label: string;
    type: string;
    value: string;
    valid: boolean;
    error?: string;
    required: boolean;
    placeholder?: string;
  }

  export interface NLActionRequest {
    instruction: string;
    context?: string;
    timeout?: number;
    confidenceThreshold?: number;
  }

  export interface ParsedAction {
    action: string;
    targetDescription: string;
    value?: string;
    modifiers?: string[];
    scrollDirection?: string;
    waitCondition?: string;
    assertionType?: AssertionType;
    rawInstruction: string;
    parseConfidence: number;
  }

  export interface NLActionResponse {
    success: boolean;
    executedAction: string;
    elementUsed: AIDiscoveredElement;
    confidence: number;
    elementState: ElementState;
    durationMs: number;
    timestamp: number;
    error?: string;
    errorCode?: string;
    suggestions?: string[];
    alternatives?: SearchResult[];
    failureInfo?: unknown;
  }

  export type AssertionType =
    | "visible"
    | "hidden"
    | "enabled"
    | "disabled"
    | "focused"
    | "checked"
    | "unchecked"
    | "hasText"
    | "containsText"
    | "hasValue"
    | "hasClass"
    | "exists"
    | "notExists"
    | "count"
    | "attribute"
    | "cssProperty";

  export interface AssertionRequest {
    target: string | SearchCriteria;
    type: AssertionType;
    expected?: unknown;
    attributeName?: string;
    propertyName?: string;
    timeout?: number;
    message?: string;
    fuzzy?: boolean;
  }

  export interface AssertionResult {
    passed: boolean;
    target: string;
    targetDescription: string;
    expected: unknown;
    actual: unknown;
    failureReason?: string;
    suggestion?: string;
    elementState?: ElementState;
    durationMs: number;
    timestamp: number;
  }

  export interface BatchAssertionRequest {
    assertions: AssertionRequest[];
    mode: "all" | "any";
    stopOnFailure?: boolean;
  }

  export interface BatchAssertionResult {
    passed: boolean;
    results: AssertionResult[];
    passedCount: number;
    failedCount: number;
    durationMs: number;
    timestamp: number;
  }

  export interface SemanticSnapshot {
    timestamp: number;
    snapshotId: string;
    page: PageContext;
    elements: AIDiscoveredElement[];
    forms: FormState[];
    activeModals: ModalState[];
    focusedElement?: string;
    summary: string;
    elementCounts: Record<string, number>;
  }

  export interface FormState {
    id: string;
    name?: string;
    purpose?: string;
    fields: FormFieldState[];
    isValid: boolean;
    submitButton?: string;
    isDirty: boolean;
  }

  export interface FormFieldState {
    id: string;
    label: string;
    type: string;
    value: string;
    valid: boolean;
    error?: string;
    required: boolean;
    touched: boolean;
  }

  export interface ModalState {
    id: string;
    title?: string;
    type: "dialog" | "alert" | "confirm" | "prompt" | "drawer" | "popup";
    blocking: boolean;
    closeButton?: string;
    primaryAction?: string;
    secondaryAction?: string;
  }

  export interface SemanticDiff {
    summary: string;
    fromSnapshotId: string;
    toSnapshotId: string;
    changes: {
      appeared: ElementChange[];
      disappeared: ElementChange[];
      modified: ElementModification[];
    };
    probableTrigger?: string;
    suggestedActions?: string[];
    pageChanges?: {
      urlChanged: boolean;
      titleChanged: boolean;
      newUrl?: string;
      newTitle?: string;
    };
    durationMs: number;
    timestamp: number;
  }

  export interface ElementChange {
    elementId: string;
    description: string;
    type: string;
    semanticType?: string;
  }

  export interface ElementModification {
    elementId: string;
    description: string;
    property: string;
    from: string;
    to: string;
    significant: boolean;
  }

  export interface AIErrorContext {
    code: string;
    message: string;
    attemptedAction: string;
    searchCriteria?: SearchCriteria;
    searchResults: {
      candidatesFound: number;
      nearestMatch?: {
        element: AIDiscoveredElement;
        confidence: number;
        whyNotSelected: string;
      };
    };
    pageContext: {
      url: string;
      title: string;
      visibleElements: number;
      possibleBlockers: string[];
    };
    suggestions: RecoverySuggestion[];
    stack?: string;
    timestamp: number;
  }

  export interface RecoverySuggestion {
    action: string;
    command?: string;
    confidence: number;
    priority: number;
  }

  export interface AIElementRegistrationOptions {
    aliases?: string[];
    description?: string;
    semanticType?: string;
    purpose?: string;
    autoGenerateAliases?: boolean;
  }

  export interface SemanticSearchCriteria {
    query: string;
    threshold?: number;
    limit?: number;
    type?: string;
    role?: string;
    combineWithText?: boolean;
  }

  export interface SemanticSearchResult {
    element: AIDiscoveredElement;
    similarity: number;
    rank: number;
    embeddedText: string;
  }

  export interface SemanticSearchResponse {
    results: SemanticSearchResult[];
    bestMatch: SemanticSearchResult | null;
    scannedCount: number;
    durationMs: number;
    query: string;
    providerInfo?: {
      provider: string;
      model: string;
      dimension: number;
    };
    timestamp: number;
  }

  // Fuzzy Matcher
  export function levenshteinDistance(a: string, b: string): number;
  export function levenshteinSimilarity(a: string, b: string): number;
  export function jaroSimilarity(a: string, b: string): number;
  export function jaroWinklerSimilarity(a: string, b: string): number;
  export function generateNgrams(str: string, n: number): string[];
  export function ngramSimilarity(a: string, b: string, n?: number): number;
  export function normalizeString(str: string): string;

  export interface FuzzyMatchConfig {
    [key: string]: unknown;
  }

  export interface FuzzyMatchResult {
    matched: boolean;
    score: number;
    [key: string]: unknown;
  }

  export function fuzzyMatch(
    query: string,
    target: string,
    config?: FuzzyMatchConfig
  ): FuzzyMatchResult;
  export function findBestMatch(
    query: string,
    targets: string[],
    config?: FuzzyMatchConfig
  ): FuzzyMatchResult | null;
  export function findAllMatches(
    query: string,
    targets: string[],
    config?: FuzzyMatchConfig
  ): FuzzyMatchResult[];
  export function fuzzyContains(
    query: string,
    target: string,
    config?: FuzzyMatchConfig
  ): boolean;
  export function wordSimilarity(a: string, b: string): number;
  export function tokenize(str: string): string[];
  export function tokenSimilarity(a: string, b: string): number;
  export const DEFAULT_FUZZY_CONFIG: FuzzyMatchConfig;

  // Search Engine
  export interface SearchEngineConfig {
    [key: string]: unknown;
  }

  export class SearchEngine {
    search(criteria: SearchCriteria): SearchResponse;
    updateElements(elements: unknown[]): void;
  }

  export function createSearchEngine(
    registry: unknown,
    config?: SearchEngineConfig
  ): SearchEngine;
  export const DEFAULT_SEARCH_CONFIG: SearchEngineConfig;

  // NL Action Parser
  export function parseNLInstruction(instruction: string): ParsedAction;
  export function parseNLInstructions(instructions: string): ParsedAction[];
  export function splitCompoundInstruction(instruction: string): string[];
  export function extractModifiers(
    instruction: string
  ): { modifiers: string[]; cleaned: string };
  export function validateParsedAction(action: ParsedAction): boolean;
  export function describeAction(action: ParsedAction): string;

  // NL Action Executor
  export interface NLActionExecutorConfig {
    [key: string]: unknown;
  }

  export class NLActionExecutor {
    execute(request: NLActionRequest): Promise<NLActionResponse>;
  }

  export function createNLActionExecutor(
    registry: unknown,
    config?: NLActionExecutorConfig
  ): NLActionExecutor;
  export const DEFAULT_EXECUTOR_CONFIG: NLActionExecutorConfig;

  // Assertions
  export interface AssertionConfig {
    [key: string]: unknown;
  }

  export class AssertionExecutor {
    assert(request: AssertionRequest): Promise<AssertionResult>;
    assertBatch(request: BatchAssertionRequest): Promise<BatchAssertionResult>;
    updateElements(elements: unknown[]): void;
  }

  export function createAssertionExecutor(
    registry: unknown,
    config?: AssertionConfig
  ): AssertionExecutor;
  export const DEFAULT_ASSERTION_CONFIG: AssertionConfig;

  // Semantic Snapshot
  export interface SemanticSnapshotConfig {
    [key: string]: unknown;
  }

  export class SemanticSnapshotManager {
    capture(): Promise<SemanticSnapshot>;
    createSnapshot(input: unknown): Promise<SemanticSnapshot>;
  }

  export function createSnapshotManager(
    registry: unknown,
    config?: SemanticSnapshotConfig
  ): SemanticSnapshotManager;
  export const DEFAULT_SNAPSHOT_CONFIG: SemanticSnapshotConfig;

  // Semantic Diff
  export interface SemanticDiffConfig {
    [key: string]: unknown;
  }

  export function computeDiff(
    from: SemanticSnapshot,
    to: SemanticSnapshot
  ): SemanticDiff;

  export class SemanticDiffManager {
    diff(from: SemanticSnapshot, to: SemanticSnapshot): SemanticDiff;
  }

  export function createDiffManager(
    config?: SemanticDiffConfig
  ): SemanticDiffManager;
  export function hasSignificantChanges(diff: SemanticDiff): boolean;
  export function describeDiff(diff: SemanticDiff): string;
  export const DEFAULT_DIFF_CONFIG: SemanticDiffConfig;

  // Error Context
  export type ErrorCode = string;
  export const ErrorCodes: Record<string, string>;
  export function createErrorContext(params: unknown): AIErrorContext;
  export function formatErrorContext(context: AIErrorContext): string;
  export function createSimpleError(
    code: string,
    message: string
  ): AIErrorContext;
  export function isRecoverableError(context: AIErrorContext): boolean;
  export function getBestRecoverySuggestion(
    context: AIErrorContext
  ): RecoverySuggestion | null;

  // Alias Generator
  export interface AliasGeneratorConfig {
    [key: string]: unknown;
  }
  export interface AliasGeneratorInput {
    [key: string]: unknown;
  }
  export function generateAliases(input: AliasGeneratorInput): string[];
  export function generateDescription(input: AliasGeneratorInput): string;
  export function generatePurpose(input: AliasGeneratorInput): string;
  export function generateSuggestedActions(
    input: AliasGeneratorInput
  ): string[];
  export function getSynonyms(word: string): string[];
  export function areSynonyms(a: string, b: string): boolean;
  export const DEFAULT_ALIAS_CONFIG: AliasGeneratorConfig;

  // Summary Generator
  export interface SummaryConfig {
    [key: string]: unknown;
  }
  export function generatePageSummary(snapshot: SemanticSnapshot): string;
  export function generateElementDescription(
    element: AIDiscoveredElement
  ): string;
  export function generateSnapshotSummary(snapshot: SemanticSnapshot): string;
  export function generateDiffSummary(diff: SemanticDiff): string;
  export function inferPageType(
    snapshot: SemanticSnapshot
  ): string;
}

// =============================================================================
// @qontinui/ui-bridge/specs
// =============================================================================
declare module "@qontinui/ui-bridge/specs" {
  export type AssertionType =
    | "visible"
    | "hidden"
    | "enabled"
    | "disabled"
    | "focused"
    | "checked"
    | "unchecked"
    | "hasText"
    | "containsText"
    | "hasValue"
    | "hasClass"
    | "exists"
    | "notExists"
    | "count"
    | "attribute"
    | "cssProperty";

  export interface SearchCriteria {
    text?: string;
    textContent?: string;
    textContains?: string;
    accessibleName?: string;
    role?: string;
    type?: string;
    near?: string;
    within?: string;
    fuzzy?: boolean;
    fuzzyThreshold?: number;
    idPattern?: string;
    selector?: string;
    placeholder?: string;
    title?: string;
    dataAttributes?: Record<string, string>;
  }

  export type SpecCategory =
    | "element-presence"
    | "accessibility"
    | "form-validation"
    | "state-consistency"
    | "modal-dialog"
    | "navigation"
    | "content"
    | "layout"
    | "interaction"
    | "data-binding"
    | "error-handling"
    | "responsive"
    | "performance"
    | "cross-page-consistency"
    | "custom";

  export type SpecSeverity = "critical" | "major" | "minor" | "info" | "warning";

  export type SpecSource = "manual" | "generated" | "snapshot" | "exploration";

  export interface SpecTarget {
    elementId?: string;
    selector?: string;
    searchCriteria?: SearchCriteria;
    description?: string;
    type?: string;
    criteria?: SearchCriteria;
    label?: string;
  }

  export interface AssertionCondition {
    type: string;
    value?: unknown;
    [key: string]: unknown;
  }

  export interface SpecAssertion {
    id: string;
    type?: AssertionType;
    assertionType?: AssertionType;
    target: SpecTarget;
    expected?: unknown;
    message?: string;
    description?: string;
    category?: SpecCategory;
    severity?: SpecSeverity;
    timeout?: number;
    condition?: AssertionCondition;
    source?: string;
    reviewed?: boolean;
    enabled?: boolean;
    attributeName?: string;
    label?: string;
    notes?: string;
  }

  export interface SpecGroup {
    id: string;
    name: string;
    description?: string;
    category: SpecCategory;
    assertions: SpecAssertion[];
    metadata?: Record<string, unknown>;
    stateId?: string;
    transitionId?: string;
    source?: string;
  }

  export interface SpecMetadata {
    generatedAt?: string;
    source?: SpecSource;
    projectId?: string;
    pageUrl?: string;
    pageTitle?: string;
    [key: string]: unknown;
  }

  export interface SpecConfig {
    version: string;
    name?: string;
    description?: string;
    groups: SpecGroup[];
    metadata?: SpecMetadata & Record<string, unknown>;
  }

  export interface SpecAssertionResult {
    assertionId: string;
    passed: boolean;
    actual?: unknown;
    expected?: unknown;
    message?: string;
    durationMs: number;
  }

  export interface SpecGroupResult {
    groupId: string;
    passed: boolean;
    results: SpecAssertionResult[];
    durationMs: number;
  }

  export interface SpecExecutionResult {
    passed: boolean;
    groupResults: SpecGroupResult[];
    totalAssertions: number;
    passedAssertions: number;
    failedAssertions: number;
    durationMs: number;
    timestamp: number;
  }

  export interface SpecExecutionOptions {
    stopOnFailure?: boolean;
    timeout?: number;
    parallel?: boolean;
  }

  export interface SpecCoverage {
    totalSpecs: number;
    executedSpecs: number;
    coveragePercent: number;
  }

  export type SpecEventType = "add" | "update" | "remove" | "execute";

  export interface SpecEvent {
    type: SpecEventType;
    specId?: string;
    timestamp: number;
  }

  export const SPEC_CONFIG_VERSION: string;
  export const SPEC_FILE_EXTENSION: string;
  export const VALID_ASSERTION_TYPES: readonly AssertionType[];
  export const VALID_SPEC_CATEGORIES: readonly SpecCategory[];
  export const VALID_SPEC_SEVERITIES: readonly SpecSeverity[];
  export const VALID_SPEC_SOURCES: readonly SpecSource[];

  // Validator
  export interface ValidationResult {
    valid: boolean;
    errors: ValidationError[];
  }

  export interface ValidationError {
    path: string;
    message: string;
  }

  export function validateSpecConfig(config: SpecConfig): ValidationResult;
  export function validateSpecGroup(group: SpecGroup): ValidationResult;
  export function validateSpecAssertion(
    assertion: SpecAssertion
  ): ValidationResult;
  export function isValidAssertionType(type: string): type is AssertionType;
  export function isValidSpecCategory(category: string): category is SpecCategory;
  export function isValidSpecSeverity(severity: string): severity is SpecSeverity;
  export function isValidSpecSource(source: string): source is SpecSource;

  // Migration
  export interface LegacyTestGeneratorOutput {
    [key: string]: unknown;
  }
  export interface LegacyTestSpecification {
    [key: string]: unknown;
  }
  export interface LegacyTestAssertion {
    [key: string]: unknown;
  }
  export interface LegacyTestTarget {
    [key: string]: unknown;
  }

  export function migrateFromTestGeneratorOutput(
    output: LegacyTestGeneratorOutput
  ): SpecConfig;
  export function migrateLegacyAssertion(
    assertion: LegacyTestAssertion
  ): SpecAssertion;
  export function migrateLegacyTarget(target: LegacyTestTarget): SpecTarget;
  export function coerceAssertionType(type: string): AssertionType;

  // Store
  export type SpecListener = (event: SpecEvent) => void;

  export interface SpecFilterOptions {
    category?: SpecCategory;
    severity?: SpecSeverity;
    source?: SpecSource;
  }

  export class SpecStore {
    add(config: SpecConfig): void;
    get(id: string): SpecConfig | undefined;
    getAll(filter?: SpecFilterOptions): SpecConfig[];
    remove(id: string): boolean;
    clear(): void;
    subscribe(listener: SpecListener): () => void;
    load(id: string, config?: SpecConfig): void;
    unload(id: string): void;
  }

  export function getGlobalSpecStore(): SpecStore;
  export function resetGlobalSpecStore(): void;

  // Executor
  export class SpecExecutor {
    execute(
      config: SpecConfig,
      options?: SpecExecutionOptions
    ): Promise<SpecExecutionResult>;
  }

  export function resolveTarget(target: SpecTarget): unknown;
}
