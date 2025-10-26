import { ConfigImporter } from './config-importer';
import { QontinuiConfig } from './export-schema';

describe('ConfigImporter', () => {
  let importer: ConfigImporter;

  beforeEach(() => {
    importer = new ConfigImporter();
  });

  describe('importConfiguration', () => {
    it('should handle stateImages without patterns property', async () => {
      // This test verifies the fix for: "Cannot read properties of undefined (reading 'forEach')"
      // The issue occurred when stateImages exist but patterns is undefined
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [],
        states: [
          {
            id: 'state1',
            name: 'Test State',
            description: 'A test state',
            isInitial: true,
            stateImages: [
              {
                id: 'img1',
                name: 'Test Image',
                // patterns is undefined here - this used to cause the error
                shared: false
              }
            ],
            regions: [],
            locations: [],
            strings: [],
            position: { x: 0, y: 0 }
          }
        ],
        transitions: [],
        settings: {}
      };

      // After the fix, this should work without errors
      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toHaveLength(1);
      expect(result.states[0].stateImages[0].patterns).toEqual([]);
    });

    it('should handle stateImages with empty patterns array', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [],
        states: [
          {
            id: 'state1',
            name: 'Test State',
            description: 'A test state',
            isInitial: true,
            stateImages: [
              {
                id: 'img1',
                name: 'Test Image',
                patterns: [],
                shared: false
              }
            ],
            regions: [],
            locations: [],
            strings: [],
            position: { x: 0, y: 0 }
          }
        ],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toHaveLength(1);
    });

    it('should handle states without stateImages property', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [],
        states: [
          {
            id: 'state1',
            name: 'Test State',
            description: 'A test state',
            isInitial: true,
            // stateImages is undefined
            regions: [],
            locations: [],
            strings: [],
            position: { x: 0, y: 0 }
          }
        ],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages).toEqual([]);
    });

    it('should successfully import valid configuration with patterns', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [
          {
            id: 'img1',
            name: 'test.png',
            format: 'png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
          }
        ],
        processes: [],
        states: [
          {
            id: 'state1',
            name: 'Test State',
            description: 'A test state',
            isInitial: true,
            stateImages: [
              {
                id: 'stateImg1',
                name: 'State Image 1',
                patterns: [
                  {
                    id: 'pattern1',
                    name: 'Pattern 1',
                    image: 'img1',
                    similarity: 0.8,
                    searchRegions: []
                  }
                ],
                shared: false
              }
            ],
            regions: [],
            locations: [],
            strings: [],
            position: { x: 0, y: 0 }
          }
        ],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.images).toHaveLength(1);
      expect(result.states).toHaveLength(1);
      expect(result.states[0].stateImages[0].patterns).toHaveLength(1);
      expect(result.images[0].usageCount).toBe(1);
    });
  });

  it('should handle processes without actions array', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [
          {
            id: 'proc1',
            name: 'Test Process',
            description: 'A test process',
            // actions is undefined
          } as any
        ],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].actions).toEqual([]);
    });

    it('should handle transitions without processes array', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [
          {
            id: 'trans1',
            type: 'IncomingTransition',
            toState: 'state1',
            timeout: 1000,
            retryCount: 0,
            // processes is undefined
          } as any
        ],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      // Should succeed without errors even though processes array is missing
      expect(result.success).toBe(true);
      expect(result.transitions).toHaveLength(1);
    });

  describe('action format detection and import', () => {
    it('should detect and import old format actions', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [
          {
            id: 'proc1',
            name: 'Test Process',
            description: 'A test process',
            actions: [
              {
                id: 'action1',
                type: 'CLICK',
                timeout: 5000,
                retryCount: 3,
                continueOnError: false,
                config: {
                  target: {
                    type: 'image',
                    imageId: 'img1',
                    threshold: 0.8
                  }
                }
              }
            ]
          }
        ],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].actions).toHaveLength(1);

      const action = result.processes[0].actions[0];
      expect(action.id).toBe('action1');
      expect(action.type).toBe('CLICK');
      expect(action.config.timeout).toBe(5000);
      expect(action.config.retryCount).toBe(3);
      expect(action.config.continueOnError).toBe(false);
      expect(action.config.imageId).toBe('img1');
      expect(action.config.threshold).toBe(0.8);
    });

    it('should detect and import new format actions', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [
          {
            id: 'proc1',
            name: 'Test Process',
            description: 'A test process',
            actions: [
              {
                id: 'action1',
                type: 'CLICK',
                config: {
                  target: {
                    type: 'image',
                    imageId: 'img1',
                    threshold: 0.8
                  },
                  numberOfClicks: 1
                },
                base: {
                  pauseBeforeBegin: 100,
                  pauseAfterEnd: 200
                },
                execution: {
                  timeout: 10000,
                  retryCount: 5,
                  continueOnError: true
                }
              }
            ]
          }
        ],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.processes).toHaveLength(1);
      expect(result.processes[0].actions).toHaveLength(1);

      const action = result.processes[0].actions[0];
      expect(action.id).toBe('action1');
      expect(action.type).toBe('CLICK');

      // Check config properties
      expect(action.config.imageId).toBe('img1');
      expect(action.config.threshold).toBe(0.8);
      expect(action.config.numberOfClicks).toBe(1);

      // Check base settings
      expect(action.config.pauseBeforeBegin).toBe(100);
      expect(action.config.pauseAfterEnd).toBe(200);

      // Check execution settings
      expect(action.config.timeout).toBe(10000);
      expect(action.config.retryCount).toBe(5);
      expect(action.config.continueOnError).toBe(true);
    });

    it('should handle new format actions with partial settings', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [
          {
            id: 'proc1',
            name: 'Test Process',
            description: 'A test process',
            actions: [
              {
                id: 'action1',
                type: 'TYPE',
                config: {
                  text: 'Hello World'
                },
                execution: {
                  timeout: 5000
                }
                // base is omitted
              }
            ]
          }
        ],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.processes[0].actions).toHaveLength(1);

      const action = result.processes[0].actions[0];
      expect(action.config.text).toBe('Hello World');
      expect(action.config.timeout).toBe(5000);
    });

    it('should handle mixed format actions in the same process', async () => {
      const config: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test Config',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [
          {
            id: 'proc1',
            name: 'Test Process',
            description: 'A test process',
            actions: [
              // Old format
              {
                id: 'action1',
                type: 'CLICK',
                timeout: 5000,
                retryCount: 3,
                continueOnError: false,
                config: {
                  target: {
                    type: 'image',
                    imageId: 'img1'
                  }
                }
              },
              // New format
              {
                id: 'action2',
                type: 'TYPE',
                config: {
                  text: 'Test'
                },
                execution: {
                  timeout: 3000
                }
              }
            ]
          }
        ],
        states: [{
          id: 'state1',
          name: 'Test State',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = await importer.importConfiguration(config);

      expect(result.success).toBe(true);
      expect(result.processes[0].actions).toHaveLength(2);

      // Old format action
      const oldAction = result.processes[0].actions[0];
      expect(oldAction.config.timeout).toBe(5000);
      expect(oldAction.config.imageId).toBe('img1');

      // New format action
      const newAction = result.processes[0].actions[1];
      expect(newAction.config.text).toBe('Test');
      expect(newAction.config.timeout).toBe(3000);
    });
  });

  describe('validateBeforeImport', () => {
    it('should validate required fields', () => {
      const invalidConfig: any = {
        version: '1.0.0'
        // missing required fields
      };

      const result = importer.validateBeforeImport(invalidConfig);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should pass validation for valid config', () => {
      const validConfig: QontinuiConfig = {
        version: '1.0.0',
        metadata: {
          name: 'Test',
          description: 'Test',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        images: [],
        processes: [],
        states: [{
          id: 'state1',
          name: 'Test',
          description: '',
          isInitial: true,
          stateImages: [],
          regions: [],
          locations: [],
          strings: [],
          position: { x: 0, y: 0 }
        }],
        transitions: [],
        settings: {}
      };

      const result = importer.validateBeforeImport(validConfig);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
