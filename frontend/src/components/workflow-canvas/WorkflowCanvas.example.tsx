/**
 * Workflow Canvas Examples
 *
 * Demonstrates various workflow patterns and use cases.
 */

'use client';

import React, { useState } from 'react';
import { WorkflowCanvas } from './WorkflowCanvas';
import { Workflow, createAction } from '@/lib/action-schema/action-types';

// ============================================================================
// Example 1: Simple Linear Workflow
// ============================================================================

export function SimpleLinearExample() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'workflow-simple',
    name: 'Simple Login Flow',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [100, 100],
        { id: 'action-1', name: 'Find Login Button' }
      ),
      createAction(
        'CLICK',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          clickType: 'single',
          offsetX: 0,
          offsetY: 0,
        },
        [100, 250],
        { id: 'action-2', name: 'Click Login' }
      ),
      createAction(
        'WAIT',
        {
          duration: 1000,
        },
        [100, 400],
        { id: 'action-3', name: 'Wait for Page Load' }
      ),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
      'action-2': {
        main: [[{ action: 'action-3', type: 'main', index: 0 }]],
      },
    },
  });

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <h3>Simple Linear Workflow</h3>
      <WorkflowCanvas workflow={workflow} onWorkflowChange={setWorkflow} />
    </div>
  );
}

// ============================================================================
// Example 2: Branching Workflow (IF)
// ============================================================================

export function BranchingIfExample() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'workflow-branching',
    name: 'Conditional Login Flow',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [100, 100],
        { id: 'action-1', name: 'Find Login' }
      ),
      createAction(
        'IF',
        {
          condition: 'found',
          operator: 'equals',
          value: true,
        },
        [100, 250],
        { id: 'action-if', name: 'Check if Found' }
      ),
      createAction(
        'CLICK',
        {
          findBy: 'text',
          text: 'Login',
          searchMultiple: false,
          searchRegions: [],
          clickType: 'single',
          offsetX: 0,
          offsetY: 0,
        },
        [300, 250],
        { id: 'action-true', name: 'Click if Found' }
      ),
      createAction(
        'SCREENSHOT',
        {
          name: 'error-screenshot',
          fullScreen: true,
        },
        [300, 400],
        { id: 'action-false', name: 'Screenshot if Not Found' }
      ),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-if', type: 'main', index: 0 }]],
      },
      'action-if': {
        main: [
          [{ action: 'action-true', type: 'main', index: 0 }], // True branch
          [{ action: 'action-false', type: 'main', index: 0 }], // False branch
        ],
      },
    },
  });

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <h3>Branching Workflow (IF)</h3>
      <WorkflowCanvas workflow={workflow} onWorkflowChange={setWorkflow} />
    </div>
  );
}

// ============================================================================
// Example 3: Loop Workflow
// ============================================================================

export function LoopExample() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'workflow-loop',
    name: 'Retry Loop',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'LOOP',
        {
          iterations: 3,
          delayBetweenIterations: 1000,
        },
        [100, 100],
        { id: 'action-loop', name: 'Retry 3 times' }
      ),
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Submit',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [100, 250],
        { id: 'action-find', name: 'Find Submit Button' }
      ),
      createAction(
        'IF',
        {
          condition: 'found',
          operator: 'equals',
          value: true,
        },
        [100, 400],
        { id: 'action-check', name: 'Check if Found' }
      ),
      createAction(
        'BREAK',
        {},
        [300, 400],
        { id: 'action-break', name: 'Break if Found' }
      ),
      createAction(
        'WAIT',
        {
          duration: 500,
        },
        [100, 550],
        { id: 'action-wait', name: 'Wait Before Retry' }
      ),
    ],
    connections: {
      'action-loop': {
        main: [[{ action: 'action-find', type: 'main', index: 0 }]],
      },
      'action-find': {
        main: [[{ action: 'action-check', type: 'main', index: 0 }]],
      },
      'action-check': {
        main: [
          [{ action: 'action-break', type: 'main', index: 0 }], // True branch
          [{ action: 'action-wait', type: 'main', index: 0 }], // False branch
        ],
      },
    },
  });

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <h3>Loop Workflow</h3>
      <WorkflowCanvas workflow={workflow} onWorkflowChange={setWorkflow} />
    </div>
  );
}

// ============================================================================
// Example 4: Complex Workflow with Error Handling
// ============================================================================

