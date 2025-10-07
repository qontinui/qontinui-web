# MOVE Action Duration Fix

## Issue

The MOVE action had two problems:

1. **Unnecessary Field**: Was exporting `moveDuration` instead of reusing standard `duration` field
2. **Missing Implementation**: Python executor didn't use the duration parameter at all

## Root Cause Analysis

### Frontend (qontinui-web)
- **UI Field**: `action.config.duration` (milliseconds)
- **JSON Export**: Was converting to `actionConfig.moveDuration` (unnecessary rename)

### Backend (qontinui Python)
- **HAL Interface**: `move_mouse(x, y, duration=0.0)` accepts duration in **seconds**
- **JSON Executor**: Was calling `Mouse.move(x, y)` without duration parameter
- **Result**: All moves were instant, ignoring the configured duration

## Solution: Use Standard `duration` Field

**After the fix:**
- **UI**: `config.duration` (milliseconds)
- **JSON Export**: `actionConfig.duration` (milliseconds) - no renaming!
- **Python**: Reads `duration`, converts to seconds, passes to `Mouse.move()`

This is consistent with other actions like WAIT and DRAG that also use `duration`.

## Changes Made

### 1. Frontend Export (config-exporter.ts:298)
**Before:**
```typescript
if (config.duration !== undefined) actionConfig.moveDuration = config.duration;
```

**After:**
```typescript
if (config.duration !== undefined) actionConfig.duration = config.duration;
```

### 2. Python Executor (action_executor.py:474-485)
**Before:**
```python
Mouse.move(location[0], location[1])  # No duration!
```

**After:**
```python
# Get duration from config (in milliseconds, convert to seconds)
duration_ms = action.config.get("duration", 0)
duration_seconds = duration_ms / 1000.0 if duration_ms else 0.0

Mouse.move(location[0], location[1], duration_seconds)
print(f"Moved mouse to {location} (duration: {duration_ms}ms)")
```

### Key Changes

1. **Simplified Export**: No more `moveDuration` - uses standard `duration` field
2. **Reads `duration`** from action.config (consistent with WAIT, DRAG, etc.)
3. **Converts milliseconds → seconds** (JSON uses ms, Python HAL uses seconds)
4. **Passes duration** to Mouse.move() for smooth animation
5. **Logs duration** for debugging

## Duration Flow

```
UI Input (ms) → JSON Export (duration: ms) → Python Read → Convert to seconds → HAL move_mouse()
   500       →     "duration": 500         →    0.5 sec     →    Mouse.move(x, y, 0.5)
```

## Examples

### Instant Movement (duration = 0)
```json
{
  "type": "MOVE",
  "config": {
    "target": { "type": "coordinates", "coordinates": { "x": 100, "y": 200 } },
    "duration": 0
  }
}
```
**Result**: Mouse teleports instantly to (100, 200)

### Smooth Movement (duration = 500ms)
```json
{
  "type": "MOVE",
  "config": {
    "target": { "type": "coordinates", "coordinates": { "x": 500, "y": 300 } },
    "duration": 500
  }
}
```
**Result**: Mouse smoothly animates to (500, 300) over 0.5 seconds

## Testing

### Manual Test
1. Create MOVE action in UI
2. Set Duration to 1000ms
3. Export JSON
4. Verify JSON contains `"duration": 1000` (not `moveDuration`)
5. Run automation
6. Observe mouse moves smoothly over 1 second (not instantly)

### Expected Output
```
Moved mouse to (500, 300) (duration: 1000ms)
```

## Summary

✅ **Simplified**: Removed unnecessary `moveDuration` field - uses standard `duration`
✅ **Consistent**: Now matches WAIT, DRAG, and other actions that use `duration`
✅ **Fixed**: Python executor now uses duration parameter
✅ **Converts**: Milliseconds (JSON) → Seconds (Python HAL)
✅ **Works**: Smooth mouse movement animation now functional
✅ **Logs**: Duration displayed in debug output

The MOVE action now correctly supports both instant (0ms) and animated (>0ms) mouse movements using the standard `duration` field!
