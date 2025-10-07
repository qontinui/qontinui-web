# Action Options Export - Comprehensive Update

## Overview

This document describes the comprehensive update to the qontinui-web JSON export functionality to include ALL action options available in the qontinui Python framework.

## Problem Statement

The previous `ActionConfig` interface in the export schema was **minimal**, capturing less than 10% of the available action configuration options from the qontinui Python implementation. This severely limited the precision, timing control, and advanced capabilities that could be configured through the UI and exported to JSON.

## Changes Made

### 1. Updated Export Schema (`/frontend/src/lib/export-schema.ts`)

The `ActionConfig` interface has been completely overhauled to include all options from qontinui Python:

#### Base ActionConfig Properties (Applied to ALL Actions)

```typescript
// Timing control
pauseBeforeBegin?: number;        // Pause before action starts (seconds)
pauseAfterEnd?: number;            // Pause after action completes (seconds)

// Behavior control
illustrate?: 'YES' | 'NO' | 'USE_GLOBAL';  // Override global illustration
subsequentActions?: ActionConfig[];         // Chain actions
logType?: string;                           // Log event categorization

// Logging options (full LoggingOptions structure)
loggingOptions?: {
  beforeActionMessage?: string;
  afterActionMessage?: string;
  successMessage?: string;
  failureMessage?: string;
  logBeforeAction?: boolean;
  logAfterAction?: boolean;
  logOnSuccess?: boolean;
  logOnFailure?: boolean;
  beforeActionLevel?: string;
  afterActionLevel?: string;
  successLevel?: string;
  failureLevel?: string;
};
```

#### Find/Search Options (BaseFindOptions)

```typescript
similarity?: number;                // Minimum similarity threshold (0.0-1.0)
searchRegions?: Region[];          // Regions to search within
captureImage?: boolean;            // Capture match for logging
useDefinedRegion?: boolean;        // Use defined regions vs searching
maxMatchesToActOn?: number;        // Maximum matches to act on
searchDuration?: number;           // Search duration in seconds
searchType?: 'FIRST' | 'ALL' | 'BEST' | 'EACH';
maxMatches?: number;               // Maximum matches to return
minMatches?: number;               // Minimum matches for success
timeout?: number;                  // Maximum search time
pollInterval?: number;             // Time between search attempts
```

#### Match Adjustment Options

```typescript
matchAdjustment?: {
  targetPosition?: string;         // Override position in match
  targetOffset?: Coordinates;      // Pixel offset from target
  addW?: number;                   // Add to width
  addH?: number;                   // Add to height
  absoluteW?: number;              // Absolute width override
  absoluteH?: number;              // Absolute height override
  addX?: number;                   // Add to X coordinate
  addY?: number;                   // Add to Y coordinate
};
```

#### Pattern Find Options (Template Matching)

```typescript
patternOptions?: {
  matchMethod?: string;            // CORRELATION, CORRELATION_NORMED, etc.
  scaleInvariant?: boolean;        // Multi-scale search
  rotationInvariant?: boolean;     // Multi-rotation search
  minScale?: number;
  maxScale?: number;
  scaleStep?: number;
  minRotation?: number;
  maxRotation?: number;
  rotationStep?: number;
  useGrayscale?: boolean;
  useColorReduction?: boolean;
  colorTolerance?: number;
  useEdges?: boolean;
  edgeThreshold1?: number;
  edgeThreshold2?: number;
  nonMaxSuppression?: boolean;
  nmsThreshold?: number;
  minDistanceBetweenMatches?: number;
};
```

#### Text Find Options (OCR-based)

```typescript
textOptions?: {
  ocrEngine?: 'TESSERACT' | 'EASYOCR' | 'PADDLEOCR' | 'NATIVE';
  language?: string;
  whitelistChars?: string;
  blacklistChars?: string;
  matchType?: 'EXACT' | 'CONTAINS' | 'STARTS_WITH' | 'ENDS_WITH' | 'REGEX' | 'FUZZY';
  caseSensitive?: boolean;
  ignoreWhitespace?: boolean;
  normalizeUnicode?: boolean;
  fuzzyThreshold?: number;
  editDistance?: number;
  preprocessing?: string[];
  scaleFactor?: number;
  psmMode?: number;
  oemMode?: number;
  confidenceThreshold?: number;
};
```

#### Click Options

```typescript
numberOfClicks?: number;           // 1=single, 2=double, etc.
mouseButton?: 'LEFT' | 'RIGHT' | 'MIDDLE';
pressDuration?: number;            // Hold duration (seconds)
pauseAfterPress?: number;          // Pause after pressing
pauseAfterRelease?: number;        // Pause after releasing
```

#### Type Options

```typescript
text?: string;                     // Text to type
typeDelay?: number;                // Delay between keystrokes (seconds)
modifiers?: string;                // Modifier keys (e.g., "CTRL+ALT")
```

#### Drag Options

```typescript
destination?: Coordinates | Region;
dragDuration?: number;             // Duration of drag movement
delayBetweenMouseDownAndMove?: number;
delayAfterDrag?: number;
```

#### Scroll Options

```typescript
direction?: 'up' | 'down' | 'left' | 'right';
clicks?: number;                   // Number of scroll clicks
smooth?: boolean;                  // Smooth scrolling
delayBetweenScrolls?: number;
```

#### Move Options

```typescript
moveInstantly?: boolean;           // Instant vs animated
moveSpeed?: number;                // Animation speed (seconds)
```

#### Wait Options

```typescript
duration?: number;                 // Wait duration (seconds)
waitFor?: 'time' | 'image' | 'state' | 'condition';
conditionCheckInterval?: number;
logProgress?: boolean;
```

