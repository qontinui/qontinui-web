# Process Repetition Feature

## Overview

The Process Repetition feature allows you to repeat a process multiple times when using the `RUN_PROCESS` action. This is useful for scenarios where you need to perform an operation repeatedly, such as:

- **Farming/Grinding**: Repeat a sequence of actions to collect resources
- **Data Entry**: Process multiple items with the same workflow
- **Retry Logic**: Attempt an operation multiple times until it succeeds
- **Batch Processing**: Run the same process on multiple targets

## UI Configuration

### Location
**Build Automation Processes** tab → Select a `RUN_PROCESS` action → Action properties panel on the right

### Options

#### 1. Enable Repeat
A checkbox to enable process repetition. When enabled, additional options appear.

#### 2. Max Repeats
- **Type**: Integer (1-1000)
- **Default**: 10
- **Meaning**: Maximum number of times to run the process
  - When `untilSuccess` is **unchecked**: Runs exactly this many times
    - `1` = Run the process 1 more time (total: 2 executions)
    - `10` = Run the process 10 more times (total: 11 executions)
  - When `untilSuccess` is **checked**: Upper limit (stops early on success)
    - `10` = Try up to 10 more times, stop as soon as it succeeds

#### 3. Delay Between Repeats
- **Type**: Integer (milliseconds)
- **Default**: 0
- **Purpose**: Pause between each repeat execution
- **Use Cases**:
  - Give the application time to respond
  - Avoid overwhelming the system
  - Wait for animations or transitions
  - Simulate human-like timing

#### 4. Repeat Until Success or Max Repeats
- **Type**: Checkbox
- **Default**: Unchecked
- **When Unchecked** (Fixed Count Mode):
  - Runs exactly `maxRepeats` additional times
  - Executes all repeats regardless of success/failure
  - Use for: Batch processing, collecting multiple items, guaranteed repetitions
- **When Checked** (Until Success Mode):
  - Tries up to `maxRepeats` times
  - **Stops early** if the process succeeds
  - **Continues** up to `maxRepeats` if it keeps failing
  - Use for: Retry logic, waiting for conditions, unreliable operations
- **Important**: Requires the process to properly indicate success/failure (see PROCESS_SUCCESS_CRITERIA.md)

## JSON Export Format

When exported to JSON, the process repetition configuration appears in the `processRepetition` field of the action config:

```json
{
  "id": "action-123",
  "type": "RUN_PROCESS",
  "config": {
    "process": "process-id-to-run",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 10,
      "delay": 1000,
      "untilSuccess": true
    },
    "pauseBeforeBegin": 0,
    "pauseAfterEnd": 0
  },
  "timeout": 5000,
  "retryCount": 3,
  "continueOnError": false
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether process repetition is active |
| `maxRepeats` | number | Maximum number of additional repeats (1 = run once more) |
| `delay` | number | Milliseconds to pause between repeats |
| `untilSuccess` | boolean | If true, stop early on success; if false, run all maxRepeats |

## Implementation in qontinui Python

The qontinui runner needs to interpret the `processRepetition` configuration. Here's how it should work:

### Pseudocode Logic

```python
def execute_run_process_action(action_config):
    process_id = action_config.get('process')
    repetition = action_config.get('processRepetition', {})

    if not repetition.get('enabled', False):
        # No repetition - run once
        return run_process(process_id)

    # Repetition is enabled
    max_repeats = repetition.get('maxRepeats', 10)
    delay = repetition.get('delay', 0)
    until_success = repetition.get('untilSuccess', False)

    results = []
    total_runs = max_repeats + 1  # Initial run + repeats

    for run_number in range(total_runs):
        result = run_process(process_id)
        results.append(result)

        # Check if we should stop early (untilSuccess mode)
        if until_success and result.success:
            return ActionResult(
                success=True,
                message=f"Process succeeded on attempt {run_number + 1}",
                metadata={
                    'total_attempts': run_number + 1,
                    'stopped_early': True,
                    'results': results
                }
            )

        # Add delay between runs (but not after the last run)
        if run_number < total_runs - 1 and delay > 0:
            time.sleep(delay / 1000.0)  # Convert ms to seconds

    # Finished all runs
    if until_success:
        # untilSuccess mode: We ran all maxRepeats without success
        return ActionResult(
            success=False,
            message=f"Process failed after {total_runs} attempts",
            metadata={
                'total_attempts': total_runs,
                'reached_max': True,
                'results': results
            }
        )
    else:
        # Fixed count mode: Ran all repeats, aggregate results
        success_count = sum(1 for r in results if r.success)
        return ActionResult(
            success=success_count > 0,  # At least one succeeded
            message=f"Process repeated {max_repeats} times: {success_count}/{total_runs} succeeded",
            metadata={
                'total_attempts': total_runs,
                'success_count': success_count,
                'results': results
            }
        )
