/**
 * RunnerClient facade - composes domain-specific sub-clients into a unified API.
 *
 * Sub-clients receive a shared BaseClient instance via constructor injection
 * (composition over inheritance). All methods from the original monolithic
 * RunnerClient class are available on this facade.
 */

import { BaseClient, RUNNER_BASE_URL } from "./base-client";
import { ConfigClient } from "./config-client";
import { ExtractionClient } from "./extraction-client";
import { PlaywrightClient } from "./playwright-client";
import { TestingClient } from "./testing-client";
import { PatternClient } from "./pattern-client";
import { ModelClient } from "./model-client";
import { WorkflowClient } from "./workflow-client";
import { ClickCaptureClient } from "./click-capture-client";

// Re-export all types from the centralized types module
export type {
  RunnerMonitor,
  Monitor,
  MonitorPosition,
  RunnerErrorResponse,
  MonitorsResponse,
  RunnerStatusResponse,
  LoadConfigResponse,
  CaptureScreenshotRequest,
  CaptureScreenshotResponse,
  StartExtractionRequest,
  ExtractionStartResponse,
  ExtractionStatusResponse,
  StartPlaywrightCollectionRequest,
  PlaywrightCollectionStartResponse,
  PlaywrightCollectionStatusResponse,
  PlaywrightClickable,
  PlaywrightCollectionResultsResponse,
  PatternSearchRegion,
  PatternMatchRequest,
  PatternMatch,
  PatternMatchResponse,
  ModelType,
  ModelInfo,
  ModelStatusResponse,
  ModelDiskUsageResponse,
  ModelDownloadRequest,
  ModelDownloadResponse,
  ModelListResponse,
  StartIntegrationTestRequest,
  IntegrationTestCase,
  IntegrationTestAssertion,
  TestRunStatus,
  TestRunSummary,
  TestRunResult,
  TestResult,
  AssertionResult,
  TestingState,
  TestingTransition,
  MockMode,
  MockedAction,
  RunWorkflowResponse,
  ClickCaptureStartResponse,
  ClickCaptureStopResponse,
  ClickCaptureStatusResponse,
} from "./types";

/**
 * Unified RunnerClient that delegates to focused sub-clients.
 *
 * All methods from the original monolithic class are available on this facade.
 * Sub-clients share the same BaseClient but each own their HTTP calls.
 */
class RunnerClient {
  private base: BaseClient;
  private config: ConfigClient;
  private extraction: ExtractionClient;
  private playwright: PlaywrightClient;
  private testing: TestingClient;
  private pattern: PatternClient;
  private model: ModelClient;
  private workflow: WorkflowClient;
  private clickCapture: ClickCaptureClient;

  constructor(baseUrl: string = RUNNER_BASE_URL) {
    this.base = new BaseClient(baseUrl);
    this.config = new ConfigClient(this.base);
    this.extraction = new ExtractionClient(this.base);
    this.playwright = new PlaywrightClient(this.base);
    this.testing = new TestingClient(this.base);
    this.pattern = new PatternClient(this.base);
    this.model = new ModelClient(this.base);
    this.workflow = new WorkflowClient(this.base);
    this.clickCapture = new ClickCaptureClient(this.base);
  }

  // ==========================================================================
  // Base / Command Methods
  // ==========================================================================

  sendCommand = <T = unknown>(
    type: string,
    params: Record<string, unknown> = {},
    timeoutMs = 120000
  ) => this.base.sendCommand<T>(type, params, timeoutMs);

  // ==========================================================================
  // Click Capture Methods
  // ==========================================================================

  startClickCapture = (
    ...args: Parameters<ClickCaptureClient["startClickCapture"]>
  ) => this.clickCapture.startClickCapture(...args);

  stopClickCapture = (
    ...args: Parameters<ClickCaptureClient["stopClickCapture"]>
  ) => this.clickCapture.stopClickCapture(...args);

  getClickCaptureStatus = (
    ...args: Parameters<ClickCaptureClient["getClickCaptureStatus"]>
  ) => this.clickCapture.getClickCaptureStatus(...args);

  // ==========================================================================
  // Config / Status Methods
  // ==========================================================================

  loadConfig = (...args: Parameters<ConfigClient["loadConfig"]>) =>
    this.config.loadConfig(...args);

  getMonitors = (...args: Parameters<ConfigClient["getMonitors"]>) =>
    this.config.getMonitors(...args);

  isAvailable = (...args: Parameters<ConfigClient["isAvailable"]>) =>
    this.config.isAvailable(...args);

  getStatus = (...args: Parameters<ConfigClient["getStatus"]>) =>
    this.config.getStatus(...args);

  captureScreenshot = (...args: Parameters<ConfigClient["captureScreenshot"]>) =>
    this.config.captureScreenshot(...args);

  // ==========================================================================
  // Extraction Methods
  // ==========================================================================

  startExtraction = (...args: Parameters<ExtractionClient["startExtraction"]>) =>
    this.extraction.startExtraction(...args);