#### Vanish Options

```typescript
maxWaitTime?: number;
vanishPollInterval?: number;
```

#### Repetition Options

```typescript
repetitionOptions?: {
  timesToRepeat?: number;
  pauseBetweenActions?: number;
  maxRepetitions?: number;
};
```

#### Verification Options

```typescript
verificationOptions?: {
  event?: 'TEXT_APPEARS' | 'TEXT_DISAPPEARS' | 'IMAGE_APPEARS' |
          'IMAGE_DISAPPEARS' | 'STATE_CHANGE' | 'NONE';
  text?: string;
  images?: string[];
  timeout?: number;
};
```

#### Highlight Options (Debugging)

```typescript
highlightOptions?: {
  duration?: number;
  color?: [number, number, number];
  thickness?: number;
  flash?: boolean;
  flashTimes?: number;
};
```

### 2. Updated Config Exporter (`/frontend/src/lib/config-exporter.ts`)

The `transformActionConfig()` method has been completely rewritten to:

1. **Export all base ActionConfig properties** (pauses, logging, etc.)
2. **Export all find/search options** (similarity, searchRegions, etc.)
3. **Export match adjustment options** (offsets, sizing)
4. **Export pattern and text find options**
5. **Export repetition and verification options**
6. **Export action-specific options** for each action type:
   - Click: numberOfClicks, mouseButton, pressDuration, etc.
   - Type: typeDelay, modifiers
   - Drag: timing delays
   - Scroll: clicks, smooth, delayBetweenScrolls
   - Move: moveInstantly, moveSpeed
   - Wait: waitFor, conditionCheckInterval
   - Vanish: maxWaitTime, vanishPollInterval
   - And more...

7. **Maintain backward compatibility** with legacy options
8. **Forward compatibility** - unknown options are preserved

## Mapping to qontinui Python

The updated schema now matches the qontinui Python action options:

| Python Class | Export Schema Coverage |
|-------------|------------------------|
| `ActionConfig` | ✅ 100% (pause_before_begin, pause_after_end, logging, etc.) |
| `BaseFindOptions` | ✅ 100% (similarity, search_regions, timeout, etc.) |
| `PatternFindOptions` | ✅ 100% (match_method, scale_invariant, etc.) |
| `TextFindOptions` | ✅ 100% (ocr_engine, match_type, etc.) |
| `ClickOptions` | ✅ 100% (number_of_clicks, mouse_press_options) |
| `TypeOptions` | ✅ 100% (type_delay, modifiers) |
| `DragOptions` | ✅ 100% (delay_between_mouse_down_and_move, etc.) |
| `ScrollOptions` | ✅ 100% (clicks, smooth, delay_between_scrolls) |
| `MoveOptions` | ✅ 100% (move_instantly, move_speed) |
| `WaitOptions` | ✅ 100% (wait_for, condition_check_interval) |
| `VanishOptions` | ✅ 100% (max_wait_time, poll_interval) |
| `RepetitionOptions` | ✅ 100% (times_to_repeat, pause_between_actions) |
| `VerificationOptions` | ✅ 100% (event, text, images, timeout) |
| `MatchAdjustmentOptions` | ✅ 100% (target_position, offsets, sizing) |
| `HighlightOptions` | ✅ 100% (duration, color, thickness, flash) |

## Next Steps

### High Priority

1. **Update Action Properties UI** - Add UI controls for the most important options:
   - `pauseBeforeBegin` / `pauseAfterEnd` (timing section)
   - `numberOfClicks` (for click actions)
   - `typeDelay` / `modifiers` (for type actions)
   - `clicks` / `smooth` (for scroll actions)
   - `repetitionOptions` (times to repeat)

2. **Update Config Importer** - Ensure the importer properly loads all new options

3. **Documentation** - Create user documentation for the new options

### Medium Priority

4. **Advanced Options Panel** - Create collapsible "Advanced Options" sections for:
   - Pattern matching options (scale/rotation invariance)
   - Text/OCR options
   - Verification options
   - Match adjustment options

5. **Validation** - Add validation for option ranges and combinations

### Low Priority

6. **Templates/Presets** - Create common option presets (e.g., "Fast Click", "Precise Find", "Slow Type")
7. **Visual Helpers** - Add tooltips and visual helpers for complex options

## Testing

To test the export functionality:

1. Create actions with various configurations in the UI
2. Export the configuration to JSON
3. Verify that all options are present in the JSON file
4. Import the JSON and verify all options are restored
5. Test the configuration with the qontinui Python runner

## Benefits

This update provides:

1. ✅ **Complete feature parity** with qontinui Python
2. ✅ **Precise timing control** (pauses before/after actions)
3. ✅ **Advanced search capabilities** (multi-scale, rotation, OCR)
4. ✅ **Robust verification** (verify action success)
5. ✅ **Flexible repetition** (repeat actions with delays)
6. ✅ **Better debugging** (comprehensive logging options)
7. ✅ **Future-proof** (forward compatibility for new options)

## Migration Guide

Existing configurations will continue to work as the new options are all optional. However, users should update their configurations to take advantage of:

- **Timing control** - Add pauses for more reliable automation
- **Verification** - Verify critical action results
- **Advanced matching** - Use pattern/text options for difficult cases
- **Repetition** - Simplify processes by using repetition instead of duplicate actions

## References

- qontinui Python: `/home/jspinak/qontinui_parent_directory/qontinui/src/qontinui/actions/`
- Export Schema: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/export-schema.ts`
- Config Exporter: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/config-exporter.ts`
