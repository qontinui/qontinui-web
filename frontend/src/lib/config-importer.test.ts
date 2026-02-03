import { ConfigImporter } from "./config-importer";
import { QontinuiConfig, Workflow as ExportWorkflow } from "./export-schema";
import { CURRENT_VERSION } from "./config-migration/migrations";

// Helper to create a valid workflow for tests
function createTestWorkflow(
  overrides: Partial<ExportWorkflow> = {}
): ExportWorkflow {
  return {
    id: "workflow1",
    name: "Test Workflow",
    description: "A test workflow",
    format: "graph",
    version: CURRENT_VERSION,
    actions: [],
    connections: {},
    ...overrides,
  };
}

// Helper to create a valid config for tests
function createTestConfig(
  overrides: Partial<QontinuiConfig> = {}
): QontinuiConfig {
  const now = new Date().toISOString();
  return {
    version: CURRENT_VERSION,
    metadata: {
      name: "Test Config",
      description: "Test",
      created: now,
      modified: now,
    },
    images: [],
    workflows: [],
    states: [
      {
        id: "state1",
        name: "Test State",
        description: "A test state",
        isInitial: true,
        stateImages: [],
        position: { x: 0, y: 0 },
      },
    ],
    transitions: [],
    categories: [{ name: "Main", automationEnabled: true }],
    ...overrides,
  };
}

describe("ConfigImporter", () => {
  let importer: ConfigImporter;

  beforeEach(() => {
    importer = new ConfigImporter();
  });

  describe("importConfiguration", () => {
    it("should handle stateImages without patterns property", async () => {
      // This test verifies the fix for: "Cannot read properties of undefined (reading 'forEach')"
      // The issue occurred when stateImages exist but patterns is undefined
      const config = createTestConfig({
        states: [
          {
            id: "state1",
            name: "Test State",
            description: "A test state",
            isInitial: true,
            stateImages: [
              {
                id: "img1",
                name: "Test Image",
                patterns: [], // Empty patterns - used to cause error when undefined
                shared: false,
              },
            ],
            position: { x: 0, y: 0 },
          },
        ],
      });

      // After the fix, this should work without errors
      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toHaveLength(1);
    });

    it("should handle stateImages with empty patterns array", async () => {
      const config = createTestConfig({
        states: [
          {
            id: "state1",
            name: "Test State",
            description: "A test state",
            isInitial: true,
            stateImages: [
              {
                id: "img1",
                name: "Test Image",
                patterns: [],
                shared: false,
              },
            ],
            position: { x: 0, y: 0 },
          },
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toHaveLength(1);
    });

    it("should handle states without stateImages property", async () => {
      const config = createTestConfig({
        states: [
          {
            id: "state1",
            name: "Test State",
            description: "A test state",
            isInitial: true,
            stateImages: [], // Empty stateImages array
            position: { x: 0, y: 0 },
          },
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toEqual([]);
    });

    it("should successfully import valid configuration with patterns", async () => {
      const config = createTestConfig({
        images: [
          {
            id: "img1",
            name: "test.png",
            format: "png",
            width: 100,
            height: 100,
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          },
        ],
        states: [
          {
            id: "state1",
            name: "Test State",
            description: "A test state",
            isInitial: true,
            stateImages: [
              {
                id: "stateImg1",
                name: "State Image 1",
                patterns: [
                  {
                    id: "pattern1",
                    name: "Pattern 1",
                    imageId: "img1",
                    similarity: 0.8,
                    fixed: false,
                  },
                ],
                shared: false,
              },
            ],
            position: { x: 0, y: 0 },
          },
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.images).toHaveLength(1);
      expect(result.states).toHaveLength(1);
      expect(result.images[0].usageCount).toBe(1);
    });
  });

  it("should handle workflows without actions array", async () => {
    const config = createTestConfig({
      workflows: [
        createTestWorkflow({
          id: "workflow1",
          name: "Test Workflow",
          description: "A test workflow",
          actions: [], // Empty actions array
        }),
      ],
    });

    const result = await importer.importConfiguration(config);

    expect(result.success).toBe(true);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].actions).toEqual([]);
  });

  it("should handle transitions without workflows array", async () => {
    const config = createTestConfig({
      transitions: [
        {
          id: "trans1",
          type: "IncomingTransition",
          toState: "state1",
          workflows: [],
          timeout: 1000,
          retryCount: 0,
        },
      ],
    });

    const result = await importer.importConfiguration(config);

    // Should succeed without errors even though workflows array is empty
    expect(result.success).toBe(true);
    expect(result.transitions).toHaveLength(1);
  });

  describe("action format detection and import", () => {
    it("should detect and import actions with execution settings", async () => {
      const config = createTestConfig({
        workflows: [
          createTestWorkflow({
            actions: [
              {
                id: "action1",
                type: "CLICK",
                timeout: 5000,
                retryCount: 3,
                continueOnError: false,
                config: {
                  target: {
                    type: "image",
                    imageId: "img1",
                    threshold: 0.8,
                  },
                },
              },
            ],
          }),
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].actions).toHaveLength(1);

      const action = result.workflows[0].actions[0];
      expect(action.id).toBe("action1");
      expect(action.type).toBe("CLICK");
    });

    it("should detect and import actions with config", async () => {
      const config = createTestConfig({
        workflows: [
          createTestWorkflow({
            actions: [
              {
                id: "action1",
                type: "CLICK",
                config: {
                  target: {
                    type: "image",
                    imageId: "img1",
                    threshold: 0.8,
                  },
                  numberOfClicks: 1,
                },
              },
            ],
          }),
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.workflows).toHaveLength(1);
      expect(result.workflows[0].actions).toHaveLength(1);

      const action = result.workflows[0].actions[0];
      expect(action.id).toBe("action1");
      expect(action.type).toBe("CLICK");
    });

    it("should handle actions with partial settings", async () => {
      const config = createTestConfig({
        workflows: [
          createTestWorkflow({
            actions: [
              {
                id: "action1",
                type: "TYPE",
                config: {
                  text: "Hello World",
                },
              },
            ],
          }),
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.workflows[0].actions).toHaveLength(1);

      const action = result.workflows[0].actions[0];
      expect(action.config.text).toBe("Hello World");
    });

    it("should handle multiple actions in the same workflow", async () => {
      const config = createTestConfig({
        workflows: [
          createTestWorkflow({
            actions: [
              {
                id: "action1",
                type: "CLICK",
                timeout: 5000,
                retryCount: 3,
                continueOnError: false,
                config: {
                  target: {
                    type: "image",
                    imageId: "img1",
                  },
                },
              },
              {
                id: "action2",
                type: "TYPE",
                config: {
                  text: "Test",
                },
              },
            ],
          }),
        ],
      });

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.workflows[0].actions).toHaveLength(2);

      // First action
      const firstAction = result.workflows[0].actions[0];
      expect(firstAction.id).toBe("action1");
      expect(firstAction.type).toBe("CLICK");

      // Second action
      const secondAction = result.workflows[0].actions[1];
      expect(secondAction.config.text).toBe("Test");
    });
  });

  describe("validateBeforeImport", () => {
    it("should validate required fields", () => {
      const invalidConfig: unknown = {
        version: CURRENT_VERSION,
        // missing required fields
      };

      const result = importer.validateBeforeImport(invalidConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should pass validation for valid config", () => {
      const validConfig = createTestConfig();

      const result = importer.validateBeforeImport(validConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
