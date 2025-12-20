/**
 * Comprehensive tests for GraphToSequentialConverter
 *
 * Tests linearizability detection, pattern recognition, and conversion accuracy
 */

import { Workflow, Action, Connections } from '../../src/lib/action-schema/action-types';
import {
  GraphToSequentialConverter,
  LinearizabilityChecker,
  PatternDetector,
  NonLinearWorkflowError,
  WorkflowValidationError,
} from '../../src/lib/workflow-converter';

// Helper function to create test actions
function createTestAction(
  type: string,
  id: string,
  config: any = {},
  position: [number, number] = [0, 0]
): Action {
  return {
    id,
    type,
    config,
    position,
  } as Action;
}

// Helper function to create test workflow
function createTestWorkflow(
  actions: Action[],
  connections: Connections
): Workflow {
  return {
    id: 'test-workflow',
    name: 'Test Workflow',
    version: '1.0.0',
    format: 'graph',
    actions,
    connections,
  };
}

describe('GraphToSequentialConverter', () => {
  let converter: GraphToSequentialConverter;

  beforeEach(() => {
    converter = new GraphToSequentialConverter();
  });

  describe('Basic Conversion', () => {
    test('should convert simple linear graph to sequential', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });
      const action3 = createTestAction('FIND', 'action-3', { target: { image: 'result.png' }, strategy: 'FIRST' });

      const workflow = createTestWorkflow(
        [action1, action2, action3],
        {
          'action-1': { main: [[{ action: 'action-2', type: 'main', index: 0 }]] },
          'action-2': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('action-1');
      expect(result[1].id).toBe('action-2');
      expect(result[2].id).toBe('action-3');
    });

    test('should remove position property from actions', () => {
      const action1 = createTestAction(
        'CLICK',
        'action-1',
        { target: { image: 'test.png' } },
        [100, 200]
      );

      const workflow = createTestWorkflow([action1], {});

      const result = converter.convert(workflow);

      expect(result[0].position).toBeUndefined();
    });

    test('should preserve action IDs by default', () => {
      const action1 = createTestAction('CLICK', 'my-custom-id', { target: { image: 'test.png' } });

      const workflow = createTestWorkflow([action1], {});

      const result = converter.convert(workflow);

      expect(result[0].id).toBe('my-custom-id');
    });

    test('should preserve action names', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      action1.name = 'My Click Action';

      const workflow = createTestWorkflow([action1], {});

      const result = converter.convert(workflow);

      expect(result[0].name).toBe('My Click Action');
    });
  });

  describe('Validation', () => {
    test('should throw error for non-graph workflow', () => {
      const workflow: any = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        format: 'sequential',
        actions: [],
      };

      expect(() => converter.convert(workflow)).toThrow(WorkflowValidationError);
    });

    test('should throw error for graph workflow without connections', () => {
      const workflow: any = {
        id: 'test',
        name: 'Test',
        version: '1.0.0',
        format: 'graph',
        actions: [],
      };

      expect(() => converter.convert(workflow)).toThrow(WorkflowValidationError);
    });

    test('should throw error for graph with merge nodes', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });
      const action3 = createTestAction('FIND', 'action-3', { target: { image: 'result.png' }, strategy: 'FIRST' });

      const workflow = createTestWorkflow(
        [action1, action2, action3],
        {
          'action-1': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] },
          'action-2': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] }, // Merge!
        }
      );

      expect(() => converter.convert(workflow)).toThrow(NonLinearWorkflowError);
    });

    test('should throw error for graph with parallel branches', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'A' });
      const action3 = createTestAction('TYPE', 'action-3', { text: 'B' });

      const workflow = createTestWorkflow(
        [action1, action2, action3],
        {
          'action-1': {
            parallel: [[
              { action: 'action-2', type: 'main', index: 0 },
              { action: 'action-3', type: 'main', index: 0 },
            ]],
          },
        }
      );

      expect(() => converter.convert(workflow)).toThrow(NonLinearWorkflowError);
    });

    test('should throw error for graph with multiple entry points', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

      const workflow = createTestWorkflow(
        [action1, action2],
        {} // No connections - both are entry points
      );

      expect(() => converter.convert(workflow)).toThrow(NonLinearWorkflowError);
    });

    test('should throw error for graph with cycles', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

      const workflow = createTestWorkflow(
        [action1, action2],
        {
          'action-1': { main: [[{ action: 'action-2', type: 'main', index: 0 }]] },
          'action-2': { main: [[{ action: 'action-1', type: 'main', index: 0 }]] }, // Cycle!
        }
      );

      expect(() => converter.convert(workflow)).toThrow(NonLinearWorkflowError);
    });
  });

  describe('IF Pattern Reconstruction', () => {
    test('should reconstruct simple IF action', () => {
      const ifAction = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const thenAction = createTestAction('CLICK', 'then-1', { target: { image: 'yes.png' } });
      const elseAction = createTestAction('CLICK', 'else-1', { target: { image: 'no.png' } });

      const workflow = createTestWorkflow(
        [ifAction, thenAction, elseAction],
        {
          'if-1': {
            main: [
              [{ action: 'then-1', type: 'main', index: 0 }], // True branch
              [{ action: 'else-1', type: 'main', index: 0 }], // False branch
            ],
          },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1); // Only IF action in result
      expect(result[0].type).toBe('IF');
      expect((result[0].config as any).thenActions).toContain('then-1');
      expect((result[0].config as any).elseActions).toContain('else-1');
    });

    test('should reconstruct IF with multiple actions in branches', () => {
      const ifAction = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const then1 = createTestAction('CLICK', 'then-1', { target: { image: 'a.png' } });
      const then2 = createTestAction('TYPE', 'then-2', { text: 'yes' });
      const else1 = createTestAction('CLICK', 'else-1', { target: { image: 'b.png' } });

      const workflow = createTestWorkflow(
        [ifAction, then1, then2, else1],
        {
          'if-1': {
            main: [
              [{ action: 'then-1', type: 'main', index: 0 }],
              [{ action: 'else-1', type: 'main', index: 0 }],
            ],
          },
          'then-1': { main: [[{ action: 'then-2', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      const ifConfig = result[0].config as any;
      expect(ifConfig.thenActions).toHaveLength(2);
      expect(ifConfig.thenActions).toContain('then-1');
      expect(ifConfig.thenActions).toContain('then-2');
      expect(ifConfig.elseActions).toHaveLength(1);
      expect(ifConfig.elseActions).toContain('else-1');
    });

    test('should reconstruct nested IF actions', () => {
      const outerIf = createTestAction('IF', 'outer-if', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const innerIf = createTestAction('IF', 'inner-if', {
        condition: { type: 'expression', expression: 'y > 0' },
        thenActions: [],
        elseActions: [],
      });
      const innerThen = createTestAction('CLICK', 'inner-then', { target: { image: 'a.png' } });
      const innerElse = createTestAction('CLICK', 'inner-else', { target: { image: 'b.png' } });
      const outerElse = createTestAction('CLICK', 'outer-else', { target: { image: 'c.png' } });

      const workflow = createTestWorkflow(
        [outerIf, innerIf, innerThen, innerElse, outerElse],
        {
          'outer-if': {
            main: [
              [{ action: 'inner-if', type: 'main', index: 0 }],
              [{ action: 'outer-else', type: 'main', index: 0 }],
            ],
          },
          'inner-if': {
            main: [
              [{ action: 'inner-then', type: 'main', index: 0 }],
              [{ action: 'inner-else', type: 'main', index: 0 }],
            ],
          },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('IF');
      const outerConfig = result[0].config as any;
      expect(outerConfig.thenActions).toContain('inner-if');
      expect(outerConfig.elseActions).toContain('outer-else');
    });
  });

  describe('LOOP Pattern Reconstruction', () => {
    test('should reconstruct simple LOOP action', () => {
      const loopAction = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const bodyAction = createTestAction('CLICK', 'body-1', { target: { image: 'test.png' } });

      const workflow = createTestWorkflow(
        [loopAction, bodyAction],
        {
          'loop-1': { main: [[{ action: 'body-1', type: 'main', index: 0 }]] },
          'body-1': { main: [[{ action: 'loop-1', type: 'main', index: 0 }]] }, // Back to loop
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('LOOP');
      expect((result[0].config as any).actions).toContain('body-1');
    });

    test('should reconstruct LOOP with multiple body actions', () => {
      const loopAction = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const body1 = createTestAction('CLICK', 'body-1', { target: { image: 'a.png' } });
      const body2 = createTestAction('TYPE', 'body-2', { text: 'test' });
      const body3 = createTestAction('FIND', 'body-3', { target: { image: 'element.png' }, strategy: 'FIRST' });

      const workflow = createTestWorkflow(
        [loopAction, body1, body2, body3],
        {
          'loop-1': { main: [[{ action: 'body-1', type: 'main', index: 0 }]] },
          'body-1': { main: [[{ action: 'body-2', type: 'main', index: 0 }]] },
          'body-2': { main: [[{ action: 'body-3', type: 'main', index: 0 }]] },
          'body-3': { main: [[{ action: 'loop-1', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      const loopConfig = result[0].config as any;
      expect(loopConfig.actions).toHaveLength(3);
      expect(loopConfig.actions).toContain('body-1');
      expect(loopConfig.actions).toContain('body-2');
      expect(loopConfig.actions).toContain('body-3');
    });

    test('should reconstruct nested LOOP actions', () => {
      const outerLoop = createTestAction('LOOP', 'outer-loop', {
        loopType: 'FOR',
        iterations: 2,
        actions: [],
      });
      const innerLoop = createTestAction('LOOP', 'inner-loop', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const innerBody = createTestAction('CLICK', 'inner-body', { target: { image: 'a.png' } });

      const workflow = createTestWorkflow(
        [outerLoop, innerLoop, innerBody],
        {
          'outer-loop': { main: [[{ action: 'inner-loop', type: 'main', index: 0 }]] },
          'inner-loop': { main: [[{ action: 'inner-body', type: 'main', index: 0 }]] },
          'inner-body': { main: [[{ action: 'inner-loop', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('LOOP');
      const outerConfig = result[0].config as any;
      expect(outerConfig.actions).toContain('inner-loop');
    });
  });

  describe('Complex Nested Patterns', () => {
    test('should reconstruct IF inside LOOP', () => {
      const loopAction = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const ifAction = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'i % 2 == 0' },
        thenActions: [],
        elseActions: [],
      });
      const thenAction = createTestAction('CLICK', 'then-1', { target: { image: 'even.png' } });
      const elseAction = createTestAction('CLICK', 'else-1', { target: { image: 'odd.png' } });

      const workflow = createTestWorkflow(
        [loopAction, ifAction, thenAction, elseAction],
        {
          'loop-1': { main: [[{ action: 'if-1', type: 'main', index: 0 }]] },
          'if-1': {
            main: [
              [{ action: 'then-1', type: 'main', index: 0 }],
              [{ action: 'else-1', type: 'main', index: 0 }],
            ],
          },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('LOOP');
      const loopConfig = result[0].config as any;
      expect(loopConfig.actions).toContain('if-1');
    });

    test('should reconstruct LOOP inside IF', () => {
      const ifAction = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const loopAction = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const bodyAction = createTestAction('CLICK', 'body-1', { target: { image: 'test.png' } });
      const elseAction = createTestAction('CLICK', 'else-1', { target: { image: 'skip.png' } });

      const workflow = createTestWorkflow(
        [ifAction, loopAction, bodyAction, elseAction],
        {
          'if-1': {
            main: [
              [{ action: 'loop-1', type: 'main', index: 0 }],
              [{ action: 'else-1', type: 'main', index: 0 }],
            ],
          },
          'loop-1': { main: [[{ action: 'body-1', type: 'main', index: 0 }]] },
          'body-1': { main: [[{ action: 'loop-1', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.convert(workflow);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('IF');
      const ifConfig = result[0].config as any;
      expect(ifConfig.thenActions).toContain('loop-1');
      expect(ifConfig.elseActions).toContain('else-1');
    });
  });

  describe('Conversion Options', () => {
    test('should skip validation when validateOutput is false', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });

      const workflow = createTestWorkflow([action1], {});

      const result = converter.convert(workflow, { validateOutput: false });

      expect(result).toHaveLength(1);
    });
  });

  describe('canLinearize Method', () => {
    test('should return true for linearizable workflow', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

      const workflow = createTestWorkflow(
        [action1, action2],
        {
          'action-1': { main: [[{ action: 'action-2', type: 'main', index: 0 }]] },
        }
      );

      const result = converter.canLinearize(workflow);

      expect(result.linearizable).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('should return false for non-linearizable workflow with details', () => {
      const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
      const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });
      const action3 = createTestAction('FIND', 'action-3', { target: { image: 'result.png' }, strategy: 'FIRST' });

      const workflow = createTestWorkflow(
        [action1, action2, action3],
        {
          'action-1': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] },
          'action-2': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] }, // Merge
        }
      );

      const result = converter.canLinearize(workflow);

      expect(result.linearizable).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.details?.mergeNodeCount).toBe(1);
    });
  });
});

describe('LinearizabilityChecker', () => {
  let checker: LinearizabilityChecker;

  beforeEach(() => {
    checker = new LinearizabilityChecker();
  });

  test('should pass simple linear workflow', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
    const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

    const workflow = createTestWorkflow(
      [action1, action2],
      {
        'action-1': { main: [[{ action: 'action-2', type: 'main', index: 0 }]] },
      }
    );

    const result = checker.check(workflow);

    expect(result.linearizable).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('should fail on multiple entry points', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
    const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

    const workflow = createTestWorkflow([action1, action2], {});

    const result = checker.check(workflow);

    expect(result.linearizable).toBe(false);
    expect(result.issues.some((i) => i.includes('Multiple entry points'))).toBe(true);
  });

  test('should fail on merge nodes', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
    const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });
    const action3 = createTestAction('FIND', 'action-3', { target: { image: 'result.png' }, strategy: 'FIRST' });

    const workflow = createTestWorkflow(
      [action1, action2, action3],
      {
        'action-1': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] },
        'action-2': { main: [[{ action: 'action-3', type: 'main', index: 0 }]] },
      }
    );

    const result = checker.check(workflow);

    expect(result.linearizable).toBe(false);
    expect(result.issues.some((i) => i.includes('Merge nodes'))).toBe(true);
  });

  test('should fail on parallel execution', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
    const action2 = createTestAction('TYPE', 'action-2', { text: 'A' });
    const action3 = createTestAction('TYPE', 'action-3', { text: 'B' });

    const workflow = createTestWorkflow(
      [action1, action2, action3],
      {
        'action-1': {
          parallel: [[
            { action: 'action-2', type: 'main', index: 0 },
            { action: 'action-3', type: 'main', index: 0 },
          ]],
        },
      }
    );

    const result = checker.check(workflow);

    expect(result.linearizable).toBe(false);
    expect(result.issues.some((i) => i.includes('Parallel execution'))).toBe(true);
  });

  test('should fail on cycles', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });
    const action2 = createTestAction('TYPE', 'action-2', { text: 'hello' });

    const workflow = createTestWorkflow(
      [action1, action2],
      {
        'action-1': { main: [[{ action: 'action-2', type: 'main', index: 0 }]] },
        'action-2': { main: [[{ action: 'action-1', type: 'main', index: 0 }]] },
      }
    );

    const result = checker.check(workflow);

    expect(result.linearizable).toBe(false);
    expect(result.issues.some((i) => i.includes('cycle'))).toBe(true);
  });

  test('should provide detailed analysis', () => {
    const action1 = createTestAction('CLICK', 'action-1', { target: { image: 'test.png' } });

    const workflow = createTestWorkflow([action1], {});

    const result = checker.check(workflow);

    expect(result.details).toBeDefined();
    expect(result.details?.entryPointCount).toBe(1);
    expect(result.details?.mergeNodeCount).toBe(0);
    expect(result.details?.parallelBranchCount).toBe(0);
    expect(result.details?.cycleCount).toBe(0);
  });
});

describe('PatternDetector', () => {
  let detector: PatternDetector;

  beforeEach(() => {
    detector = new PatternDetector();
  });

  describe('IF Pattern Detection', () => {
    test('should detect simple IF pattern', () => {
      const ifAction = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const thenAction = createTestAction('CLICK', 'then-1', { target: { image: 'yes.png' } });
      const elseAction = createTestAction('CLICK', 'else-1', { target: { image: 'no.png' } });

      const workflow = createTestWorkflow(
        [ifAction, thenAction, elseAction],
        {
          'if-1': {
            main: [
              [{ action: 'then-1', type: 'main', index: 0 }],
              [{ action: 'else-1', type: 'main', index: 0 }],
            ],
          },
        }
      );

      const pattern = detector.detectIfPattern(workflow, ifAction);

      expect(pattern).not.toBeNull();
      expect(pattern?.ifAction.id).toBe('if-1');
      expect(pattern?.thenBranch).toHaveLength(1);
      expect(pattern?.elseBranch).toHaveLength(1);
    });

    test('should return null for non-IF action', () => {
      const action = createTestAction('CLICK', 'click-1', { target: { image: 'test.png' } });
      const workflow = createTestWorkflow([action], {});

      const pattern = detector.detectIfPattern(workflow, action);

      expect(pattern).toBeNull();
    });
  });

  describe('LOOP Pattern Detection', () => {
    test('should detect simple LOOP pattern', () => {
      const loopAction = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const bodyAction = createTestAction('CLICK', 'body-1', { target: { image: 'test.png' } });

      const workflow = createTestWorkflow(
        [loopAction, bodyAction],
        {
          'loop-1': { main: [[{ action: 'body-1', type: 'main', index: 0 }]] },
          'body-1': { main: [[{ action: 'loop-1', type: 'main', index: 0 }]] },
        }
      );

      const pattern = detector.detectLoopPattern(workflow, loopAction);

      expect(pattern).not.toBeNull();
      expect(pattern?.loopAction.id).toBe('loop-1');
      expect(pattern?.bodyActions).toHaveLength(1);
    });

    test('should return null for non-LOOP action', () => {
      const action = createTestAction('CLICK', 'click-1', { target: { image: 'test.png' } });
      const workflow = createTestWorkflow([action], {});

      const pattern = detector.detectLoopPattern(workflow, action);

      expect(pattern).toBeNull();
    });
  });

  describe('Pattern Collection', () => {
    test('should detect all IF patterns in workflow', () => {
      const if1 = createTestAction('IF', 'if-1', {
        condition: { type: 'expression', expression: 'x > 0' },
        thenActions: [],
        elseActions: [],
      });
      const if2 = createTestAction('IF', 'if-2', {
        condition: { type: 'expression', expression: 'y > 0' },
        thenActions: [],
        elseActions: [],
      });
      const then1 = createTestAction('CLICK', 'then-1', { target: { image: 'a.png' } });
      const else1 = createTestAction('CLICK', 'else-1', { target: { image: 'b.png' } });
      const then2 = createTestAction('CLICK', 'then-2', { target: { image: 'c.png' } });
      const else2 = createTestAction('CLICK', 'else-2', { target: { image: 'd.png' } });

      const workflow = createTestWorkflow(
        [if1, if2, then1, else1, then2, else2],
        {
          'if-1': {
            main: [
              [{ action: 'then-1', type: 'main', index: 0 }],
              [{ action: 'else-1', type: 'main', index: 0 }],
            ],
          },
          'if-2': {
            main: [
              [{ action: 'then-2', type: 'main', index: 0 }],
              [{ action: 'else-2', type: 'main', index: 0 }],
            ],
          },
        }
      );

      const patterns = detector.detectAllIfPatterns(workflow);

      expect(patterns.size).toBe(2);
      expect(patterns.has('if-1')).toBe(true);
      expect(patterns.has('if-2')).toBe(true);
    });

    test('should detect all LOOP patterns in workflow', () => {
      const loop1 = createTestAction('LOOP', 'loop-1', {
        loopType: 'FOR',
        iterations: 3,
        actions: [],
      });
      const loop2 = createTestAction('LOOP', 'loop-2', {
        loopType: 'WHILE',
        condition: { type: 'expression', expression: 'x > 0' },
        actions: [],
      });
      const body1 = createTestAction('CLICK', 'body-1', { target: { image: 'a.png' } });
      const body2 = createTestAction('CLICK', 'body-2', { target: { image: 'b.png' } });

      const workflow = createTestWorkflow(
        [loop1, loop2, body1, body2],
        {
          'loop-1': { main: [[{ action: 'body-1', type: 'main', index: 0 }]] },
          'body-1': { main: [[{ action: 'loop-1', type: 'main', index: 0 }]] },
          'loop-2': { main: [[{ action: 'body-2', type: 'main', index: 0 }]] },
          'body-2': { main: [[{ action: 'loop-2', type: 'main', index: 0 }]] },
        }
      );

      const patterns = detector.detectAllLoopPatterns(workflow);

      expect(patterns.size).toBe(2);
      expect(patterns.has('loop-1')).toBe(true);
      expect(patterns.has('loop-2')).toBe(true);
    });
  });
});

describe('Error Handling', () => {
  test('NonLinearWorkflowError should contain issues', () => {
    const error = new NonLinearWorkflowError('Test error', ['Issue 1', 'Issue 2']);

    expect(error.name).toBe('NonLinearWorkflowError');
    expect(error.message).toBe('Test error');
    expect(error.issues).toEqual(['Issue 1', 'Issue 2']);
  });

  test('WorkflowValidationError should contain details', () => {
    const error = new WorkflowValidationError('Test error', { foo: 'bar' });

    expect(error.name).toBe('WorkflowValidationError');
    expect(error.message).toBe('Test error');
    expect(error.details).toEqual({ foo: 'bar' });
  });
});
