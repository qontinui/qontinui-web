# Process Success Criteria in Qontinui

## Overview

Understanding what determines **process success** is critical for using the Process Repetition feature effectively. This document explains how qontinui determines whether a process has succeeded or failed.

## Process Success Determination

A **Process** in qontinui is a sequence of **Actions**. The success of a process depends on the success of its individual actions.

### Default Success Logic

By default, a process is considered **successful** if:

1. ✅ **All actions complete** without throwing errors
2. ✅ **All actions return success** (based on their individual success criteria)
3. ✅ **No action explicitly fails** (returns `success: false`)

A process **fails** if:

1. ❌ **Any action throws an exception** (unless `continueOnError` is true)
2. ❌ **Any action returns `success: false`** (unless `continueOnError` is true)
3. ❌ **A timeout occurs** at the process or action level
4. ❌ **Required resources are not found** (images, states, etc.)

## Individual Action Success Criteria

Each action type has its own success criteria:

### FIND Actions
**Success when:**
- Image/pattern is found within the timeout period
- Match meets the similarity threshold
- At least `minMatches` are found (if specified)

**Failure when:**
- Image not found before timeout
- No matches meet similarity threshold
- Fewer than `minMatches` found

**Example**:
```python
# Success: Found the button image
FindAction(image="button.png", similarity=0.85, timeout=5.0)
# Result: success=True, found 1 match

# Failure: Image not found
FindAction(image="missing.png", timeout=2.0)
# Result: success=False, no matches found
```

### CLICK Actions
**Success when:**
- Click is executed at the target location
- No errors occur during execution
- Optional verification passes (if configured)

**Failure when:**
- Target location invalid or out of bounds
- Unable to perform mouse action
- Verification fails (if configured)

**Example**:
```python
# Success: Clicked at coordinates
ClickAction(target="Last Find Result")
# Result: success=True

# With verification - Success only if image appears
ClickAction(
    target="coordinates",
    verificationOptions={
        "event": "IMAGE_APPEARS",
        "images": ["success-popup"],
        "timeout": 3000
    }
)
# Result: success=True only if success-popup appears within 3 seconds
```

### TYPE Actions
**Success when:**
- Text is typed without errors
- Optional verification passes

**Failure when:**
- Cannot focus on target element
- Keyboard error occurs
- Verification fails

### VANISH Actions
**Success when:**
- Target image/element disappears within timeout

**Failure when:**
- Image still visible after timeout
- Image was never visible to begin with

### WAIT Actions
**Success when:**
- Wait duration completes successfully
- Condition becomes true (if waiting for condition)

**Failure when:**
- Timeout occurs before condition is met
- Condition never becomes true

### GO_TO_STATE Actions
**Success when:**
- Target state is successfully activated
- State's identifying images are found
- State transition completes

**Failure when:**
- Cannot find state's identifying images
- State transition fails or times out

### RUN_PROCESS Actions
**Success when:**
- The called process returns success
- All actions in the called process succeed

**Failure when:**
- The called process returns failure
- Any action in the called process fails

## Custom Success Criteria

### Using successCriteria Function

You can override default success logic with custom criteria:

```typescript
{
  "type": "CLICK",
  "config": {
    "target": "button",
    "successCriteria": (result) => {
      // Custom success logic
      return result.clickCount > 0 && result.noErrors;
    }
  }
}
```

**In qontinui Python:**
```python
from qontinui.actions.action_config import ActionConfig

config = ActionConfig.builder()
    .set_success_criteria(
        lambda result: result.click_count > 0 and not result.has_errors
    )
    .build()
```

### Using Verification Options

Verification options add additional success criteria:

```typescript
{
  "type": "CLICK",
  "config": {
    "target": "submit-button",
    "verificationOptions": {
      "event": "IMAGE_APPEARS",
      "images": ["success-message"],
      "timeout": 5000
    }
  }
}
```

