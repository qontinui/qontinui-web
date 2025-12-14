# Monitor Metadata Implementation Plan

## Implementation Status: ✅ COMPLETE

**Implemented:** December 2024

This document describes the monitor metadata feature that was implemented to enable automatic monitor targeting for workflow execution.

---

## Summary of Implementation

### What Was Built

| Phase | Component | Status | Files Modified |
|-------|-----------|--------|----------------|
| **Phase 1** | Schema Updates | ✅ Complete | `export-schema.ts`, `v2.5.0-to-v2.6.0.ts` |
| **Phase 2** | Library FindOptions | ✅ Complete | `find_options.py`, `real_find_implementation.py`, `find_result.py`, `find_options_builder.py`, `pure_actions_provider.py` |
| **Phase 3** | Library FindResult | ✅ Complete | `find_result.py` (monitor_index field added) |
| **Phase 4** | Runner/Library Bridge | ✅ Complete | `config_parser.py`, `state_image.py`, `target_resolver.py`, `state_executor.py` |
| **Phase 5** | Web Frontend UI | ✅ Complete | `types.ts`, `monitor-selector.tsx` (new), `state-properties-panel.tsx`, `state-machine.tsx`, `state-image-creator.ts` |

### Key Features Implemented

1. **`monitors: number[]` field** on all state elements (StateImage, StateRegion, StateLocation)
2. **MonitorSelector component** for editing monitors in the web UI
3. **FindOptions.monitors** accepts list of monitor indices (backward compatible with `monitor_index`)
4. **FindResult.monitor_index** tracks which monitor a match was found on
5. **Cascade priority system** for monitor resolution:
   - Explicit parameter (highest)
   - ExecutionContext.monitors (runtime override)
   - StateImage._monitors (from JSON config)
   - ExecutionContext.monitor_index (backward compatibility)
   - None = all monitors (lowest)
6. **Config migration v2.5.0 → v2.6.0** auto-adds `monitors: [0]` to existing elements

### Files Created

- `qontinui-web/frontend/src/components/monitor-selector.tsx` - Reusable monitor selection UI

### Backward Compatibility

- Old configs without `monitors` field: Automatically migrated to `monitors: [0]`
- Old code using `monitor_index`: Still works via property getter/setter
- Runtime override: Works through cascade system

---

## Original Plan

The sections below document the original implementation plan for reference.

---

## Overview

This plan adds monitor tracking to state elements, enabling:
1. **Automatic monitor selection** - Runner knows which monitor(s) to target
2. **Efficient find operations** - Search only relevant monitors
3. **Multi-monitor screenshot capture** - Capture adjacent monitors as single image
4. **Reliable fixed region searches** - Fixed regions map to correct screens

## Current State

### What Exists

| Component | Monitor Support | Notes |
|-----------|-----------------|-------|
| **qontinui library** | ✅ Full | HAL has `Monitor` dataclass, `capture_monitors()` method |
| **qontinui-api** | ✅ Partial | Exposes monitor list, single-monitor capture |
| **qontinui-runner** | ✅ Partial | Monitor selection UI, stores `monitor_index` on capture |
| **qontinui-web backend** | ✅ Partial | `ProjectScreenshot.monitor_index` field exists |
| **qontinui-web frontend** | ❌ None | State elements have no monitor fields |
| **Export schema** | ❌ None | No monitor fields in StateImage, Pattern, etc. |

### Key Files

**qontinui (Python library):**
- `src/qontinui/hal/interfaces/screen_capture.py` - IScreenCapture interface
- `src/qontinui/hal/implementations/mss_capture.py` - MSS implementation
- `src/qontinui/monitor/monitor_manager.py` - MonitorManager class
- `src/qontinui/actions/find/find_options.py` - FindOptions (has `monitor_index`)
- `src/qontinui/actions/find/real_find_implementation.py` - Find implementation

**qontinui-runner:**
- `src-tauri/src/commands/screenshot.rs` - Rust screenshot commands
- `src/components/CaptureTab.tsx` - Capture UI with monitor selection
- `python-bridge/gui_automation.py` - Python automation executor

**qontinui-web:**
- `frontend/src/lib/export-schema.ts` - Export schema types
- `frontend/src/contexts/automation-context/types.ts` - Frontend types
- `frontend/src/components/common/ScreenshotPicker.tsx` - Screenshot capture
- `backend/app/models/project_assets.py` - ProjectScreenshot model

---

## Phase 1: Schema Updates

### 1.1 Export Schema Changes

