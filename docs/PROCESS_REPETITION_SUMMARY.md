# Process Repetition Feature - Summary

## Changes Made

Updated the Process Repetition feature to use a simplified, unified "Max Repeats" approach.

### UI Changes

**Before:**
- "Number of Repeats" field
- "Repeat Until Success" checkbox
- Separate "Max Attempts" field (only visible when until success enabled)

**After:**
- **"Max Repeats"** field - Used for both modes
- **"Repeat Until Success or Max Repeats"** checkbox - Single checkbox that changes behavior
- Dynamic help text that adapts based on checkbox state

### Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| **Enable Repeat** | Checkbox | Master toggle for repetition |
| **Max Repeats** | Number (1-1000) | Maximum additional executions |
| **Delay Between Repeats** | Number (ms) | Pause between each execution |
| **Repeat Until Success or Max Repeats** | Checkbox | Changes execution behavior |

### Two Modes

#### Mode 1: Fixed Count (`untilSuccess = false`)
- Checkbox **unchecked**
- Runs exactly `maxRepeats` additional times
- Executes all repeats regardless of results
- Success if at least one execution succeeded
- **Use for**: Batch operations, collecting multiple items

**Example**: Collect rewards from 5 characters
```json
{
  "maxRepeats": 4,
  "delay": 2000,
  "untilSuccess": false
}
```
→ Runs 5 times total (1 + 4), waits 2s between each

#### Mode 2: Until Success (`untilSuccess = true`)
- Checkbox **checked**
- Tries up to `maxRepeats` additional times
- **Stops early** if process succeeds
- Continues until success **or** max repeats reached
- **Use for**: Retry logic, unreliable operations

**Example**: Try to claim bonus up to 10 times
```json
{
  "maxRepeats": 9,
  "delay": 1000,
  "untilSuccess": true
}
```
→ Tries up to 10 times (1 + 9), stops as soon as it succeeds

## JSON Export Format

```json
{
  "type": "RUN_PROCESS",
  "config": {
    "process": "process-id",
    "processRepetition": {
      "enabled": true,
      "maxRepeats": 10,
      "delay": 1000,
      "untilSuccess": true
    }
  }
}
```

### Fields

- `enabled` (boolean): Whether repetition is active
- `maxRepeats` (number): Maximum additional executions
- `delay` (number): Milliseconds between executions
- `untilSuccess` (boolean): Stop early on success vs. run all

## What Determines Process Success?

See **PROCESS_SUCCESS_CRITERIA.md** for comprehensive documentation.

### Quick Summary

**A process succeeds when:**
- All actions complete successfully
- All required images/states are found
- Verification passes (if configured)
- No unhandled errors occur

**A process fails when:**
- Any action fails (unless `continueOnError`)
- Required image not found
- Timeout occurs
- Verification fails

### Key Action Success Criteria

| Action Type | Success When | Failure When |
|-------------|--------------|--------------|
| **FIND** | Image found within timeout | Image not found, timeout |
| **CLICK** | Click executed | Target invalid, verification fails |
| **TYPE** | Text typed | Cannot focus, error occurs |
| **VANISH** | Image disappears | Still visible after timeout |
| **GO_TO_STATE** | State activated | State images not found |
| **RUN_PROCESS** | Called process succeeds | Called process fails |

## Implementation in qontinui Python

### Core Logic

```python
def execute_run_process_with_repetition(process_id, repetition):
    max_repeats = repetition['maxRepeats']
    delay = repetition['delay']
    until_success = repetition['untilSuccess']

    results = []
    total_runs = max_repeats + 1

    for run_num in range(total_runs):
        result = run_process(process_id)
        results.append(result)

        # Stop early if untilSuccess and succeeded
        if until_success and result.success:
            return success_result(run_num + 1, results)

        # Delay between runs (not after last)
        if run_num < total_runs - 1 and delay > 0:
            time.sleep(delay / 1000.0)

    # Finished all runs
    if until_success:
        # Failed: never succeeded despite all attempts
        return failure_result(total_runs, results)
    else:
        # Success if at least one succeeded
        success_count = sum(1 for r in results if r.success)
        return aggregate_result(success_count, total_runs, results)
```

### Result Aggregation

**Until Success Mode:**
- ✅ Success: Stopped early because process succeeded
- ❌ Failure: Ran all maxRepeats without success

**Fixed Count Mode:**
- ✅ Success: At least one execution succeeded
- ❌ Failure: All executions failed

## Files Modified

1. **`/frontend/src/components/action-properties.tsx`**
   - Simplified UI to use single "Max Repeats" field
   - Changed checkbox label to "Repeat Until Success or Max Repeats"
   - Dynamic help text based on mode
   - Removed conditional "Max Attempts" field

2. **`/frontend/src/lib/export-schema.ts`**
   - Updated `processRepetition` interface
   - Changed `count` → `maxRepeats`
   - Removed `maxAttempts` field
   - Simplified comments

3. **`/frontend/src/lib/config-exporter.ts`**
   - Export `maxRepeats` instead of `count` and `maxAttempts`
   - Simplified export logic

4. **Documentation**:
   - Updated `/qontinui-web/PROCESS_REPETITION_FEATURE.md`
   - Created `/qontinui-web/PROCESS_SUCCESS_CRITERIA.md`
   - Created this summary

## Benefits of Simplified Design

### Before (Complex)
- Two separate fields: "Number of Repeats" and "Max Attempts"
- Confusing which field is used when
- "Max Attempts" only appeared conditionally
- Users had to set both fields for until-success mode

### After (Simple)
- ✅ **One field** for all scenarios: "Max Repeats"
- ✅ **Clear purpose**: Upper limit for both modes
- ✅ **Intuitive**: Checkbox changes how max is used
- ✅ **Less confusion**: No conditional fields
- ✅ **Better UX**: Dynamic help text explains behavior

## Migration Notes

**Old format** (if you have existing configs):
```json
{
  "count": 5,
  "untilSuccess": true,
  "maxAttempts": 20
}
```

**New format**:
```json
{
  "maxRepeats": 20,
  "untilSuccess": true
}
```

**Impact**:
- `count` is now `maxRepeats`
- `maxAttempts` is removed (use `maxRepeats`)
- Backward compatibility: May need to handle old configs in qontinui runner

## Usage Examples

### Farming/Grinding
```typescript
// Run harvest routine 10 times
{
  enabled: true,
  maxRepeats: 9,      // 10 total runs
  delay: 3000,        // 3 seconds between
  untilSuccess: false // Run all 10 times
}
```

### Retry Logic
```typescript
// Try login up to 5 times until success
{
  enabled: true,
  maxRepeats: 4,      // Up to 5 attempts
  delay: 2000,        // 2 seconds between
  untilSuccess: true  // Stop on first success
}
```

### No Repetition
```typescript
// Default: No repetition field = run once
{
  process: "single-run-process"
  // No processRepetition field
}
```

## Summary

The simplified Process Repetition feature provides:

✅ **Single unified field** (`maxRepeats`) for both modes
✅ **Clear mode selection** via intuitive checkbox
✅ **Dynamic UI** that adapts help text
✅ **Comprehensive success criteria** (see PROCESS_SUCCESS_CRITERIA.md)
✅ **Complete documentation** for implementation
✅ **Better UX** with less confusion

The feature is ready for:
1. ✅ UI configuration (complete)
2. ✅ JSON export (complete)
3. ⏳ qontinui Python implementation (documented, ready to implement)
