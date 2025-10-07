# Pure vs Combined Actions - Implementation Plan for qontinui-web

## Overview

Qontinui has transitioned to a pure vs combined actions architecture. This document outlines the implementation plan for updating qontinui-web to support this new architecture.

## Architectural Changes in Qontinui Core

### 1. Pure Actions (Atomic, Cannot Be Decomposed)

**Pure Mouse Actions:**
- `MOUSE_MOVE` - Move mouse to location (renamed from `MOVE`)
- `MOUSE_DOWN` - Press and hold mouse button
- `MOUSE_UP` - Release mouse button
- `MOUSE_SCROLL` - Scroll (pure version)

**Pure Keyboard Actions:**
- `KEY_DOWN` - Press and hold key
- `KEY_UP` - Release key
- `KEY_PRESS` - Press and release key (atomic)

### 2. Combined Actions (Composite, Built from Pure Actions)

**Combined Mouse Actions:**
- `CLICK` - MOUSE_DOWN + wait + MOUSE_UP
- `DOUBLE_CLICK` - Two clicks with interval
- `RIGHT_CLICK` - Right button click
- `DRAG` - MOUSE_DOWN + MOUSE_MOVE + MOUSE_UP

**Combined Keyboard Actions:**
- `TYPE` - Multiple KEY_PRESS actions

### 3. Configuration System

21 new timing configuration options replace hard-coded values:

**Mouse Options (9):**
- `click_hold_duration` - How long to hold button down during click
- `click_release_delay` - Delay after releasing button
- `click_safety_release` - Release all buttons before clicking
- `double_click_interval` - Time between double clicks
- `drag_start_delay` - Delay before starting drag
- `drag_end_delay` - Delay after ending drag
- `drag_default_duration` - Default drag animation duration
- `move_default_duration` - Default move animation duration
- `safety_release_delay` - Delay after safety release

**Keyboard Options (5):**
- `key_hold_duration` - How long to hold key during press
- `key_release_delay` - Delay after releasing key
- `typing_interval` - Delay between typed characters
- `hotkey_hold_duration` - Duration for hotkey holds
- `hotkey_press_interval` - Interval between hotkey presses

**Find Options (4):**
- `default_similarity_threshold` - Image matching threshold
- `default_timeout` - Find operation timeout
- `default_retry_count` - Number of find retries
- `search_interval` - Delay between search attempts

**Wait Options (3):**
- `default_wait_duration` - Default wait time
- `pause_before_action` - Global pause before actions
- `pause_after_action` - Global pause after actions

## Implementation Progress

### ✅ Completed

1. **Action Type Definitions Updated**
   - `/frontend/src/components/action-editor.tsx` - Full type definition
   - `/frontend/src/components/process-builder.tsx` - Full type definition
   - `/frontend/src/components/action-properties.tsx` - Full type definition
   - Includes all pure and combined action types
   - Maintains `MOVE` for backward compatibility (maps to `MOUSE_MOVE`)

2. **Action Menu Updated**
   - Added categories to ACTION_TYPES array:
     - "Find" - FIND, FIND_STATE_IMAGE
     - "Mouse (Combined)" - CLICK, DOUBLE_CLICK, RIGHT_CLICK, DRAG, SCROLL
     - "Mouse (Pure)" - MOUSE_MOVE, MOUSE_DOWN, MOUSE_UP
     - "Keyboard (Combined)" - TYPE
     - "Keyboard (Pure)" - KEY_PRESS, KEY_DOWN, KEY_UP
     - "Other" - WAIT, VANISH, GO_TO_STATE, RUN_PROCESS

3. **Default Configurations Added**
   - All pure actions have default configs
   - All combined actions have default configs
   - WAIT action added
   - DOUBLE_CLICK and RIGHT_CLICK added

### 🔄 In Progress

1. **UI Property Forms for Pure Actions**
   - Need to add cases in `renderActionProperties()` for:
     - `MOUSE_MOVE` - Target, duration
     - `MOUSE_DOWN` - Button type, optional target
     - `MOUSE_UP` - Button type, optional target
     - `KEY_PRESS` - Key selector
     - `KEY_DOWN` - Key selector
     - `KEY_UP` - Key selector
     - `WAIT` - Duration input
     - `DOUBLE_CLICK` - Target, timing overrides
     - `RIGHT_CLICK` - Target, timing overrides

2. **Advanced Timing Configuration Section**
   - Add collapsible "Advanced Timing" section to combined actions
   - Allow overriding default timing values per-action
   - Show relevant timing options based on action type

3. **Export Schema Updates**
   - Update ActionType in export-schema.ts
   - Add all pure action types
   - Add timing configuration fields to ActionConfig interface

4. **Config Exporter Updates**
   - Handle new action types
   - Export timing configuration overrides
   - Map legacy `MOVE` to `MOUSE_MOVE` on export

5. **Action Summaries**
   - Add summary text for pure actions in `getActionSummary()`
   - Update summaries for combined actions

### ⏳ Pending

1. **Migration Handling**
   - Detect `MOVE` actions on import
   - Automatically convert to `MOUSE_MOVE`
   - Display migration notice to users

2. **Validation**
   - Validate button types (left/right/middle)
   - Validate key names
   - Validate timing values (positive floats)
   - Validate required fields for pure actions

3. **Documentation**
   - In-app help text explaining pure vs combined
   - Tooltips for timing configuration options
   - Examples and use cases