**File:** `qontinui-web/frontend/src/lib/export-schema.ts`

```typescript
// NEW: Monitor metadata stored with images
export interface MonitorInfo {
  index: number;                    // Monitor index (0, 1, 2...)
  position: "left" | "middle" | "right" | "primary" | "unknown";
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  resolution: {
    width: number;
    height: number;
  };
  scaleFactor?: number;             // DPI scaling (1.0, 1.25, 1.5)
}

// NEW: Capture metadata for images
export interface CaptureInfo {
  timestamp: string;                // ISO timestamp
  monitors: MonitorInfo[];          // Monitor details at capture time
  source: "capture" | "upload" | "extraction";
}

// UPDATED: ImageAsset with monitor metadata
export interface ImageAsset {
  id: string;
  name: string;
  data: string;
  format: "png" | "jpg" | "jpeg";
  width: number;
  height: number;
  hash?: string;

  // NEW: Monitor metadata
  monitors: number[];               // Which monitors this image spans [0] or [0, 1]
  captureInfo?: CaptureInfo;        // Full capture details (only for captured images)
}

// UPDATED: Pattern with monitor inheritance
export interface Pattern {
  id: string;
  name?: string;
  imageId: string;
  mask?: string;
  searchRegions?: SearchRegion[];
  fixed: boolean;
  similarity?: number;
  targetPosition?: { percentW: number; percentH: number };
  offsetX?: number;
  offsetY?: number;

  // NEW: Monitor override (inherits from image if not set)
  monitors?: number[];              // Override image's monitors
}

// UPDATED: StateImage with monitors
export interface StateImage {
  id: string;
  name: string;
  patterns: Pattern[];
  shared: boolean;
  probability?: number;
  source?: string;
  searchRegions?: SearchRegion[];

  // NEW: Computed from patterns (can be overridden)
  monitors?: number[];              // Union of all pattern monitors
}

// UPDATED: StateRegion with monitors (required for fixed regions)
export interface StateRegion {
  id: string;
  name: string;
  bounds: Region;
  fixed?: boolean;
  isSearchRegion?: boolean;
  isInteractionRegion?: boolean;
  referenceImageId?: string;
  position?: { percentW: number; percentH: number; positionName?: string };
  offsetX?: number;
  offsetY?: number;

  // NEW: Required for fixed regions
  monitors?: number[];              // Which monitors this region is on
}

// UPDATED: StateLocation with monitors
export interface StateLocation {
  id: string;
  name: string;
  x: number;
  y: number;
  anchor?: boolean;
  fixed?: boolean;

  // NEW: Required for fixed locations
  monitors?: number[];              // Which monitor(s) this point is on
}

// UPDATED: SearchRegion with monitors
export interface SearchRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  referenceImageId?: string;

  // NEW: Monitor constraint
  monitors?: number[];              // Which monitors to search
}

// UPDATED: Workflow with computed monitor requirements
export interface Workflow {
  id: string;
  name: string;
  description?: string;
  category?: string;
  format: "graph";
  version: string;
  actions: Action[];
  connections: WorkflowConnections;
  metadata?: WorkflowMetadata;
  expectations?: WorkflowExpectations;
  initialStateIds?: string[];

  // NEW: Computed monitor requirements
  monitorRequirements?: {
    monitors: number[];             // All monitors referenced by actions
    isMultiMonitor: boolean;        // Workflow spans multiple monitors
  };
}

// Bump schema version
export const CURRENT_EXPORT_VERSION = "2.6.0";
```

### 1.2 Config Migration

**File:** `qontinui-web/frontend/src/lib/config-migration/migrations/v2.5.0-to-v2.6.0.ts`

```typescript
export function migrateV2_5_0_to_V2_6_0(config: ExportConfig): ExportConfig {
  const migrated = structuredClone(config);

  // Add empty monitors array to all images (default: primary monitor)
  migrated.images = migrated.images.map(img => ({
    ...img,
    monitors: img.monitors ?? [0],  // Default to primary monitor
  }));

  // StateImages, StateRegions, StateLocations get monitors: undefined
  // (inherits from referenced images or uses runtime override)

  migrated.version = "2.6.0";
  return migrated;
}
```

---

## Phase 2: Multi-Monitor Screenshot Capture

### 2.1 Library Changes (qontinui)

**File:** `src/qontinui/hal/interfaces/screen_capture.py`

