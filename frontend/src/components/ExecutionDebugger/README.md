# Execution Debugger System

A comprehensive visual debugging and execution flow visualization system for qontinui-web that provides real-time insights into process execution.

## Overview

The Execution Debugger is a powerful tool designed to help developers and users understand what happens during process execution, especially for complex control flow operations like IF statements and LOOP actions. It provides real-time visualization of execution state, variable values, and detailed logging.

## Architecture

### Components

#### 1. **ExecutionDebugger.tsx** (Main Component)
The container component that orchestrates all debugger functionality:
- Toggleable sidebar or modal view
- Tab-based interface (Timeline, Variables, Log)
- Enable/disable toggle for debugging
- Collapsible and expandable layout
- Integration with ProcessExecutor

#### 2. **ExecutionControls.tsx**
Playback control interface:
- Play/Pause execution
- Stop execution
- Step forward (execute one action at a time)
- Speed control (slow, normal, fast)
- Current execution state indicator

#### 3. **ActionTimeline.tsx**
Visual timeline of action execution:
- Color-coded action status (pending, executing, success, failed, skipped)
- Execution order numbers
- Action type indicators (special icons for IF/LOOP)
- Execution count badges for repeated actions
- Duration display
- Breakpoint indicators
- Auto-scroll to current action
- Right-click to toggle breakpoints

#### 4. **VariableInspector.tsx**
Real-time variable state inspection:
- Tree view for nested objects/arrays
- New variable highlighting
- Changed variable highlighting
- Variable history view
- Search/filter functionality
- Loop iteration counters
- Expandable/collapsible nodes

#### 5. **ExecutionLog.tsx**
Comprehensive execution event logging:
- Timestamped log entries
- Level-based filtering (info, warning, error, debug)
- Category-based filtering (action, condition, loop, variable, system)
- Expandable detail views
- Auto-scroll with manual override
- Export logs to JSON
- Clear logs functionality

### State Management

#### execution-debugger-store.ts (Zustand Store)
Centralized state management for all debugger functionality:

**State:**
- Execution state (idle, running, paused, stepping, completed, error)
- Current action index
- Action execution events and history
- Variable context and history
- Condition evaluations
- Loop states
- Breakpoint configurations
- Execution logs
- Performance metrics

**Actions:**
- State transitions (play, pause, stop, step)
- Action lifecycle tracking (start, complete, fail, skip)
- Variable management (set, get, delete)
- Breakpoint management (add, remove, toggle)
- Loop tracking (start, update, end)
- Condition evaluation recording
- Log management (add, clear, export)

### Type System

#### execution-types.ts
Comprehensive type definitions:
- `ExecutionState`: Execution state enum
- `ActionExecutionStatus`: Action status enum
- `ExecutionSpeed`: Speed control enum
- `VariableValue`: Variable with metadata
- `ExecutionContext`: Variable and loop context
- `ConditionEvaluation`: IF/SWITCH condition results
- `LoopState`: Loop iteration tracking
- `ActionExecutionEvent`: Action execution details
- `BreakpointConfig`: Breakpoint configuration
- `ExecutionLogEntry`: Log entry structure
- `ExecutionDebuggerState`: Complete debugger state

## Features

### 1. Real-Time Execution State Visualization
- Current action highlighting
- Progress tracking
- Execution timeline
- State transitions

### 2. Action Timeline Enhancement
Color-coded status indicators:
- **Gray**: Pending (not yet executed)
- **Yellow**: Executing (currently running)
- **Green**: Success (completed successfully)
- **Red**: Failed (error occurred)
- **Orange**: Skipped (conditionally skipped)

Additional features:
- Execution order numbers
- Action type badges
- Execution count for loops
- Duration metrics
- Breakpoint indicators

### 3. Variable Inspector
- Real-time variable tracking
- Nested object/array visualization
- Variable change highlighting
- History view showing all changes
- Loop iteration counters
- Search and filter

### 4. Execution Controls
- **Play**: Start or resume execution
- **Pause**: Pause at current action
- **Stop**: Stop execution completely
- **Step**: Execute one action at a time
- **Speed Control**: Adjust execution speed (slow: 2s delay, normal: 500ms, fast: 100ms)

### 5. Execution Log
Comprehensive event logging with:
- Timestamps (HH:MM:SS.mmm format)
- Log levels (info, warning, error, debug)
- Categories (action, condition, loop, variable, system)
- Expandable details
- Filtering by level and category
- Export to JSON
- Auto-scroll with manual override

### 6. Breakpoints
- Click action timeline to add/remove breakpoints
- Execution pauses before breakpoint action
- Visual breakpoint indicators
- Conditional breakpoints (future enhancement)

### 7. Performance Metrics
- Total execution time
- Average action time
- Success rate percentage
- Real-time updates

## Integration with ProcessExecutor

The debugger integrates seamlessly with ProcessExecutor:

```typescript
// Initialize debugger with action count
initializeDebugger(process.actions.length);

// Track action start
startAction(index, action);

// Track action completion
completeAction(index, result, error);

// Track action failure
failAction(index, error, stackTrace);

// Track variables
setVariable(name, value, actionIndex);

// Check breakpoints
if (shouldBreakAt(index)) {
  // Pause execution
}
```

### Event Flow

1. **Execution Start**:
   - Initialize debugger state
   - Set all actions to pending
   - Start execution timer

