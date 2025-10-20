/**
 * Execution Debugger - Usage Examples
 *
 * This file contains practical examples of how to use the Execution Debugger
 * in different scenarios.
 */

import React, { useState, useEffect } from 'react';
import { ExecutionDebugger } from './ExecutionDebugger';
import { useExecutionDebugger } from '../../stores/execution-debugger-store';
import { Action, Process } from '../../contexts/automation-context/types';

// ============================================================================
// Example 1: Basic Usage with Simple Process
// ============================================================================

export function BasicDebuggerExample() {
  const [debuggerOpen, setDebuggerOpen] = useState(false);
  const { setDebugEnabled, initialize } = useExecutionDebugger();

  const simpleProcess: Process = {
    id: 'simple-1',
    name: 'Simple Login Process',
    description: 'Basic login flow',
    actions: [
      { id: '1', type: 'FIND', config: { description: 'Find username field' } },
      { id: '2', type: 'CLICK', config: { description: 'Click username field' } },
      { id: '3', type: 'TYPE', config: { text: 'user@example.com', description: 'Type username' } },
      { id: '4', type: 'FIND', config: { description: 'Find password field' } },
      { id: '5', type: 'CLICK', config: { description: 'Click password field' } },
      { id: '6', type: 'TYPE', config: { text: 'password123', description: 'Type password' } },
      { id: '7', type: 'FIND', config: { description: 'Find login button' } },
      { id: '8', type: 'CLICK', config: { description: 'Click login button' } },
    ],
  };

  useEffect(() => {
    // Enable debugger and initialize with action count
    setDebugEnabled(true);
    initialize(simpleProcess.actions.length);
  }, []);

  const handleExecute = () => {
    console.log('Starting execution...');
    // Your execution logic here
  };

  const handleStop = () => {
    console.log('Stopping execution...');
  };

  const handleStep = () => {
    console.log('Step forward...');
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Basic Debugger Example</h1>
      <ExecutionDebugger
        actions={simpleProcess.actions}
        onExecute={handleExecute}
        onStop={handleStop}
        onStep={handleStep}
        isOpen={debuggerOpen}
        onToggle={() => setDebuggerOpen(!debuggerOpen)}
      />
    </div>
  );
}

// ============================================================================
// Example 2: Debugging Control Flow (IF/LOOP)
// ============================================================================

export function ControlFlowDebuggerExample() {
  const {
    setDebugEnabled,
    initialize,
    recordConditionEvaluation,
    startLoop,
    updateLoopIteration,
    endLoop,
    setVariable,
  } = useExecutionDebugger();

  const controlFlowProcess: Process = {
    id: 'control-1',
    name: 'Control Flow Process',
    description: 'Process with IF and LOOP actions',
    actions: [
      { id: '1', type: 'SET_VARIABLE', config: { variableName: 'counter', value: 0 } },
      {
        id: '2',
        type: 'LOOP',
        config: {
          description: 'Loop 5 times',
          maxIterations: 5,
          loopVariable: 'i',
        },
      },
      { id: '3', type: 'SET_VARIABLE', config: { variableName: 'counter', value: '{{counter + 1}}' } },
      {
        id: '4',
        type: 'IF',
        config: {
          description: 'Check if counter > 3',
          condition: '{{counter > 3}}',
        },
      },
      { id: '5', type: 'CLICK', config: { description: 'Click special button' } },
      { id: '6', type: 'WAIT', config: { duration: 1000 } },
    ],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(controlFlowProcess.actions.length);
  }, []);

  // Simulate loop execution
  const simulateLoopExecution = async () => {
    const loopActionId = '2';
    const maxIterations = 5;

    // Start loop
    startLoop(loopActionId, maxIterations, 'i');

    for (let i = 0; i < maxIterations; i++) {
      // Update iteration
      updateLoopIteration(loopActionId);

      // Update counter variable
      setVariable('counter', i + 1, 2);

      // Evaluate IF condition
      const conditionResult = i + 1 > 3;
      recordConditionEvaluation({
        actionId: '4',
        condition: 'counter > 3',
        result: conditionResult,
        evaluatedAt: Date.now(),
        variables: { counter: i + 1 },
        branch: conditionResult ? 'if' : 'else',
      });

      // Simulate delay
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // End loop
    endLoop(loopActionId);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Control Flow Debugger Example</h1>
      <button
        onClick={simulateLoopExecution}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg mb-4"
      >
        Simulate Loop Execution
      </button>
      <ExecutionDebugger
        actions={controlFlowProcess.actions}
        onExecute={simulateLoopExecution}
        onStop={() => {}}
        onStep={() => {}}
      />
    </div>
  );
}