```python
@dataclass
class MultiMonitorCaptureResult:
    """Result of capturing multiple monitors as single image."""
    image: Image.Image
    monitors: list[Monitor]           # Monitors included in capture
    combined_bounds: Region           # Total bounds of captured area
    monitor_regions: dict[int, Region]  # Per-monitor regions within image
```

**File:** `src/qontinui/hal/implementations/mss_capture.py`

Add method to capture adjacent monitors:

```python
def capture_adjacent_monitors(
    self,
    monitor_indices: list[int]
) -> MultiMonitorCaptureResult:
    """
    Capture multiple adjacent monitors as a single combined image.

    Args:
        monitor_indices: List of monitor indices to capture (must be adjacent)

    Returns:
        MultiMonitorCaptureResult with combined image and per-monitor regions

    Raises:
        ValueError: If monitors are not adjacent
    """
    monitors = [self.get_monitors()[i] for i in monitor_indices]

    # Validate adjacency
    if not self._are_monitors_adjacent(monitors):
        raise ValueError(f"Monitors {monitor_indices} are not adjacent")

    # Calculate combined bounds
    min_x = min(m.x for m in monitors)
    min_y = min(m.y for m in monitors)
    max_x = max(m.x + m.width for m in monitors)
    max_y = max(m.y + m.height for m in monitors)

    combined_bounds = Region(
        x=min_x, y=min_y,
        width=max_x - min_x,
        height=max_y - min_y
    )

    # Capture combined region
    with mss.mss() as sct:
        # MSS monitor dict format
        capture_region = {
            "left": min_x,
            "top": min_y,
            "width": combined_bounds.width,
            "height": combined_bounds.height
        }
        screenshot = sct.grab(capture_region)
        image = Image.frombytes("RGB", screenshot.size, screenshot.bgra, "raw", "BGRX")

    # Calculate per-monitor regions within combined image
    monitor_regions = {}
    for m in monitors:
        monitor_regions[m.index] = Region(
            x=m.x - min_x,  # Relative to combined image origin
            y=m.y - min_y,
            width=m.width,
            height=m.height
        )

    return MultiMonitorCaptureResult(
        image=image,
        monitors=monitors,
        combined_bounds=combined_bounds,
        monitor_regions=monitor_regions
    )

def _are_monitors_adjacent(self, monitors: list[Monitor]) -> bool:
    """Check if monitors share edges (adjacent horizontally or vertically)."""
    if len(monitors) <= 1:
        return True

    # Build adjacency graph
    for i, m1 in enumerate(monitors):
        has_neighbor = False
        for j, m2 in enumerate(monitors):
            if i == j:
                continue
            # Check horizontal adjacency (share vertical edge)
            if (m1.x + m1.width == m2.x or m2.x + m2.width == m1.x):
                if not (m1.y + m1.height <= m2.y or m2.y + m2.height <= m1.y):
                    has_neighbor = True
                    break
            # Check vertical adjacency (share horizontal edge)
            if (m1.y + m1.height == m2.y or m2.y + m2.height == m1.y):
                if not (m1.x + m1.width <= m2.x or m2.x + m2.width <= m1.x):
                    has_neighbor = True
                    break
        if not has_neighbor:
            return False
    return True
```

### 2.2 API Changes (qontinui-api)

**File:** `qontinui-api/main.py` (or appropriate router)

```python
@router.get("/api/capture/screenshot/multi")
async def capture_multi_monitor(
    monitors: str = Query(..., description="Comma-separated monitor indices, e.g., '0,1'")
) -> MultiMonitorCaptureResponse:
    """Capture multiple adjacent monitors as single image."""
    monitor_indices = [int(m.strip()) for m in monitors.split(",")]

    result = screen_capture.capture_adjacent_monitors(monitor_indices)

    # Encode image
    buffer = io.BytesIO()
    result.image.save(buffer, format="PNG")
    base64_image = base64.b64encode(buffer.getvalue()).decode()

    return MultiMonitorCaptureResponse(
        success=True,
        screenshot_base64=base64_image,
        width=result.combined_bounds.width,
        height=result.combined_bounds.height,
        monitors=[m.index for m in result.monitors],
        monitor_regions={
            str(idx): {
                "x": r.x, "y": r.y,
                "width": r.width, "height": r.height
            }
            for idx, r in result.monitor_regions.items()
        }
    )
```

### 2.3 Runner Changes (qontinui-runner)

**File:** `src-tauri/src/commands/screenshot.rs`