2. **Action Execution**:
   - Mark action as executing
   - Update timeline
   - Apply speed delay
   - Check breakpoints

3. **Action Completion**:
   - Mark as success/failed
   - Record duration
   - Update metrics
   - Log results

4. **Variable Changes**:
   - Track SET_VARIABLE actions
   - Record in variable history
   - Highlight in inspector

5. **Control Flow**:
   - Record IF/SWITCH conditions
   - Track loop iterations
   - Log branch decisions

## Usage

### Basic Usage

```typescript
import { ExecutionDebugger } from '@/components/ExecutionDebugger';
import { useExecutionDebugger } from '@/stores/execution-debugger-store';

function MyComponent() {
  const { setDebugEnabled } = useExecutionDebugger();

  return (
    <>
      <ExecutionDebugger
        actions={process.actions}
        onExecute={handleExecute}
        onStop={handleStop}
        onStep={handleStep}
        isOpen={debuggerOpen}
        onToggle={() => setDebuggerOpen(!debuggerOpen)}
      />
    </>
  );
}
```

### Enable/Disable Debugging

```typescript
const { debugEnabled, setDebugEnabled } = useExecutionDebugger();

// Enable debugging
setDebugEnabled(true);

// Disable debugging (resets all state)
setDebugEnabled(false);
```

### Programmatic Control

```typescript
const {
  play,
  pause,
  stop,
  step,
  setSpeed,
  addBreakpoint,
  removeBreakpoint,
} = useExecutionDebugger();

// Start execution
play();

// Step through one action
step();

// Add breakpoint at action 5
addBreakpoint(5);

// Set execution speed
setSpeed('slow'); // 'slow' | 'normal' | 'fast'
```

## Performance Considerations

### When Debugger is Disabled
- **Zero overhead**: No state tracking or event recording
- **Minimal memory**: Only stores enabled flag
- **Fast execution**: No delays or breakpoint checks

### When Debugger is Enabled
- **Efficient updates**: Only renders active tab
- **Lazy evaluation**: Details expanded on demand
- **Smart scrolling**: Auto-scroll can be disabled
- **Filtered logs**: Show only relevant entries
- **Bounded history**: Configurable history limits (future)

### Optimization Strategies
1. **Conditional rendering**: Components only render when tab is active
2. **Event batching**: Multiple events batched before state update
3. **Virtualization**: Long lists use virtual scrolling (future)
4. **Debounced updates**: UI updates debounced for performance
5. **Memory management**: Old logs can be cleared manually

## Future Enhancements

### Planned Features
1. **Conditional Breakpoints**: Break when variable equals value
2. **Watch Expressions**: Monitor specific expressions
3. **Call Stack Visualization**: Show nested process calls
4. **Time Travel Debugging**: Step backwards through execution
5. **Screenshot Capture**: Visual state at each action
6. **Performance Profiling**: Identify slow actions
7. **Network Request Tracking**: Monitor API calls
8. **State Diff Viewer**: Compare state before/after
9. **Export Test Cases**: Generate tests from execution
10. **Remote Debugging**: Debug remote process execution

### UI/UX Improvements
1. **Dark mode**: Theme support
2. **Keyboard shortcuts**: Full keyboard navigation
3. **Dockable panels**: Customizable layout
4. **Mini-map**: Overview of entire execution
5. **Search in logs**: Full-text search
6. **Bookmarks**: Mark important log entries
7. **Annotations**: Add notes to actions
8. **Compare executions**: Side-by-side comparison

### Advanced Debugging
1. **Hot reload**: Update actions during execution
2. **Mock responses**: Override action results
3. **Replay mode**: Re-run with recorded inputs
4. **Branch visualization**: Visual IF/SWITCH tree
5. **Loop analysis**: Performance metrics per iteration
6. **Memory profiling**: Track memory usage
7. **Error recovery**: Suggest fixes for failures

## Best Practices

### For Developers
1. Always disable debugger in production
2. Use descriptive variable names
3. Add action descriptions for clarity
4. Set breakpoints at decision points
5. Monitor performance metrics
6. Export logs for issue reporting

### For Users
1. Enable debugger for complex processes
2. Use step mode to understand flow
3. Watch variables to track state changes
4. Review logs for troubleshooting
5. Adjust speed for readability
6. Clear logs periodically

## Troubleshooting

### Debugger Not Showing
- Check that `debugEnabled` is true
- Verify `isOpen` prop is true
- Ensure actions array is not empty

### Actions Not Tracking
- Confirm debugger is enabled before execution
- Check that `startAction` and `completeAction` are called
- Verify action index is correct

### Performance Issues
- Disable debugger for large processes (>1000 actions)
- Clear logs regularly
- Use filtered log view
- Reduce execution speed

### Variables Not Updating
- Ensure SET_VARIABLE actions have correct config
- Check that `setVariable` is called in ProcessExecutor
- Verify variable name matches

## Technical Notes

### Dependencies
- React 18+
- Zustand 4+ (state management)
- Lucide React (icons)
- TypeScript 5+

### Browser Compatibility
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

### Accessibility
- Keyboard navigation supported
- ARIA labels for screen readers
- High contrast mode compatible
- Focus management implemented

## License

Part of qontinui-web project. See main project license.

## Contributing

Contributions welcome! Please follow the project's coding standards and submit PRs for review.

## Support

For issues or questions, please file an issue in the main qontinui-web repository.