export function ComplexErrorHandlingExample() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'workflow-complex',
    name: 'Form Submission with Error Handling',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Name',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [100, 100],
        { id: 'action-1', name: 'Find Name Field' }
      ),
      createAction(
        'TYPE',
        {
          text: 'John Doe',
          clearBefore: true,
          pressEnter: false,
        },
        [100, 220],
        { id: 'action-2', name: 'Type Name' }
      ),
      createAction(
        'TRY_CATCH',
        {},
        [100, 340],
        { id: 'action-try', name: 'Try Submit' }
      ),
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Submit',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [350, 280],
        { id: 'action-submit-find', name: 'Find Submit' }
      ),
      createAction(
        'CLICK',
        {
          findBy: 'text',
          text: 'Submit',
          searchMultiple: false,
          searchRegions: [],
          clickType: 'single',
          offsetX: 0,
          offsetY: 0,
        },
        [350, 400],
        { id: 'action-submit-click', name: 'Click Submit' }
      ),
      createAction(
        'SCREENSHOT',
        {
          name: 'error-screenshot',
          fullScreen: true,
        },
        [350, 520],
        { id: 'action-error-screenshot', name: 'Screenshot on Error' }
      ),
      createAction(
        'SET_VARIABLE',
        {
          name: 'submission_status',
          value: 'failed',
          scope: 'local',
        },
        [600, 520],
        { id: 'action-set-failed', name: 'Mark as Failed' }
      ),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
      'action-2': {
        main: [[{ action: 'action-try', type: 'main', index: 0 }]],
      },
      'action-try': {
        main: [[{ action: 'action-submit-find', type: 'main', index: 0 }]], // Try branch
        error: [[{ action: 'action-error-screenshot', type: 'main', index: 0 }]], // Catch branch
      },
      'action-submit-find': {
        main: [[{ action: 'action-submit-click', type: 'main', index: 0 }]],
      },
      'action-error-screenshot': {
        main: [[{ action: 'action-set-failed', type: 'main', index: 0 }]],
      },
    },
  });

  return (
    <div style={{ width: '100%', height: '700px' }}>
      <h3>Complex Workflow with Error Handling</h3>
      <WorkflowCanvas workflow={workflow} onWorkflowChange={setWorkflow} />
    </div>
  );
}

// ============================================================================
// Example 5: Parallel Execution
// ============================================================================

export function ParallelExecutionExample() {
  const [workflow, setWorkflow] = useState<Workflow>({
    id: 'workflow-parallel',
    name: 'Parallel Data Extraction',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'SCREENSHOT',
        {
          name: 'page-screenshot',
          fullScreen: true,
        },
        [100, 100],
        { id: 'action-screenshot', name: 'Take Screenshot' }
      ),
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Title',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [350, 100],
        { id: 'action-find-title', name: 'Extract Title' }
      ),
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Price',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [350, 220],
        { id: 'action-find-price', name: 'Extract Price' }
      ),
      createAction(
        'FIND',
        {
          findBy: 'text',
          text: 'Description',
          searchMultiple: false,
          searchRegions: [],
          score: 0.8,
        },
        [350, 340],
        { id: 'action-find-desc', name: 'Extract Description' }
      ),
      createAction(
        'SET_VARIABLE',
        {
          name: 'product_data',
          value: {},
          scope: 'local',
        },
        [600, 220],
        { id: 'action-merge', name: 'Merge Results' }
      ),
    ],
    connections: {
      'action-screenshot': {
        parallel: [
          [{ action: 'action-find-title', type: 'main', index: 0 }],
          [{ action: 'action-find-price', type: 'main', index: 0 }],
          [{ action: 'action-find-desc', type: 'main', index: 0 }],
        ],
      },
      'action-find-title': {
        main: [[{ action: 'action-merge', type: 'main', index: 0 }]],
      },
      'action-find-price': {
        main: [[{ action: 'action-merge', type: 'main', index: 0 }]],
      },
      'action-find-desc': {
        main: [[{ action: 'action-merge', type: 'main', index: 0 }]],
      },
    },
  });

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <h3>Parallel Execution</h3>
      <WorkflowCanvas workflow={workflow} onWorkflowChange={setWorkflow} />
    </div>
  );
}

// ============================================================================
// Example 6: Readonly Mode
// ============================================================================

export function ReadonlyExample() {
  const workflow: Workflow = {
    id: 'workflow-readonly',
    name: 'Readonly Workflow',
    version: '1.0.0',
    format: 'graph',
    actions: [
      createAction(
        'CLICK',
        {
          findBy: 'text',
          text: 'Button',
          searchMultiple: false,
          searchRegions: [],
          clickType: 'single',
          offsetX: 0,
          offsetY: 0,
        },
        [100, 100],
        { id: 'action-1', name: 'Click Button' }
      ),
      createAction(
        'WAIT',
        {
          duration: 1000,
        },
        [100, 250],
        { id: 'action-2', name: 'Wait' }
      ),
    ],
    connections: {
      'action-1': {
        main: [[{ action: 'action-2', type: 'main', index: 0 }]],
      },
    },
  };

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <h3>Readonly Mode</h3>
      <WorkflowCanvas
        workflow={workflow}
        onWorkflowChange={() => {}}
        readonly={true}
      />
    </div>
  );
}

// ============================================================================
// All Examples Demo
// ============================================================================

export function AllExamplesDemo() {
  const [selectedExample, setSelectedExample] = useState('simple');

  return (
    <div style={{ padding: '20px' }}>
      <h2>Workflow Canvas Examples</h2>

      <div style={{ marginBottom: '20px' }}>
        <label>
          Select Example:{' '}
          <select
            value={selectedExample}
            onChange={(e) => setSelectedExample(e.target.value)}
            style={{ padding: '8px', fontSize: '14px' }}
          >
            <option value="simple">Simple Linear</option>
            <option value="branching">Branching (IF)</option>
            <option value="loop">Loop</option>
            <option value="complex">Complex Error Handling</option>
            <option value="parallel">Parallel Execution</option>
            <option value="readonly">Readonly Mode</option>
          </select>
        </label>
      </div>

      {selectedExample === 'simple' && <SimpleLinearExample />}
      {selectedExample === 'branching' && <BranchingIfExample />}
      {selectedExample === 'loop' && <LoopExample />}
      {selectedExample === 'complex' && <ComplexErrorHandlingExample />}
      {selectedExample === 'parallel' && <ParallelExecutionExample />}
      {selectedExample === 'readonly' && <ReadonlyExample />}
    </div>
  );
}

export default AllExamplesDemo;