```rust
#[derive(Serialize, Deserialize)]
pub struct MultiMonitorCaptureResult {
    success: bool,
    screenshot_base64: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    monitors: Vec<i32>,
    monitor_regions: Option<HashMap<String, MonitorRegion>>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct MonitorRegion {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[tauri::command]
pub async fn capture_multi_monitor(
    monitors: Vec<i32>,
    state: State<'_, AppState>,
) -> Result<MultiMonitorCaptureResult, String> {
    let monitors_param = monitors.iter()
        .map(|m| m.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let url = format!(
        "http://localhost:8001/api/capture/screenshot/multi?monitors={}",
        monitors_param
    );

    // ... HTTP call and response handling
}
```

**File:** `src/components/CaptureTab.tsx`

Add multi-monitor capture UI:

```typescript
// State for multi-monitor selection
const [selectedMonitors, setSelectedMonitors] = useState<number[]>([]);
const [captureMode, setCaptureMode] = useState<"single" | "multi">("single");

// Multi-monitor capture handler
const handleMultiMonitorCapture = async () => {
  if (selectedMonitors.length < 2) {
    toast.error("Select at least 2 monitors for multi-monitor capture");
    return;
  }

  try {
    const result = await invoke<MultiMonitorCaptureResult>(
      "capture_multi_monitor",
      { monitors: selectedMonitors }
    );

    if (result.success) {
      // Store with monitors array
      // ...
    }
  } catch (error) {
    toast.error(`Multi-monitor capture failed: ${error}`);
  }
};

// UI for selecting multiple monitors
<div className="space-y-2">
  <Label>Capture Mode</Label>
  <RadioGroup value={captureMode} onValueChange={setCaptureMode}>
    <RadioGroupItem value="single" label="Single Monitor" />
    <RadioGroupItem value="multi" label="Multiple Monitors (Adjacent)" />
  </RadioGroup>

  {captureMode === "multi" && (
    <div className="grid grid-cols-3 gap-2">
      {monitors.map((monitor) => (
        <Button
          key={monitor.index}
          variant={selectedMonitors.includes(monitor.index) ? "default" : "outline"}
          onClick={() => toggleMonitorSelection(monitor.index)}
        >
          Monitor {monitor.index}
          {monitor.is_primary && " (Primary)"}
          <br />
          {monitor.width}x{monitor.height}
        </Button>
      ))}
    </div>
  )}
</div>
```

---

## Phase 3: Library Find Operation Updates

### 3.1 FindOptions Update

**File:** `src/qontinui/actions/find/find_options.py`

```python
@dataclass
class FindOptions:
    similarity: float | None = None
    find_all: bool = False
    search_region: Region | None = None
    timeout: float = 30.0
    collect_debug: bool = False

    # UPDATED: Support list of monitors
    monitors: list[int] | None = None  # None = all monitors, [] = invalid

    def __post_init__(self):
        if self.monitors is not None and len(self.monitors) == 0:
            raise ValueError("monitors cannot be empty list; use None for all monitors")
```

### 3.2 FindResult Update

**File:** `src/qontinui/actions/find/find_result.py` (or appropriate file)

```python
@dataclass
class FindResult:
    found: bool
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    confidence: float = 0.0

    # NEW: Monitor information
    monitor_index: int = 0              # Which monitor the match is on
    monitor_relative_x: int = 0         # X relative to monitor origin
    monitor_relative_y: int = 0         # Y relative to monitor origin
```

### 3.3 RealFindImplementation Update

**File:** `src/qontinui/actions/find/real_find_implementation.py`