// ============================================================================
// Example 3: Variable Tracking
// ============================================================================

export function VariableTrackingExample() {
  const { setDebugEnabled, initialize, setVariable } = useExecutionDebugger();

  const variableProcess: Process = {
    id: 'var-1',
    name: 'Variable Processing',
    description: 'Process demonstrating variable operations',
    actions: [
      { id: '1', type: 'SET_VARIABLE', config: { variableName: 'username', value: 'john_doe' } },
      { id: '2', type: 'SET_VARIABLE', config: { variableName: 'email', value: 'john@example.com' } },
      {
        id: '3',
        type: 'SET_VARIABLE',
        config: {
          variableName: 'user',
          value: { name: 'John Doe', age: 30, active: true },
        },
      },
      {
        id: '4',
        type: 'SET_VARIABLE',
        config: { variableName: 'scores', value: [95, 87, 92, 88] },
      },
      {
        id: '5',
        type: 'MATH_OPERATION',
        config: {
          operation: 'average',
          variableName: 'averageScore',
          values: '{{scores}}',
        },
      },
    ],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(variableProcess.actions.length);
  }, []);

  const simulateVariableOperations = async () => {
    // Set simple variables
    setVariable('username', 'john_doe', 0);
    await new Promise(resolve => setTimeout(resolve, 500));

    setVariable('email', 'john@example.com', 1);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Set complex object
    setVariable('user', { name: 'John Doe', age: 30, active: true }, 2);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Set array
    setVariable('scores', [95, 87, 92, 88], 3);
    await new Promise(resolve => setTimeout(resolve, 500));

    // Calculate average
    const average = [95, 87, 92, 88].reduce((a, b) => a + b, 0) / 4;
    setVariable('averageScore', average, 4);
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Variable Tracking Example</h1>
      <button
        onClick={simulateVariableOperations}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg mb-4"
      >
        Simulate Variable Operations
      </button>
      <ExecutionDebugger
        actions={variableProcess.actions}
        onExecute={simulateVariableOperations}
        onStop={() => {}}
        onStep={() => {}}
      />
    </div>
  );
}

// ============================================================================
// Example 4: Breakpoint Usage
// ============================================================================

export function BreakpointExample() {
  const { setDebugEnabled, initialize, addBreakpoint, removeBreakpoint } =
    useExecutionDebugger();

  const breakpointProcess: Process = {
    id: 'bp-1',
    name: 'Breakpoint Demo',
    description: 'Demonstrating breakpoint usage',
    actions: [
      { id: '1', type: 'FIND', config: { description: 'Action 1' } },
      { id: '2', type: 'CLICK', config: { description: 'Action 2' } },
      { id: '3', type: 'TYPE', config: { description: 'Action 3 - Breakpoint here' } },
      { id: '4', type: 'FIND', config: { description: 'Action 4' } },
      { id: '5', type: 'CLICK', config: { description: 'Action 5 - Another breakpoint' } },
    ],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(breakpointProcess.actions.length);

    // Add breakpoints at specific actions
    addBreakpoint(2); // Break before action 3
    addBreakpoint(4); // Break before action 5
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Breakpoint Example</h1>
      <div className="mb-4 p-4 bg-blue-50 rounded-lg">
        <p className="text-sm text-blue-800">
          Breakpoints are set at actions 3 and 5. Execution will pause before these
          actions. Right-click on actions in the timeline to toggle breakpoints.
        </p>
      </div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => addBreakpoint(1)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg"
        >
          Add Breakpoint at Action 2
        </button>
        <button
          onClick={() => removeBreakpoint(2)}
          className="px-4 py-2 bg-red-600 text-white rounded-lg"
        >
          Remove Breakpoint at Action 3
        </button>
      </div>
      <ExecutionDebugger
        actions={breakpointProcess.actions}
        onExecute={() => {}}
        onStop={() => {}}
        onStep={() => {}}
      />
    </div>
  );
}