**Success requires:**
1. Click executes successfully (default criteria)
2. **AND** `success-message` image appears within 5 seconds (verification)

## Process-Level Success

### Simple Process
```json
{
  "id": "simple-login",
  "actions": [
    { "type": "CLICK", "config": { "target": "login-button" } },
    { "type": "TYPE", "config": { "text": "password123" } },
    { "type": "CLICK", "config": { "target": "submit" } }
  ]
}
```

**Success**: All 3 actions succeed
**Failure**: Any action fails (stops at first failure unless `continueOnError`)

### Process with Error Handling
```json
{
  "id": "robust-process",
  "actions": [
    {
      "type": "FIND",
      "config": { "image": "optional-popup" },
      "continueOnError": true
    },
    {
      "type": "CLICK",
      "config": { "target": "main-button" },
      "continueOnError": false
    }
  ]
}
```

**Success**: Second action succeeds (first can fail without affecting process)
**Failure**: Second action fails

## Impact on Process Repetition

### Scenario 1: Fixed Repeats (untilSuccess = false)

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "collect-reward",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 5,
      "delay": 1000,
      "untilSuccess": false
    }
  }
}
```

**Behavior:**
- Runs process **exactly 6 times** (1 initial + 5 repeats)
- Runs all repeats **regardless of success/failure**
- Final result depends on aggregation strategy (e.g., "at least one succeeded")

**Example Timeline:**
1. Run 1: ❌ Fails (button not found)
2. Delay 1000ms
3. Run 2: ✅ Success
4. Delay 1000ms
5. Run 3: ✅ Success
6. Delay 1000ms
7. Run 4: ❌ Fails
8. Delay 1000ms
9. Run 5: ✅ Success
10. Delay 1000ms
11. Run 6: ✅ Success
12. **Overall Result: Success** (4 out of 6 succeeded)

### Scenario 2: Until Success or Max Repeats (untilSuccess = true)

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "claim-bonus",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 10,
      "delay": 2000,
      "untilSuccess": true
    }
  }
}
```

**Behavior:**
- Runs process **until it succeeds OR reaches max repeats**
- Stops early if process succeeds
- Continues up to maxRepeats if it keeps failing

**Example Timeline (Success Case):**
1. Run 1: ❌ Fails (popup not dismissed)
2. Delay 2000ms
3. Run 2: ❌ Fails (button still loading)
4. Delay 2000ms
5. Run 3: ✅ **Success!** → **STOP HERE**
6. Total runs: 3 (stopped early)
7. **Overall Result: Success**

**Example Timeline (All Failures):**
1. Run 1: ❌ Fails
2. Delay 2000ms
3. Run 2: ❌ Fails
4. Delay 2000ms
5. ... (continue)
6. Run 10: ❌ Fails
7. **Reached maxRepeats**
8. **Overall Result: Failure** (never succeeded)

## Qontinui Python Implementation

### ActionResult Class

```python
from dataclasses import dataclass
from typing import Any, Optional

@dataclass
class ActionResult:
    """Result of an action execution"""
    success: bool                    # Primary success indicator
    message: str = ""                # Human-readable message
    data: Optional[Any] = None       # Action-specific data
    metadata: dict = None            # Additional metadata

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}
```

### Process Execution with Success Tracking

```python
class Process:
    def __init__(self, actions: list[Action]):
        self.actions = actions

    def execute(self) -> ActionResult:
        """Execute all actions in sequence"""
        results = []

        for action in self.actions:
            result = action.execute()
            results.append(result)

            # Stop on first failure (unless continueOnError)
            if not result.success and not action.continue_on_error:
                return ActionResult(
                    success=False,
                    message=f"Process failed at action {action.id}: {result.message}",
                    metadata={'results': results, 'failed_action': action.id}
                )

        # All actions succeeded
        return ActionResult(
            success=True,
            message="Process completed successfully",
            metadata={'results': results}
        )
```

### Process Repetition Implementation