```python
class RealFindImplementation:
    def find(
        self,
        pattern: Pattern,
        options: FindOptions | None = None
    ) -> FindResult:
        options = options or FindOptions()

        # Determine which monitors to search
        monitors_to_search = self._get_monitors_to_search(pattern, options)

        # For fixed regions, filter to monitors where region intersects
        if options.search_region and pattern.fixed:
            monitors_to_search = self._filter_monitors_for_region(
                monitors_to_search,
                options.search_region
            )

        # Capture relevant monitors
        if len(monitors_to_search) == 1:
            screenshot = self.hal.capture_screen(monitors_to_search[0])
        else:
            # Capture each monitor and search separately for efficiency
            # (or capture combined if adjacent)
            return self._search_multiple_monitors(
                pattern, options, monitors_to_search
            )

        # ... existing template matching logic ...

        # Add monitor info to result
        result.monitor_index = monitors_to_search[0]
        result.monitor_relative_x = result.x - monitor.x
        result.monitor_relative_y = result.y - monitor.y

        return result

    def _get_monitors_to_search(
        self,
        pattern: Pattern,
        options: FindOptions
    ) -> list[int]:
        """Determine which monitors to search based on pattern and options."""
        # Priority:
        # 1. FindOptions.monitors (explicit override)
        # 2. Pattern.monitors (from state element)
        # 3. All monitors (fallback)

        if options.monitors is not None:
            return options.monitors

        if hasattr(pattern, 'monitors') and pattern.monitors:
            return pattern.monitors

        # Default: all monitors
        return [m.index for m in self.hal.get_monitors()]

    def _filter_monitors_for_region(
        self,
        monitors: list[int],
        region: Region
    ) -> list[int]:
        """Filter monitors to only those where region intersects."""
        result = []
        all_monitors = {m.index: m for m in self.hal.get_monitors()}

        for idx in monitors:
            monitor = all_monitors.get(idx)
            if monitor and self._region_intersects_monitor(region, monitor):
                result.append(idx)

        return result if result else monitors  # Fallback to all if none intersect

    def _region_intersects_monitor(
        self,
        region: Region,
        monitor: Monitor
    ) -> bool:
        """Check if a region intersects with a monitor's bounds."""
        return not (
            region.x + region.width <= monitor.x or
            region.x >= monitor.x + monitor.width or
            region.y + region.height <= monitor.y or
            region.y >= monitor.y + monitor.height
        )

    def _search_multiple_monitors(
        self,
        pattern: Pattern,
        options: FindOptions,
        monitors: list[int]
    ) -> FindResult:
        """Search multiple monitors, returning best match."""
        best_result = FindResult(found=False)

        for monitor_idx in monitors:
            screenshot = self.hal.capture_screen(monitor_idx)
            result = self._search_single_image(pattern, screenshot, options)

            if result.found:
                result.monitor_index = monitor_idx

                # Return first match if not finding all
                if not options.find_all:
                    return result

                # Keep best confidence match
                if result.confidence > best_result.confidence:
                    best_result = result

        return best_result
```

---

## Phase 4: Runner Execution Updates

### 4.1 Python Bridge Updates

**File:** `qontinui-runner/python-bridge/gui_automation.py`

```python
class GUIAutomationExecutor:
    def __init__(self, ...):
        # ...
        self.monitor_override: list[int] | None = None

    def set_monitor_override(self, monitors: list[int] | None):
        """Set runtime monitor override for all find operations."""
        self.monitor_override = monitors

    def execute_find_action(self, action: dict) -> FindResult:
        """Execute a FIND action with monitor awareness."""
        config = action.get("config", {})
        target = config.get("target", {})

        # Get monitors from action config or state element
        monitors = self._resolve_monitors(target)

        # Apply runtime override if set
        if self.monitor_override is not None:
            monitors = self.monitor_override

        # Build find options
        find_options = FindOptions(
            monitors=monitors,
            search_region=self._get_search_region(config),
            similarity=config.get("similarity"),
            timeout=config.get("timeout", 30.0),
        )

        # Execute find
        pattern = self._resolve_pattern(target)
        return self.finder.find(pattern, find_options)

    def _resolve_monitors(self, target: dict) -> list[int] | None:
        """
        Resolve monitors for a target.

        Priority:
        1. Action-level monitors override
        2. StateImage monitors
        3. Pattern monitors (from referenced image)
        4. None (search all)
        """
        # Check action-level override
        if "monitors" in target:
            return target["monitors"]

        # Check StateImage
        if target.get("type") == "stateImage":
            state_image = self._get_state_image(target["stateImageId"])
            if state_image and state_image.get("monitors"):
                return state_image["monitors"]

        # Check Pattern's referenced image
        if target.get("type") == "image":
            image_id = target.get("imageIds", [None])[0]
            if image_id:
                image = self._get_image(image_id)
                if image and image.get("monitors"):
                    return image["monitors"]

        return None  # Search all monitors
```

### 4.2 Runner UI: Monitor Override

**File:** `src/components/ExecutionPanel.tsx` (or similar)