  stopExtraction = (...args: Parameters<ExtractionClient["stopExtraction"]>) =>
    this.extraction.stopExtraction(...args);

  getExtractionStatus = (
    ...args: Parameters<ExtractionClient["getExtractionStatus"]>
  ) => this.extraction.getExtractionStatus(...args);

  getExtractionScreenshotUrl = (
    ...args: Parameters<ExtractionClient["getExtractionScreenshotUrl"]>
  ) => this.extraction.getExtractionScreenshotUrl(...args);

  getExtractionScreenshot = (
    ...args: Parameters<ExtractionClient["getExtractionScreenshot"]>
  ) => this.extraction.getExtractionScreenshot(...args);

  // ==========================================================================
  // Playwright Methods
  // ==========================================================================

  startPlaywrightCollection = (
    ...args: Parameters<PlaywrightClient["startPlaywrightCollection"]>
  ) => this.playwright.startPlaywrightCollection(...args);

  getPlaywrightCollectionStatus = (
    ...args: Parameters<PlaywrightClient["getPlaywrightCollectionStatus"]>
  ) => this.playwright.getPlaywrightCollectionStatus(...args);

  getPlaywrightCollectionResults = (
    ...args: Parameters<PlaywrightClient["getPlaywrightCollectionResults"]>
  ) => this.playwright.getPlaywrightCollectionResults(...args);

  stopPlaywrightCollection = (
    ...args: Parameters<PlaywrightClient["stopPlaywrightCollection"]>
  ) => this.playwright.stopPlaywrightCollection(...args);

  // ==========================================================================
  // Pattern Matching Methods
  // ==========================================================================

  patternFind = (...args: Parameters<PatternClient["patternFind"]>) =>
    this.pattern.patternFind(...args);

  patternFindAll = (...args: Parameters<PatternClient["patternFindAll"]>) =>
    this.pattern.patternFindAll(...args);

  // ==========================================================================
  // Model Management Methods
  // ==========================================================================

  listModels = (...args: Parameters<ModelClient["listModels"]>) =>
    this.model.listModels(...args);

  downloadModel = (...args: Parameters<ModelClient["downloadModel"]>) =>
    this.model.downloadModel(...args);

  deleteModel = (...args: Parameters<ModelClient["deleteModel"]>) =>
    this.model.deleteModel(...args);

  getModelStatus = (...args: Parameters<ModelClient["getModelStatus"]>) =>
    this.model.getModelStatus(...args);

  getModelsDiskUsage = (
    ...args: Parameters<ModelClient["getModelsDiskUsage"]>
  ) => this.model.getModelsDiskUsage(...args);

  // ==========================================================================
  // Testing Methods
  // ==========================================================================

  startIntegrationTest = (
    ...args: Parameters<TestingClient["startIntegrationTest"]>
  ) => this.testing.startIntegrationTest(...args);

  getTestRunStatus = (...args: Parameters<TestingClient["getTestRunStatus"]>) =>
    this.testing.getTestRunStatus(...args);

  getTestResults = (...args: Parameters<TestingClient["getTestResults"]>) =>
    this.testing.getTestResults(...args);

  listTestRuns = (...args: Parameters<TestingClient["listTestRuns"]>) =>
    this.testing.listTestRuns(...args);

  endTestRun = (...args: Parameters<TestingClient["endTestRun"]>) =>
    this.testing.endTestRun(...args);

  getTestingStates = (...args: Parameters<TestingClient["getTestingStates"]>) =>
    this.testing.getTestingStates(...args);

  getTestingTransitions = (
    ...args: Parameters<TestingClient["getTestingTransitions"]>
  ) => this.testing.getTestingTransitions(...args);

  findPath = (...args: Parameters<TestingClient["findPath"]>) =>
    this.testing.findPath(...args);

  traverseToState = (...args: Parameters<TestingClient["traverseToState"]>) =>
    this.testing.traverseToState(...args);

  getActiveStates = (...args: Parameters<TestingClient["getActiveStates"]>) =>
    this.testing.getActiveStates(...args);

  setMockMode = (...args: Parameters<TestingClient["setMockMode"]>) =>
    this.testing.setMockMode(...args);

  mockAction = (...args: Parameters<TestingClient["mockAction"]>) =>
    this.testing.mockAction(...args);

  getMockedActions = (...args: Parameters<TestingClient["getMockedActions"]>) =>
    this.testing.getMockedActions(...args);

  clearMockedActions = (
    ...args: Parameters<TestingClient["clearMockedActions"]>
  ) => this.testing.clearMockedActions(...args);

  runAssertion = (...args: Parameters<TestingClient["runAssertion"]>) =>
    this.testing.runAssertion(...args);

  // ==========================================================================
  // Workflow Methods
  // ==========================================================================

  runWorkflow = (...args: Parameters<WorkflowClient["runWorkflow"]>) =>
    this.workflow.runWorkflow(...args);

  stopWorkflow = (...args: Parameters<WorkflowClient["stopWorkflow"]>) =>
    this.workflow.stopWorkflow(...args);
}

export { RunnerClient };

export const runnerClient = new RunnerClient();