4. **Configuration Editor (Future Enhancement)**
   - UI for editing default timing values
   - Generate custom config JSON
   - Save/load custom configs

## Next Steps

### Immediate Priority

1. **Create UI forms for pure mouse actions in action-properties.tsx:**
   ```typescript
   case "MOUSE_MOVE":
     // Similar to current MOVE action
     // Target + duration

   case "MOUSE_DOWN":
   case "MOUSE_UP":
     // Button selector (left/right/middle)
     // Optional target location
   ```

2. **Create UI forms for pure keyboard actions:**
   ```typescript
   case "KEY_PRESS":
   case "KEY_DOWN":
   case "KEY_UP":
     // Key selector (reuse SpecialKeysSelector?)
   ```

3. **Add WAIT action form:**
   ```typescript
   case "WAIT":
     // Duration input (milliseconds)
   ```

4. **Add advanced timing section component:**
   ```typescript
   function renderAdvancedTiming(action, updateConfig) {
     // Collapsible section
     // Show relevant timing options based on action type
     // Number inputs for each timing value
   }
   ```

### Medium Priority

5. **Update export-schema.ts:**
   - Add all new action types to ActionType union
   - Add timing fields to ActionConfig interface

6. **Update config-exporter.ts:**
   - Handle all new action types
   - Export timing overrides from action config
   - Convert `MOVE` → `MOUSE_MOVE`

7. **Update getActionSummary():**
   - Add summary text for all new actions
   - Show timing overrides in summary when present

### Lower Priority

8. **Add validation:**
   - Create validation utility functions
   - Display validation errors in UI
   - Prevent export of invalid actions

9. **Migration tools:**
   - Auto-convert on import
   - Show migration summary
   - Option to batch-convert existing processes

10. **Configuration management:**
    - Global config editor UI
    - Import/export custom configs
    - Config templates/presets

## Design Decisions

### Visual Distinction

Pure actions are marked with "(Pure)" suffix in the label and use darker shades:
- `MOUSE_MOVE` - bg-teal-500
- `MOUSE_DOWN` - bg-teal-600
- `MOUSE_UP` - bg-teal-700

Combined actions use their original colors:
- `CLICK` - bg-green-500
- `DOUBLE_CLICK` - bg-green-600
- `RIGHT_CLICK` - bg-green-700

### Categorization in Menu

Actions are grouped by category attribute:
- Helps users understand the architecture
- Makes pure vs combined distinction clear
- Organizes menu logically

### Advanced Timing as Optional

Timing overrides are in a collapsible "Advanced Timing" section:
- Keeps simple use cases simple
- Power users can access advanced features
- Doesn't overwhelm beginners

### Backward Compatibility

`MOVE` type is maintained in TypeScript types:
- Marked as legacy with comment
- Automatically converted to `MOUSE_MOVE` on export
- Old JSON files continue to work

## File Checklist

### ✅ Updated
- [x] `/frontend/src/components/action-editor.tsx` - Types, menu, defaults
- [x] `/frontend/src/components/process-builder.tsx` - Types
- [x] `/frontend/src/components/action-properties.tsx` - Types

### 🔄 In Progress
- [ ] `/frontend/src/components/action-properties.tsx` - UI forms (renderActionProperties)
- [ ] `/frontend/src/components/action-editor.tsx` - Action summaries (getActionSummary)

### ⏳ Todo
- [ ] `/frontend/src/lib/export-schema.ts` - Action types, timing fields
- [ ] `/frontend/src/lib/config-exporter.ts` - Export logic for new types
- [ ] New file: `/frontend/src/components/advanced-timing-section.tsx` (optional component)
- [ ] New file: `/frontend/src/lib/action-validation.ts` (validation utilities)

## Testing Plan

1. **Create each pure action type**
   - Verify it appears in menu
   - Verify default config is correct
   - Verify UI form works
   - Verify export includes correct fields

2. **Test combined actions with timing overrides**
   - Add timing overrides in Advanced section
   - Verify they export correctly
   - Verify they're visible in summary

3. **Test backward compatibility**
   - Import old JSON with `MOVE` actions
   - Verify auto-conversion to `MOUSE_MOVE`
   - Verify actions still work

4. **Test validation**
   - Try to export with invalid values
   - Verify validation errors show
   - Verify can't export invalid actions

5. **End-to-end test**
   - Build process with pure actions
   - Export JSON
   - Run in qontinui Python
   - Verify timing is respected

## Questions for User

1. Should we display all 21 timing options or just the most common ones?
2. Should pure actions have a different visual indicator (icon, badge)?
3. Should we add configuration templates (e.g., "Slow Application", "Fast Game")?
4. Should users be able to save/load custom default configs through the web UI?

## Summary

**Status:** ~40% complete

**What's Done:**
- Type definitions updated across all components
- Action menu updated with categories and colors
- Default configurations for all action types
- Architecture planning complete

**Next Up:**
- UI property forms for pure actions
- Advanced timing configuration section
- Export schema updates
- Config exporter updates

**Timeline Estimate:**
- Pure action UI forms: 2-3 hours
- Advanced timing section: 1-2 hours
- Export updates: 1 hour
- Action summaries: 1 hour
- Testing and fixes: 2-3 hours
- **Total: ~8-11 hours**

The foundation is solid - now it's primarily UI work to support the new action types and expose the timing configuration options.