```typescript
interface ExecutionSettings {
  monitorOverride: number[] | "all" | null;  // null = use element values
}

const [executionSettings, setExecutionSettings] = useState<ExecutionSettings>({
  monitorOverride: null,
});

// Monitor override selector
<div className="space-y-2">
  <Label>Monitor Override</Label>
  <Select
    value={executionSettings.monitorOverride === null ? "auto" :
           executionSettings.monitorOverride === "all" ? "all" :
           executionSettings.monitorOverride.join(",")}
    onValueChange={(value) => {
      if (value === "auto") {
        setExecutionSettings({ ...executionSettings, monitorOverride: null });
      } else if (value === "all") {
        setExecutionSettings({ ...executionSettings, monitorOverride: "all" });
      } else {
        setExecutionSettings({
          ...executionSettings,
          monitorOverride: value.split(",").map(Number)
        });
      }
    }}
  >
    <SelectItem value="auto">Auto (use element monitors)</SelectItem>
    <SelectItem value="all">All Monitors (slower)</SelectItem>
    {monitors.map((m) => (
      <SelectItem key={m.index} value={String(m.index)}>
        Monitor {m.index} {m.is_primary ? "(Primary)" : ""}
      </SelectItem>
    ))}
  </Select>

  <p className="text-xs text-muted-foreground">
    Auto uses monitor values from state elements.
    Override to search specific monitors regardless of element settings.
  </p>
</div>
```

---

## Phase 5: Web Frontend Updates

### 5.1 State Element Editing UI

**File:** `qontinui-web/frontend/src/components/state-properties-panel.tsx`

Add monitor field to state element editors:

```typescript
interface MonitorSelectorProps {
  value: number[] | undefined;
  onChange: (monitors: number[] | undefined) => void;
  label?: string;
  helpText?: string;
}

function MonitorSelector({ value, onChange, label, helpText }: MonitorSelectorProps) {
  const [availableMonitors, setAvailableMonitors] = useState<MonitorInfo[]>([]);

  // Fetch available monitors from runner (if connected) or show manual input

  return (
    <div className="space-y-2">
      <Label>{label || "Monitors"}</Label>

      {/* Quick select options */}
      <div className="flex gap-2">
        <Button
          variant={value === undefined ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(undefined)}
        >
          Auto
        </Button>
        <Button
          variant={value?.length === 1 && value[0] === 0 ? "default" : "outline"}
          size="sm"
          onClick={() => onChange([0])}
        >
          Primary
        </Button>
      </div>

      {/* Manual monitor selection */}
      <div className="flex flex-wrap gap-1">
        {[0, 1, 2, 3].map((idx) => (
          <Toggle
            key={idx}
            pressed={value?.includes(idx)}
            onPressedChange={(pressed) => {
              if (pressed) {
                onChange([...(value || []), idx].sort());
              } else {
                onChange(value?.filter((m) => m !== idx));
              }
            }}
          >
            {idx}
          </Toggle>
        ))}
      </div>

      {helpText && (
        <p className="text-xs text-muted-foreground">{helpText}</p>
      )}
    </div>
  );
}

// In StateImage editor
<MonitorSelector
  value={stateImage.monitors}
  onChange={(monitors) => updateStateImage({ ...stateImage, monitors })}
  label="Target Monitors"
  helpText="Which monitors to search when finding this image. Leave as Auto to inherit from captured image."
/>

// In StateRegion editor (for fixed regions)
{stateRegion.fixed && (
  <MonitorSelector
    value={stateRegion.monitors}
    onChange={(monitors) => updateStateRegion({ ...stateRegion, monitors })}
    label="Region Monitors"
    helpText="Required for fixed regions. Specifies which monitor(s) this region is on."
  />
)}
```

### 5.2 Batch Monitor Edit

**File:** `qontinui-web/frontend/src/components/state-machine-canvas/BatchMonitorEditor.tsx`

```typescript
interface BatchMonitorEditorProps {
  selectedElements: (StateImage | StateRegion | StateLocation)[];
  onUpdate: (updates: Map<string, { monitors: number[] }>) => void;
}

function BatchMonitorEditor({ selectedElements, onUpdate }: BatchMonitorEditorProps) {
  const [newMonitors, setNewMonitors] = useState<number[]>([0]);

  const handleApply = () => {
    const updates = new Map();
    for (const element of selectedElements) {
      updates.set(element.id, { monitors: newMonitors });
    }
    onUpdate(updates);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Monitor className="w-4 h-4 mr-2" />
          Change Monitors ({selectedElements.length} selected)
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Batch Update Monitors</DialogTitle>
          <DialogDescription>
            Update monitor assignment for {selectedElements.length} selected elements.
            This is useful when you've changed your monitor configuration.
          </DialogDescription>
        </DialogHeader>

        <MonitorSelector
          value={newMonitors}
          onChange={setNewMonitors}
          label="New Monitor Assignment"
        />

        <DialogFooter>
          <Button onClick={handleApply}>
            Apply to {selectedElements.length} Elements
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### 5.3 Image Library Monitor Display

**File:** `qontinui-web/frontend/src/components/image-library/ImageCard.tsx`

```typescript
// Show monitor badge on image cards
<div className="relative">
  <img src={image.data} alt={image.name} />

  {/* Monitor badge */}
  {image.monitors && (
    <Badge
      variant="secondary"
      className="absolute top-1 right-1 text-xs"
    >
      <Monitor className="w-3 h-3 mr-1" />
      {image.monitors.length === 1
        ? `M${image.monitors[0]}`
        : `M${image.monitors.join(",")}`}
    </Badge>
  )}

  {/* Multi-monitor indicator */}
  {image.monitors && image.monitors.length > 1 && (
    <Badge variant="outline" className="absolute bottom-1 right-1 text-xs">
      Multi-Monitor
    </Badge>
  )}