// ============================================================================
// Example 5: Speed Control
// ============================================================================

export function SpeedControlExample() {
  const { setDebugEnabled, initialize, setSpeed, speed } = useExecutionDebugger();

  const speedProcess: Process = {
    id: 'speed-1',
    name: 'Speed Control Demo',
    description: 'Demonstrating execution speed control',
    actions: Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      type: 'WAIT',
      config: { description: `Action ${i + 1}`, duration: 100 },
    })) as Action[],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(speedProcess.actions.length);
  }, []);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Speed Control Example</h1>
      <div className="mb-4 p-4 bg-green-50 rounded-lg">
        <p className="text-sm text-green-800 mb-2">
          Current speed: <strong>{speed}</strong>
        </p>
        <ul className="text-sm text-green-700 space-y-1">
          <li>Slow: 2000ms delay between actions</li>
          <li>Normal: 500ms delay between actions</li>
          <li>Fast: 100ms delay between actions</li>
        </ul>
      </div>
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSpeed('slow')}
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg"
        >
          Slow Speed
        </button>
        <button
          onClick={() => setSpeed('normal')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          Normal Speed
        </button>
        <button
          onClick={() => setSpeed('fast')}
          className="px-4 py-2 bg-green-600 text-white rounded-lg"
        >
          Fast Speed
        </button>
      </div>
      <ExecutionDebugger
        actions={speedProcess.actions}
        onExecute={() => {}}
        onStop={() => {}}
        onStep={() => {}}
      />
    </div>
  );
}

// ============================================================================
// Example 6: Log Management
// ============================================================================

export function LogManagementExample() {
  const { setDebugEnabled, initialize, addLog, clearLogs, exportLogs } =
    useExecutionDebugger();

  const logProcess: Process = {
    id: 'log-1',
    name: 'Log Management Demo',
    description: 'Demonstrating log management features',
    actions: [
      { id: '1', type: 'FIND', config: { description: 'Action 1' } },
      { id: '2', type: 'CLICK', config: { description: 'Action 2' } },
    ],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(logProcess.actions.length);
  }, []);

  const generateSampleLogs = () => {
    addLog('info', 'system', 'System initialized successfully');
    addLog('debug', 'action', 'Finding element on page', 0, { selector: '#username' });
    addLog('info', 'action', 'Element found', 0, { x: 100, y: 200 });
    addLog('warning', 'condition', 'Condition evaluated to false', undefined, {
      condition: 'x > 10',
      result: false,
    });
    addLog('error', 'action', 'Action failed: Element not found', 1, {
      selector: '#password',
      timeout: 5000,
    });
    addLog('info', 'variable', 'Variable set: count = 5', 0, {
      variableName: 'count',
      value: 5,
    });
    addLog('debug', 'loop', 'Loop iteration 1/5 completed', undefined, {
      iteration: 1,
      maxIterations: 5,
    });
  };

  const handleExportLogs = () => {
    const logs = exportLogs();
    console.log('Exported logs:', logs);
    // In a real app, you'd download this as a file
    const blob = new Blob([logs], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `execution-logs-${Date.now()}.json`;
    a.click();
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Log Management Example</h1>
      <div className="flex gap-2 mb-4">
        <button
          onClick={generateSampleLogs}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          Generate Sample Logs
        </button>
        <button
          onClick={handleExportLogs}
          className="px-4 py-2 bg-green-600 text-white rounded-lg"
        >
          Export Logs
        </button>
        <button
          onClick={clearLogs}
          className="px-4 py-2 bg-red-600 text-white rounded-lg"
        >
          Clear Logs
        </button>
      </div>
      <ExecutionDebugger
        actions={logProcess.actions}
        onExecute={() => {}}
        onStop={() => {}}
        onStep={() => {}}
      />
    </div>
  );
}