```python
def execute_run_process_with_repetition(
    process_id: str,
    repetition_config: dict
) -> ActionResult:
    """Execute process with repetition logic"""

    max_repeats = repetition_config.get('maxRepeats', 10)
    delay_ms = repetition_config.get('delay', 0)
    until_success = repetition_config.get('untilSuccess', False)

    results = []
    total_runs = max_repeats + 1  # Initial run + repeats

    for run_num in range(total_runs):
        # Execute the process
        result = get_process(process_id).execute()
        results.append(result)

        # Check if we should stop early
        if until_success and result.success:
            return ActionResult(
                success=True,
                message=f"Process succeeded on attempt {run_num + 1}",
                metadata={
                    'total_attempts': run_num + 1,
                    'results': results,
                    'stopped_early': True
                }
            )

        # Add delay between runs (except after last run)
        if run_num < total_runs - 1 and delay_ms > 0:
            time.sleep(delay_ms / 1000.0)

    # Finished all runs
    if until_success:
        # untilSuccess mode: failure because we never succeeded
        return ActionResult(
            success=False,
            message=f"Process failed after {total_runs} attempts",
            metadata={
                'total_attempts': total_runs,
                'results': results,
                'reached_max': True
            }
        )
    else:
        # Fixed count mode: success if at least one succeeded
        success_count = sum(1 for r in results if r.success)
        return ActionResult(
            success=success_count > 0,
            message=f"Process completed {success_count}/{total_runs} successful runs",
            metadata={
                'total_attempts': total_runs,
                'success_count': success_count,
                'results': results
            }
        )
```

## Best Practices

### 1. Define Clear Success Criteria
```python
# Good: Explicit verification
{
  "type": "CLICK",
  "config": {
    "target": "submit",
    "verificationOptions": {
      "event": "IMAGE_DISAPPEARS",
      "images": ["loading-spinner"],
      "timeout": 10000
    }
  }
}

# Bad: Assuming success without verification
{
  "type": "CLICK",
  "config": { "target": "submit" }
}
# No way to know if submit actually worked!
```

### 2. Use continueOnError Appropriately
```python
# Good: Continue on optional steps
[
  {
    "type": "FIND",
    "config": { "image": "optional-popup" },
    "continueOnError": true  # OK if not found
  },
  {
    "type": "CLICK",
    "config": { "target": "close-popup" },
    "continueOnError": true  # OK if nothing to close
  },
  {
    "type": "CLICK",
    "config": { "target": "main-button" },
    "continueOnError": false  # MUST succeed
  }
]
```

### 3. Set Appropriate Timeouts
```python
# Good: Reasonable timeout for network operation
{
  "type": "FIND",
  "config": {
    "image": "server-response",
    "timeout": 10000  # 10 seconds for network
  }
}

# Bad: Too short timeout
{
  "type": "FIND",
  "config": {
    "image": "server-response",
    "timeout": 500  # Only 0.5 seconds - too short!
  }
}
```

### 4. Use Process Repetition with Clear Success
```python
# Good: Clear success indicator
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "claim-daily-reward",  // Process ends with verification
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 5,
      "untilSuccess": true
    }
  }
}

# Where claim-daily-reward process has:
// Last action with verification
{
  "type": "FIND",
  "config": {
    "image": "reward-claimed-checkmark",
    "timeout": 3000
  }
}
```

## Summary

**Process Success** is determined by:

1. ✅ **Individual action results** - Each action returns success/failure
2. ✅ **Error handling** - `continueOnError` affects process flow
3. ✅ **Verification** - Additional checks beyond basic action execution
4. ✅ **Custom criteria** - User-defined success functions
5. ✅ **Timeouts** - Actions must complete within time limits

**For Process Repetition:**
- **`untilSuccess = false`**: Run all repeats, aggregate results
- **`untilSuccess = true`**: Stop on first success, fail if maxRepeats reached
- **`maxRepeats`**: Upper limit for both modes

Understanding these criteria is essential for building reliable automation workflows!