</div>
```

---

## Phase 6: Workflow Monitor Computation

### 6.1 Compute Workflow Monitor Requirements

**File:** `qontinui-web/frontend/src/lib/workflow-monitor-analyzer.ts`

```typescript
interface WorkflowMonitorRequirements {
  monitors: number[];           // All monitors referenced
  isMultiMonitor: boolean;      // Spans multiple monitors
  monitorsByAction: Map<string, number[]>;  // Per-action breakdown
  warnings: string[];           // Any issues detected
}

export function analyzeWorkflowMonitors(
  workflow: Workflow,
  states: State[],
  images: ImageAsset[]
): WorkflowMonitorRequirements {
  const monitors = new Set<number>();
  const monitorsByAction = new Map<string, number[]>();
  const warnings: string[] = [];

  // Build lookup maps
  const stateMap = new Map(states.map(s => [s.id, s]));
  const imageMap = new Map(images.map(i => [i.id, i]));

  for (const action of workflow.actions) {
    const actionMonitors = getActionMonitors(action, stateMap, imageMap);

    if (actionMonitors.length === 0) {
      warnings.push(`Action ${action.id} has no monitor information`);
    }

    actionMonitors.forEach(m => monitors.add(m));
    monitorsByAction.set(action.id, actionMonitors);
  }

  return {
    monitors: Array.from(monitors).sort(),
    isMultiMonitor: monitors.size > 1,
    monitorsByAction,
    warnings,
  };
}

