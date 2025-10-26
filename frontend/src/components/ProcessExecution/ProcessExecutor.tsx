import React, { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  Square,
  RotateCcw,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Terminal,
  ChevronRight,
  Clock,
  Activity,
  Bug
} from 'lucide-react';
import { Process, Action, State } from '../../contexts/automation-context';
import { qontinuiAPI } from '../../lib/qontinui-api-client';
import { ExecutionDebugger } from '../ExecutionDebugger';
import { useExecutionDebugger } from '../../stores/execution-debugger-store';

interface ProcessExecutorProps {
  process: Process;
  states: State[];
  onComplete?: (success: boolean, results: ExecutionResult[]) => void;
}

interface ExecutionResult {
  actionIndex: number;
  action: Action;
  success: boolean;
  duration: number;
  error?: string;
  matches?: any[];
  screenshot?: string;
}

interface ExecutionStatus {
  isRunning: boolean;
  isPaused: boolean;
  currentAction: number;
  totalActions: number;
  startTime?: number;
  endTime?: number;
  results: ExecutionResult[];
}

export const ProcessExecutor: React.FC<ProcessExecutorProps> = ({
  process,
  states,
  onComplete
}) => {
  const [status, setStatus] = useState<ExecutionStatus>({
    isRunning: false,
    isPaused: false,
    currentAction: -1,
    totalActions: process.actions.length,
    results: []
  });

  const [apiConnected, setApiConnected] = useState(false);
  const [executionLog, setExecutionLog] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [debuggerOpen, setDebuggerOpen] = useState(false);

  // Debugger store
  const {
    debugEnabled,
    initialize: initializeDebugger,
    startAction,
    completeAction,
    failAction,
    setVariable,
    play: playDebugger,
    pause: pauseDebugger,
    stop: stopDebugger,
    step: stepDebugger,
    state: debuggerState,
    speed: debuggerSpeed,
    shouldBreakAt,
  } = useExecutionDebugger();

  useEffect(() => {
    checkAPIConnection();
  }, []);

  // Initialize debugger when process changes
  useEffect(() => {
    if (debugEnabled) {
      initializeDebugger(process.actions.length);
    }
  }, [process.actions.length, debugEnabled, initializeDebugger]);

  const checkAPIConnection = async () => {
    const connected = await qontinuiAPI.testConnection();
    setApiConnected(connected);
  };

  const addLog = (message: string, level: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    const prefix = {
      info: 'ℹ️',
      success: '✅',
      error: '❌',
      warning: '⚠️'
    }[level];

    setExecutionLog(prev => [...prev, `[${timestamp}] ${prefix} ${message}`]);
  };

  const executeAction = async (action: Action, index: number): Promise<ExecutionResult> => {
    const startTime = Date.now();

    // Notify debugger of action start
    if (debugEnabled) {
      startAction(index, action);
    }

    try {
      addLog(`Executing action ${index + 1}: ${action.type}`, 'info');

      // Simulate action execution based on type
      // In production, this would call the actual qontinui API
      let success = false;
      let matches: any[] = [];
      let error: string | undefined;

      switch (action.type) {
        case 'FIND':
        case 'FIND_STATE_IMAGE':
          // Simulate find operation
          await new Promise(resolve => setTimeout(resolve, 500));
          success = Math.random() > 0.2; // 80% success rate for demo
          if (success) {
            matches = [{
              region: { x: 100, y: 100, width: 50, height: 50 },
              score: 0.85 + Math.random() * 0.15
            }];
            addLog(`Found ${matches.length} match(es)`, 'success');
          } else {
            error = 'No matches found';
            addLog(error, 'warning');
          }
          break;

        case 'CLICK':
          await new Promise(resolve => setTimeout(resolve, 300));
          success = true;
          addLog(`Clicked at position`, 'success');
          break;

        case 'TYPE':
          await new Promise(resolve => setTimeout(resolve, 800));
          success = true;
          addLog(`Typed text: "${action.config.text || ''}"`, 'success');
          break;

        case 'WAIT':
          const waitTime = action.config.duration || 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          success = true;
          addLog(`Waited ${waitTime}ms`, 'success');
          break;

        case 'GO_TO_STATE':
          await new Promise(resolve => setTimeout(resolve, 400));
          success = Math.random() > 0.1; // 90% success rate
          if (success) {
            addLog(`Transitioned to state: ${action.config.targetState}`, 'success');
          } else {
            error = 'Failed to transition to state';
            addLog(error, 'error');
          }
          break;

        case 'RUN_WORKFLOW':
          await new Promise(resolve => setTimeout(resolve, 1000));
          success = true;
          addLog(`Running sub-workflow: ${action.config.workflowId}`, 'info');
          break;

        default:
          await new Promise(resolve => setTimeout(resolve, 200));
          success = true;
          break;
      }

      const duration = Date.now() - startTime;

      // Notify debugger of action completion
      if (debugEnabled) {
        completeAction(index, matches, error);
      }

      // Handle SET_VARIABLE action for debugger
      if (debugEnabled && action.type === 'SET_VARIABLE' && action.config.variableName) {
        setVariable(action.config.variableName, action.config.value, index);
      }

      return {
        actionIndex: index,
        action,
        success,
        duration,
        error,
        matches
      };
    } catch (err) {
      const duration = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      addLog(`Action failed: ${errorMsg}`, 'error');

      // Notify debugger of action failure
      if (debugEnabled) {
        failAction(index, errorMsg, err instanceof Error ? err.stack : undefined);
      }

      return {
        actionIndex: index,
        action,
        success: false,
        duration,
        error: errorMsg
      };
    }
  };

  const startExecution = async () => {
    if (!apiConnected) {
      addLog('API not connected. Please ensure qontinui-api is running.', 'error');
      return;
    }

    setStatus(prev => ({
      ...prev,
      isRunning: true,
      isPaused: false,
      currentAction: 0,
      startTime: Date.now(),
      results: []
    }));

    // Notify debugger
    if (debugEnabled) {
      playDebugger();
    }

    addLog(`Starting execution of process: ${process.name}`, 'info');
    addLog(`Total actions to execute: ${process.actions.length}`, 'info');

    const results: ExecutionResult[] = [];

    for (let i = 0; i < process.actions.length; i++) {
      if (!status.isRunning || status.isPaused) break;

      // Check for breakpoints
      if (debugEnabled && shouldBreakAt(i)) {
        pauseDebugger();
        setStatus(prev => ({ ...prev, isPaused: true }));
        addLog(`Execution paused at breakpoint (action ${i})`, 'warning');
        break;
      }

      setStatus(prev => ({ ...prev, currentAction: i }));

      const result = await executeAction(process.actions[i], i);
      results.push(result);

      setStatus(prev => ({
        ...prev,
        results: [...prev.results, result]
      }));

      if (!result.success) {
        addLog(`Process stopped due to failed action at step ${i + 1}`, 'error');
        break;
      }

      // Apply speed delay based on debugger settings
      if (debugEnabled) {
        const delayMap = { slow: 2000, normal: 500, fast: 100 };
        await new Promise(resolve => setTimeout(resolve, delayMap[debuggerSpeed]));
      }
    }

    const endTime = Date.now();
    const success = results.every(r => r.success);

    setStatus(prev => ({
      ...prev,
      isRunning: false,
      currentAction: -1,
      endTime
    }));

    addLog(
      `Process completed: ${success ? 'SUCCESS' : 'FAILED'} (${results.length}/${process.actions.length} actions)`,
      success ? 'success' : 'error'
    );

    if (onComplete) {
      onComplete(success, results);
    }
  };

  const pauseExecution = () => {
    setStatus(prev => ({ ...prev, isPaused: true }));
    if (debugEnabled) {
      pauseDebugger();
    }
    addLog('Execution paused', 'warning');
  };

  const resumeExecution = () => {
    setStatus(prev => ({ ...prev, isPaused: false }));
    if (debugEnabled) {
      playDebugger();
    }
    addLog('Execution resumed', 'info');
  };

  const stopExecution = () => {
    setStatus(prev => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      currentAction: -1
    }));
    if (debugEnabled) {
      stopDebugger();
    }
    addLog('Execution stopped by user', 'warning');
  };

  const stepForward = async () => {
    if (!apiConnected) {
      addLog('API not connected. Please ensure qontinui-api is running.', 'error');
      return;
    }

    const currentIndex = status.currentAction === -1 ? 0 : status.currentAction + 1;

    if (currentIndex >= process.actions.length) {
      addLog('No more actions to execute', 'info');
      return;
    }

    if (debugEnabled) {
      stepDebugger();
    }

    setStatus(prev => ({
      ...prev,
      isRunning: true,
      isPaused: false,
      currentAction: currentIndex,
      startTime: prev.startTime || Date.now(),
    }));

    const result = await executeAction(process.actions[currentIndex], currentIndex);

    setStatus(prev => ({
      ...prev,
      results: [...prev.results, result],
      isPaused: true,
    }));

    addLog(`Step completed: ${result.success ? 'SUCCESS' : 'FAILED'}`, result.success ? 'success' : 'error');
  };

  const resetExecution = () => {
    setStatus({
      isRunning: false,
      isPaused: false,
      currentAction: -1,
      totalActions: process.actions.length,
      results: []
    });
    setExecutionLog([]);
    addLog('Execution reset', 'info');
  };

  const getElapsedTime = () => {
    if (!status.startTime) return '0:00';
    const elapsed = (status.endTime || Date.now()) - status.startTime;
    const minutes = Math.floor(elapsed / 60000);
    const seconds = Math.floor((elapsed % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const getSuccessRate = () => {
    if (status.results.length === 0) return 0;
    const successful = status.results.filter(r => r.success).length;
    return (successful / status.results.length) * 100;
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border relative">
      {/* Execution Debugger */}
      {debugEnabled && (
        <ExecutionDebugger
          actions={process.actions}
          onExecute={startExecution}
          onStop={stopExecution}
          onStep={stepForward}
          isOpen={debuggerOpen}
          onToggle={() => setDebuggerOpen(!debuggerOpen)}
        />
      )}

      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Terminal className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="font-semibold">{process.name}</h3>
              <p className="text-sm text-gray-600">
                {status.isRunning ? (
                  <>
                    Action {status.currentAction + 1} of {status.totalActions}
                  </>
                ) : (
                  <>
                    {status.totalActions} actions ready
                  </>
                )}
              </p>
            </div>
          </div>

          {/* Control Buttons */}
          <div className="flex items-center gap-2">
            {/* Debugger Toggle */}
            <button
              onClick={() => setDebuggerOpen(!debuggerOpen)}
              className={`p-2 rounded-lg transition-colors ${
                debuggerOpen
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-100 text-gray-600'
              }`}
              title="Toggle debugger"
            >
              <Bug className="w-4 h-4" />
            </button>

            {!status.isRunning ? (
              <button
                onClick={startExecution}
                disabled={!apiConnected}
                className={`px-4 py-2 rounded-lg flex items-center gap-2 ${
                  apiConnected
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                <Play className="w-4 h-4" />
                Run
              </button>
            ) : (
              <>
                {status.isPaused ? (
                  <button
                    onClick={resumeExecution}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                  >
                    <Play className="w-4 h-4" />
                    Resume
                  </button>
                ) : (
                  <button
                    onClick={pauseExecution}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center gap-2"
                  >
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                )}
                <button
                  onClick={stopExecution}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              </>
            )}

            {status.results.length > 0 && !status.isRunning && (
              <button
                onClick={resetExecution}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                Reset
              </button>
            )}

            <button
              onClick={() => setShowDetails(!showDetails)}
              className="p-2 hover:bg-gray-100 rounded-lg"
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${showDetails ? 'rotate-90' : ''}`} />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {status.isRunning && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-1">
              <span>Progress</span>
              <span>{Math.round((status.currentAction / status.totalActions) * 100)}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all"
                style={{ width: `${(status.currentAction / status.totalActions) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Statistics */}
        {(status.isRunning || status.results.length > 0) && (
          <div className="flex items-center gap-6 mt-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-gray-500" />
              <span>Time: {getElapsedTime()}</span>
            </div>
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-gray-500" />
              <span>Success Rate: {getSuccessRate().toFixed(0)}%</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>{status.results.filter(r => r.success).length}</span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              <span>{status.results.filter(r => !r.success).length}</span>
            </div>
          </div>
        )}
      </div>

      {/* Details Panel */}
      {showDetails && (
        <div className="border-t">
          {/* Action List */}
          <div className="max-h-64 overflow-y-auto">
            {process.actions.map((action, index) => {
              const result = status.results.find(r => r.actionIndex === index);
              const isCurrent = status.currentAction === index;

              return (
                <div
                  key={index}
                  className={`px-4 py-2 border-b flex items-center justify-between ${
                    isCurrent ? 'bg-blue-50' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-mono text-gray-500">{index + 1}</span>
                    <span className="text-sm font-medium">{action.type}</span>
                    {action.config.description && (
                      <span className="text-sm text-gray-600">{action.config.description}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isCurrent && status.isRunning && (
                      <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                    )}
                    {result && (
                      <>
                        {result.success ? (
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-500" />
                        )}
                        <span className="text-xs text-gray-500">{result.duration}ms</span>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Execution Log */}
          {executionLog.length > 0 && (
            <div className="bg-gray-900 text-gray-100 p-4 max-h-48 overflow-y-auto">
              <div className="font-mono text-xs space-y-1">
                {executionLog.map((log, index) => (
                  <div key={index}>{log}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProcessExecutor;
