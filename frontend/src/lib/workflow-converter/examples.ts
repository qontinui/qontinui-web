/**
 * Examples demonstrating Sequential to Graph Converter usage
 *
 * These examples show common use cases and best practices.
 */

import { convertSequentialToGraph, SequentialToGraphConverter } from './sequential-to-graph-converter';
import { Action } from '../action-schema/action-types';
import { ClickActionConfig } from '../action-schema/configs/mouse-actions';
import { TypeActionConfig } from '../action-schema/configs/keyboard-actions';
import { IfActionConfig, LoopActionConfig } from '../action-schema/configs/control-flow-actions';

/**
 * Example 1: Simple Linear Workflow
 *
 * Convert a basic sequence of actions into a graph workflow.
 */
export function exampleLinearWorkflow() {
  const actions: Action[] = [
    {
      id: 'click-login',
      type: 'CLICK',
      name: 'Click Login Button',
      config: {
        target: {
          image: 'login-button.png',
        },
      } as ClickActionConfig,
      position: [0, 0],
    },
    {
      id: 'type-username',
      type: 'TYPE',
      name: 'Enter Username',
      config: {
        text: 'user@example.com',
      } as TypeActionConfig,
      position: [0, 0],
    },
    {
      id: 'click-submit',
      type: 'CLICK',
      name: 'Submit Form',
      config: {
        target: {
          image: 'submit-button.png',
        },
      } as ClickActionConfig,
      position: [0, 0],
    },
  ];

  const workflow = convertSequentialToGraph(actions, {
    workflowName: 'Login Workflow',
    version: '1.0.0',
  });

  console.log('Linear Workflow:', {
    actions: workflow.actions.length,
    connections: Object.keys(workflow.connections).length,
  });

  return workflow;
}

/**
 * Example 2: Workflow with IF Action
 *
 * Shows how IF actions are converted with branching.
 */
export function exampleIfWorkflow() {
  const actions: Action[] = [
    {
      id: 'check-logged-in',
      type: 'IF',
      name: 'Check if Already Logged In',
      config: {
        condition: {
          type: 'expression',
          expression: 'isLoggedIn === true',
        },
        thenActions: ['skip-login'],
        elseActions: ['do-login'],
      } as IfActionConfig,
      position: [0, 0],
    },
  ];

  const workflow = convertSequentialToGraph(actions, {
    workflowName: 'Conditional Login',
    layout: {
      horizontalSpacing: 250,
      verticalSpacing: 200,
    },
  });

  return workflow;
}

/**
 * Example 3: Workflow with LOOP Action
 *
 * Demonstrates loop conversion.
 */
export function exampleLoopWorkflow() {
  const actions: Action[] = [
    {
      id: 'retry-loop',
      type: 'LOOP',
      name: 'Retry Connection',
      config: {
        loopType: 'FOR',
        iterations: 3,
        actions: ['attempt-connect', 'wait-retry'],
      } as LoopActionConfig,
      position: [0, 0],
    },
  ];

  const workflow = convertSequentialToGraph(actions, {
    workflowName: 'Retry Logic',
  });

  return workflow;
}

/**
 * Example 4: Using Converter Class for Detailed Results
 *
 * Shows how to get conversion statistics and warnings.
 */
export function exampleDetailedConversion() {
  const converter = new SequentialToGraphConverter({
    workflowName: 'Complex Workflow',
    workflowId: 'workflow-complex-1',
    version: '2.0.0',
    preserveActionIds: true,
    layout: {
      horizontalSpacing: 300,
      verticalSpacing: 180,
      startX: 50,
      startY: 50,
    },
  });

  const actions: Action[] = [
    {
      id: 'action-1',
      type: 'CLICK',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
    {
      id: 'action-2',
      type: 'TYPE',
      config: {} as TypeActionConfig,
      position: [0, 0],
    },
  ];

  const result = converter.convert(actions);

  console.log('Conversion Statistics:');
  console.log('  Actions Converted:', result.stats.actionsConverted);
  console.log('  Connections Created:', result.stats.connectionsCreated);
  console.log('  Control Flow Expanded:', result.stats.controlFlowExpanded);
  console.log('  Max Depth:', result.stats.maxDepth);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach((warning) => console.log('  -', warning));
  }

  return result.workflow;
}