```

### Python Implementation Example

```python
# In qontinui/actions/composite/run_process_action.py

from qontinui.actions.action_config import ActionConfig
from qontinui.actions.action_result import ActionResult
import time

class RunProcessAction:
    def __init__(self, config: ActionConfig):
        self.config = config
        self.process_id = config.get('process')
        self.repetition = config.get('processRepetition', {})

    def execute(self) -> ActionResult:
        if not self.repetition.get('enabled', False):
            # No repetition - standard execution
            return self._run_process_once()

        # Handle repetition
        if self.repetition.get('untilSuccess', False):
            return self._repeat_until_success()
        else:
            return self._repeat_fixed_count()

    def _run_process_once(self) -> ActionResult:
        """Execute the process once"""
        process = self._get_process(self.process_id)
        return process.execute()

    def _repeat_until_success(self) -> ActionResult:
        """Repeat process until it succeeds or maxRepeats reached"""
        max_repeats = self.repetition.get('maxRepeats', 10)
        delay_ms = self.repetition.get('delay', 0)
        total_runs = max_repeats + 1

        results = []
        for run_num in range(total_runs):
            result = self._run_process_once()
            results.append(result)

            if result.success:
                # Success! Stop early
                return ActionResult(
                    success=True,
                    message=f"Process succeeded on attempt {run_num + 1}",
                    metadata={
                        'attempts': run_num + 1,
                        'stopped_early': True,
                        'results': results
                    }
                )

            # Delay before next attempt (but not after last)
            if run_num < total_runs - 1 and delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

        # Reached maxRepeats without success
        return ActionResult(
            success=False,
            message=f"Process '{self.process_id}' failed after {total_runs} attempts",
            metadata={
                'attempts': total_runs,
                'reached_max': True,
                'results': results
            }
        )

    def _repeat_fixed_count(self) -> ActionResult:
        """Repeat process a fixed number of times"""
        max_repeats = self.repetition.get('maxRepeats', 10)
        delay_ms = self.repetition.get('delay', 0)
        total_runs = max_repeats + 1  # Initial run + repeats

        results = []
        for run_num in range(total_runs):
            result = self._run_process_once()
            results.append(result)

            # Delay between runs
            if run_num < total_runs - 1 and delay_ms > 0:
                time.sleep(delay_ms / 1000.0)

        # Aggregate results
        success_count = sum(1 for r in results if r.success)
        at_least_one_success = success_count > 0

        return ActionResult(
            success=at_least_one_success,
            message=f"Process repeated {max_repeats} times: {success_count}/{total_runs} succeeded",
            metadata={
                'results': results,
                'success_count': success_count,
                'total_runs': total_runs
            }
        )

    def _get_process(self, process_id: str):
        """Get process by ID from state manager"""
        # Implementation depends on your state manager
        pass
```

## Use Cases and Examples

### Example 1: Fixed Repetition with Delay

**Scenario**: Collect daily rewards from 5 different characters

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "collect-daily-reward",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 4,
      "delay": 2000,
      "untilSuccess": false
    }
  }
}
```

**Behavior**:
- Runs "collect-daily-reward" process 5 times total (1 initial + 4 repeats)
- Waits 2 seconds between each execution
- Runs **all 5 times** regardless of success/failure
- Total time: ~8 seconds (4 delays × 2 seconds) + execution time
- Success if at least one execution succeeded

### Example 2: Repeat Until Success or Max Repeats

**Scenario**: Keep trying to claim a bonus until it works (up to 20 attempts)

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "claim-bonus",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 19,
      "delay": 1000,
      "untilSuccess": true
    }
  }
}
```

**Behavior**:
- Tries "claim-bonus" process up to 20 times (1 initial + 19 repeats)
- **Stops early** if process succeeds
- Waits 1 second between attempts
- Fails if all 20 attempts fail

### Example 3: No Repetition

**Scenario**: Run a process once (default behavior)

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "single-action"
  }
}
```