// ============================================================================
// Example 7: Complete Integration
// ============================================================================

export function CompleteIntegrationExample() {
  const [debuggerOpen, setDebuggerOpen] = useState(true);
  const {
    setDebugEnabled,
    initialize,
    startAction,
    completeAction,
    failAction,
    setVariable,
    play,
    pause,
    stop,
    state: debuggerState,
  } = useExecutionDebugger();

  const complexProcess: Process = {
    id: 'complex-1',
    name: 'E-Commerce Checkout',
    description: 'Complete checkout process with error handling',
    actions: [
      { id: '1', type: 'SET_VARIABLE', config: { variableName: 'cart', value: [] } },
      { id: '2', type: 'FIND', config: { description: 'Find product' } },
      { id: '3', type: 'CLICK', config: { description: 'Add to cart' } },
      {
        id: '4',
        type: 'SET_VARIABLE',
        config: { variableName: 'cart', value: '{{cart.push(product)}}' },
      },
      { id: '5', type: 'FIND', config: { description: 'Find checkout button' } },
      { id: '6', type: 'CLICK', config: { description: 'Go to checkout' } },
      {
        id: '7',
        type: 'IF',
        config: {
          condition: '{{cart.length > 0}}',
          description: 'Check if cart has items',
        },
      },
      { id: '8', type: 'FIND', config: { description: 'Find payment form' } },
      { id: '9', type: 'TYPE', config: { description: 'Enter card details' } },
      { id: '10', type: 'CLICK', config: { description: 'Submit payment' } },
    ],
  };

  useEffect(() => {
    setDebugEnabled(true);
    initialize(complexProcess.actions.length);
  }, []);

  const executeProcess = async () => {
    play();

    for (let i = 0; i < complexProcess.actions.length; i++) {
      const action = complexProcess.actions[i];

      // Start action
      startAction(i, action);

      // Simulate action execution
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Simulate variable operations
      if (action.type === 'SET_VARIABLE') {
        const varName = action.config.variableName;
        const value = action.config.value;
        setVariable(varName, value, i);
      }

      // Simulate success/failure
      const success = Math.random() > 0.1; // 90% success rate

      if (success) {
        completeAction(i, { success: true });
      } else {
        failAction(i, 'Simulated failure for demonstration');
        break;
      }
    }

    stop();
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Complete Integration Example</h1>
      <div className="mb-4 p-4 bg-purple-50 rounded-lg">
        <p className="text-sm text-purple-800 mb-2">
          This example demonstrates full integration with all debugger features:
        </p>
        <ul className="text-sm text-purple-700 space-y-1 list-disc list-inside">
          <li>Action execution tracking</li>
          <li>Variable management</li>
          <li>Control flow handling</li>
          <li>Error handling</li>
          <li>Real-time state updates</li>
          <li>Performance metrics</li>
        </ul>
      </div>
      <button
        onClick={executeProcess}
        disabled={debuggerState === 'running'}
        className="px-4 py-2 bg-blue-600 text-white rounded-lg mb-4 disabled:opacity-50"
      >
        Execute Process
      </button>
      <ExecutionDebugger
        actions={complexProcess.actions}
        onExecute={executeProcess}
        onStop={() => stop()}
        onStep={async () => {
          // Step logic here
        }}
        isOpen={debuggerOpen}
        onToggle={() => setDebuggerOpen(!debuggerOpen)}
      />
    </div>
  );
}