/**
 * Example 5: Custom Layout Configuration
 *
 * Demonstrates custom spacing and positioning options.
 */
export function exampleCustomLayout() {
  const actions: Action[] = [
    {
      id: 'a1',
      type: 'CLICK',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
    {
      id: 'a2',
      type: 'CLICK',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
    {
      id: 'a3',
      type: 'CLICK',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
  ];

  const workflow = convertSequentialToGraph(actions, {
    workflowName: 'Custom Layout',
    layout: {
      horizontalSpacing: 350, // Wide horizontal spacing
      verticalSpacing: 250, // Tall vertical spacing
      startX: 100, // Start further right
      startY: 150, // Start further down
    },
  });

  // Actions now have positions like:
  // [100, 150], [450, 150], [800, 150]

  return workflow;
}

/**
 * Example 6: Batch Converting Multiple Workflows
 *
 * Convert multiple sequential workflows efficiently.
 */
export function exampleBatchConversion() {
  const converter = new SequentialToGraphConverter();

  const sequentialWorkflows: Action[][] = [
    [
      /* workflow 1 actions */
    ],
    [
      /* workflow 2 actions */
    ],
    [
      /* workflow 3 actions */
    ],
  ];

  const graphWorkflows = sequentialWorkflows.map((actions, index) => {
    const result = converter.convert(actions);

    if (result.warnings.length > 0) {
      console.warn(`Workflow ${index + 1} warnings:`, result.warnings);
    }

    return result.workflow;
  });

  return graphWorkflows;
}

/**
 * Example 7: Complex Workflow with Multiple Control Flow Types
 *
 * Shows a realistic workflow with IF, LOOP, and linear actions.
 */
export function exampleComplexWorkflow() {
  const actions: Action[] = [
    {
      id: 'init',
      type: 'CLICK',
      name: 'Initialize',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
    {
      id: 'check-ready',
      type: 'IF',
      name: 'Check if Ready',
      config: {
        condition: {
          type: 'expression',
          expression: 'isReady',
        },
        thenActions: ['proceed'],
        elseActions: ['wait-ready'],
      } as IfActionConfig,
      position: [0, 0],
    },
    {
      id: 'retry-loop',
      type: 'LOOP',
      name: 'Retry on Failure',
      config: {
        loopType: 'WHILE',
        condition: {
          type: 'expression',
          expression: 'attempts < 3',
        },
        actions: ['attempt-action'],
      } as LoopActionConfig,
      position: [0, 0],
    },
    {
      id: 'finalize',
      type: 'CLICK',
      name: 'Finalize',
      config: {} as ClickActionConfig,
      position: [0, 0],
    },
  ];

  const result = new SequentialToGraphConverter({
    workflowName: 'Complex Process',
    layout: {
      horizontalSpacing: 300,
      verticalSpacing: 200,
    },
  }).convert(actions);

  console.log('Complex Workflow Statistics:');
  console.log('  Total Actions:', result.stats.actionsConverted);
  console.log('  Total Connections:', result.stats.connectionsCreated);
  console.log('  Control Flow Actions:', result.stats.controlFlowExpanded);

  return result.workflow;
}

/**
 * Example 8: Extracting Nested Actions
 *
 * Shows how to extract action IDs from control flow configs.
 */
export function exampleExtractNestedActions() {
  const converter = new SequentialToGraphConverter();

  const ifAction: Action<'IF'> = {
    id: 'my-if',
    type: 'IF',
    config: {
      condition: { type: 'expression', expression: 'x > 5' },
      thenActions: ['action-1', 'action-2'],
      elseActions: ['action-3'],
    },
    position: [0, 0],
  };

  const nestedActionIds = converter.extractNestedActions(ifAction);
  console.log('Nested action IDs:', nestedActionIds);
  // ['action-1', 'action-2', 'action-3']

  return nestedActionIds;
}