**Behavior**: Runs once, no repetition

## Integration with Other Features

### Timing Options
Process repetition works alongside pause options:

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "my-process",
    "processRepetition": {
      "enabled": true,
      "count": 3,
      "delay": 1000
    },
    "pauseBeforeBegin": 500,
    "pauseAfterEnd": 500
  }
}
```

**Execution Timeline**:
1. Pause 500ms (pauseBeforeBegin)
2. Run process #1
3. Pause 1000ms (repeat delay)
4. Run process #2
5. Pause 1000ms (repeat delay)
6. Run process #3
7. Pause 1000ms (repeat delay)
8. Run process #4
9. Pause 500ms (pauseAfterEnd)

### Error Handling
- If `continueOnError` is true in the action, failures won't stop the repetition
- If false, the first failure will abort the repetition
- "Repeat Until Success" mode will keep trying regardless

### Verification Options
Can be combined with verification to ensure process success:

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "farm-resource",
    "processRepetition": {
      "enabled": true,
      "count": 10,
      "delay": 3000
    },
    "verificationOptions": {
      "event": "IMAGE_APPEARS",
      "images": ["success-indicator"],
      "timeout": 5000
    }
  }
}
```

## Best Practices

### 1. Set Appropriate Delays
- Too short: May not give the application time to respond
- Too long: Wastes time
- **Recommendation**: Start with 1-2 seconds and adjust based on testing

### 2. Use "Repeat Until Success" Wisely
- Always set a reasonable `maxAttempts` to prevent infinite loops
- Ensure the process has clear success/failure indicators
- Good for: Network requests, UI interactions that may fail
- Avoid for: Guaranteed operations (wastes time checking)

### 3. Consider Total Execution Time
- `count=10, delay=5000ms` = ~50 seconds minimum
- Factor in process execution time itself
- Set appropriate timeouts at the action level

### 4. Logging and Debugging
- Enable detailed logging to track repetition progress
- Use the `illustrate` option to visualize each iteration
- Monitor `success_count` in results

### 5. Combine with State Management
- Use state transitions to track repetition progress
- Store results in state variables for later use
- Handle different outcomes (all success, partial success, all fail)

## Migration from Older Versions

If you have existing `RUN_PROCESS` actions without repetition:

**Old format** (no repetition):
```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "my-process"
  }
}
```

**New format** (backward compatible):
- Old format still works - processes run once by default
- No migration needed
- Add `processRepetition` when you want repetition

## Troubleshooting

### Process Never Succeeds (Infinite Loop)
- Check `maxAttempts` is set when using `untilSuccess`
- Verify process has proper success criteria
- Review process logs to see why it's failing

### Repetition Not Working
- Ensure `enabled: true` in `processRepetition`
- Check that `count` is > 0
- Verify the process ID exists

### Unexpected Timing
- Check both `delay` in repetition AND pause options
- Remember: delay is in milliseconds (1000 = 1 second)
- Total time = (count + 1) × (process_time + delay)

### Performance Issues
- Reduce `count` if too many iterations
- Increase `delay` to reduce system load
- Consider splitting into multiple smaller processes

## Files Modified

1. **UI Component**: `/frontend/src/components/action-properties.tsx`
   - Added repeat configuration UI for RUN_PROCESS actions

2. **Export Schema**: `/frontend/src/lib/export-schema.ts`
   - Added `processRepetition` interface to `ActionConfig`

3. **Config Exporter**: `/frontend/src/lib/config-exporter.ts`
   - Export `processRepetition` options for RUN_PROCESS actions

## Future Enhancements

Potential improvements for future versions:

1. **Dynamic Repeat Count**: Use state variables to determine count
2. **Conditional Repetition**: Repeat based on custom conditions
3. **Parallel Execution**: Run multiple repeats concurrently
4. **Progress Callbacks**: Hook into repetition events
5. **Result Aggregation Strategies**: Different ways to combine results
6. **Loop Variables**: Access iteration number in the process

## Summary

The Process Repetition feature provides powerful control over process execution:

✅ **Flexible Repetition**: Fixed count or until success
✅ **Timing Control**: Configurable delays between repeats
✅ **Safety**: Max attempts prevents infinite loops
✅ **Integration**: Works with all existing action features
✅ **Backward Compatible**: Old configs work without changes

This feature enables complex automation scenarios while maintaining simplicity and reliability.