function getActionMonitors(
  action: Action,
  stateMap: Map<string, State>,
  imageMap: Map<string, ImageAsset>
): number[] {
  const config = action.config;
  const target = config?.target;

  if (!target) return [];

  // Check action-level override
  if (target.monitors) {
    return target.monitors;
  }

  // Check StateImage
  if (target.type === "stateImage" && target.stateImageId) {
    // Look up state image and get its monitors
    // ...
  }

  // Check referenced image
  if (target.type === "image" && target.imageIds?.[0]) {
    const image = imageMap.get(target.imageIds[0]);
    if (image?.monitors) {
      return image.monitors;
    }
  }

  return [];  // Unknown - will search all monitors at runtime
}
```

### 6.2 Auto-Update Workflow Monitor Requirements

**File:** `qontinui-web/frontend/src/contexts/automation-context/workflow-hooks.ts`

```typescript
// Recompute monitor requirements when workflow changes
useEffect(() => {
  if (selectedWorkflow) {
    const requirements = analyzeWorkflowMonitors(
      selectedWorkflow,
      states,
      images
    );

    // Update workflow with computed requirements
    updateWorkflow({
      ...selectedWorkflow,
      monitorRequirements: {
        monitors: requirements.monitors,
        isMultiMonitor: requirements.isMultiMonitor,
      },
    });

    // Show warnings if any
    if (requirements.warnings.length > 0) {
      console.warn("Workflow monitor warnings:", requirements.warnings);
    }
  }
}, [selectedWorkflow?.actions, states, images]);
```

---

## Phase 7: Export/Import Updates

### 7.1 Config Exporter

**File:** `qontinui-web/frontend/src/lib/config-exporter.ts`

```typescript
export function exportConfig(automation: AutomationState): ExportConfig {
  // ... existing export logic ...

  // Ensure all images have monitors field
  const images = automation.images.map(img => ({
    ...img,
    monitors: img.monitors ?? [0],  // Default to primary
  }));

  // Compute workflow monitor requirements
  const workflows = automation.workflows.map(wf => {
    const requirements = analyzeWorkflowMonitors(wf, automation.states, images);
    return {
      ...wf,
      monitorRequirements: {
        monitors: requirements.monitors,
        isMultiMonitor: requirements.isMultiMonitor,
      },
    };
  });

  return {
    version: CURRENT_EXPORT_VERSION,
    // ...
    images,
    workflows,
    // ...
  };
}
```

---

## Implementation Order

### Sprint 1: Schema & Library Core (Week 1-2)

1. **Schema updates** (export-schema.ts)
   - Add monitor fields to all types
   - Create config migration v2.5.0 → v2.6.0
   - Update version to 2.6.0

2. **Library find operation updates** (qontinui)
   - Update FindOptions to accept `monitors: list[int] | None`
   - Update FindResult to include `monitor_index`
   - Implement monitor-aware find in RealFindImplementation

### Sprint 2: Multi-Monitor Capture (Week 2-3)

3. **Multi-monitor capture** (qontinui HAL)
   - Implement `capture_adjacent_monitors()`
   - Add adjacency validation

4. **API endpoint** (qontinui-api)
   - Add `/api/capture/screenshot/multi` endpoint

5. **Runner capture UI** (qontinui-runner)
   - Add multi-monitor capture mode to CaptureTab
   - Store monitors array with captured images

### Sprint 3: Runner Execution (Week 3-4)

6. **Python bridge updates** (qontinui-runner)
   - Pass monitors to find operations
   - Implement monitor resolution logic
   - Add runtime override support

7. **Runner UI** (qontinui-runner)
   - Add monitor override selector to execution panel
   - Display workflow monitor requirements

### Sprint 4: Web Frontend (Week 4-5)

8. **State element editing** (qontinui-web)
   - Add MonitorSelector component
   - Update state element editors
   - Add batch monitor edit

9. **Image library** (qontinui-web)
   - Show monitor badges on images
   - Update image upload to set default monitors

10. **Workflow analysis** (qontinui-web)
    - Implement workflow monitor analyzer
    - Auto-compute monitor requirements
    - Show warnings for missing monitor info

### Sprint 5: Testing & Documentation (Week 5-6)

11. **Testing**
    - Unit tests for find operation monitor handling
    - Integration tests for multi-monitor capture
    - E2E tests for workflow execution with monitors

12. **Documentation**
    - Update user docs with monitor features
    - Add troubleshooting guide for multi-monitor setups

---

## Migration Strategy

### Existing Configurations

1. **Images without monitors** → Default to `[0]` (primary monitor)
2. **StateImages without monitors** → Inherit from patterns/images
3. **Fixed regions without monitors** → Show warning in UI, require user input
4. **Workflows** → Auto-compute monitor requirements on load

### User Workflow

1. User loads existing config → Migration adds default monitors
2. User captures new screenshots → Monitors auto-populated
3. User creates fixed regions → Must specify monitors
4. User runs workflow → Runner shows computed monitor requirements
5. User can override monitors at runtime if needed

---

## Testing Plan

### Unit Tests

```python
# test_find_monitors.py
def test_find_with_single_monitor():
    """Find operation respects single monitor constraint."""

def test_find_with_multiple_monitors():
    """Find operation searches all specified monitors."""

def test_find_with_none_monitors():
    """Find operation searches all monitors when None."""

def test_fixed_region_monitor_filtering():
    """Fixed regions filter to monitors where region intersects."""
```

### Integration Tests

```python
# test_multi_monitor_capture.py
def test_capture_adjacent_monitors():
    """Capture two adjacent monitors as single image."""

def test_capture_non_adjacent_fails():
    """Capture non-adjacent monitors raises error."""

def test_capture_result_has_monitor_regions():
    """Result includes per-monitor regions within combined image."""
```

### E2E Tests

```typescript
// monitor-workflow.spec.ts
test("workflow runs on correct monitor", async () => {
  // Load config with monitor-specific elements
  // Run workflow
  // Verify find operations targeted correct monitor
});

test("monitor override works at runtime", async () => {
  // Set monitor override
  // Run workflow
  // Verify all finds used override monitor
});
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing configs | High | Migration defaults to primary monitor |
| Performance regression | Medium | Only capture specified monitors, not all |
| Complex multi-monitor setups | Medium | Support runtime override for edge cases |
| Cross-platform monitor differences | Medium | Store both index and position for flexibility |
| User confusion | Low | Clear UI with helpful defaults |

---

## Success Metrics

1. **Automatic monitor selection** works for 90%+ of workflows
2. **Find operation time** reduced by 50%+ on multi-monitor setups (searching 1 vs all)
3. **Fixed region reliability** increased (no wrong-monitor searches)
4. **Zero breaking changes** for existing configurations (migration handles all cases)
