# Custom Drag Web UI Implementation Guide

## ✅ COMPLETED: TypeScript Types

All TypeScript types have been added to qontinui-web.

### Files Modified:

1. **`src/lib/action-schema/configs/mouse-actions.ts`**
   - Added `PathPoint` interface
   - Added `CustomDragActionConfig` interface

2. **`src/lib/action-schema/action-types.ts`**
   - Added `CUSTOM_DRAG` to `MouseActionType`
   - Added `CUSTOM_DRAG: CustomDragActionConfig` to `ActionConfigMap`
   - Imported `CustomDragActionConfig` and `PathPoint`

## 📋 Remaining Work

### 1. Add Action Definition

**File**: `src/config/actionDefinitions.ts` or similar

Find where action definitions are registered (look for the DRAG action definition) and add:

```typescript
{
  type: 'CUSTOM_DRAG',
  name: 'Custom Drag',
  description: 'Replay a recorded drag with exact path and timing',
  category: 'Mouse',
  icon: /* Find appropriate icon - maybe GestureIcon or custom */,
  color: '#9C27B0', // Purple to distinguish from regular drag
  defaultConfig: {
    path: [],
    mouseButton: 'left',
    speedMultiplier: 1.0
  },
  configComponent: 'CustomDragConfig' // Component name we'll create
}
```

### 2. Create Config Component Directory

**Location**: `src/components/ActionEditor/configs/`

Check if this directory exists:
```bash
ls -la src/components/ActionEditor/configs/
```

If it doesn't exist, find where action config components are located.

### 3. Create CustomDragConfig Component

**File**: `src/components/ActionEditor/configs/CustomDragConfig.tsx`

```typescript
import React, { useState } from 'react';
import { CustomDragActionConfig, PathPoint } from '@/lib/action-schema/action-types';

interface Props {
  config: CustomDragActionConfig;
  onChange: (config: CustomDragActionConfig) => void;
}

interface PathMetrics {
  duration: number;
  distance: number;
  linear: number;
  complexity: number;
  velocity: number;
  numPoints: number;
}

export const CustomDragConfig: React.FC<Props> = ({ config, onChange }) => {
  const [pathSource, setPathSource] = useState<'file' | 'embedded'>(
    typeof config.path === 'string' ? 'file' : 'embedded'
  );

  // Handle file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const dragData = JSON.parse(text);

      // Check for valid format
      if (!dragData.path_points || !Array.isArray(dragData.path_points)) {
        alert('Invalid drag file format. Expected "path_points" array.');
        return;
      }

      // Convert from capture format to config format
      const pathPoints: PathPoint[] = dragData.path_points.map((p: any) => ({
        x: p.x,
        y: p.y,
        timestamp: p.timestamp
      }));

      onChange({
        ...config,
        path: pathPoints
      });
    } catch (error) {
      alert(`Error loading drag file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Calculate metrics from path
  const getPathMetrics = (): PathMetrics | null => {
    if (typeof config.path === 'string' || !Array.isArray(config.path) || config.path.length < 2) {
      return null;
    }

    const start = config.path[0];
    const end = config.path[config.path.length - 1];
    const duration = end.timestamp;

    // Calculate total distance
    let distance = 0;
    for (let i = 1; i < config.path.length; i++) {
      const p1 = config.path[i - 1];
      const p2 = config.path[i];
      distance += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    }

    const linear = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);
    const complexity = linear > 0 ? distance / linear : 1;
    const velocity = duration > 0 ? distance / duration : 0;

    return {
      duration,
      distance,
      linear,
      complexity,
      velocity,
      numPoints: config.path.length
    };
  };

  const metrics = getPathMetrics();

  return (
    <div className="space-y-4">
      {/* Path Source Selection */}
      <div>
        <label className="block text-sm font-medium mb-2">Path Source</label>
        <div className="flex gap-4">
          <button
            type="button"
            className={`px-4 py-2 rounded ${
              pathSource === 'file'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setPathSource('file')}
          >
            Load from File
          </button>
          <button
            type="button"
            className={`px-4 py-2 rounded ${
              pathSource === 'embedded'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setPathSource('embedded')}
          >
            Embedded Path
          </button>
        </div>
      </div>

      {/* File Upload */}
      {pathSource === 'file' && (
        <div>
          <label className="block text-sm font-medium mb-2">Drag File</label>
          <input
            type="file"
            accept=".json"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-full file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100
              cursor-pointer"
          />
          <p className="text-sm text-gray-500 mt-1">
            Upload a drag_N.json file from manual capture
          </p>
        </div>
      )}

      {/* Path Status */}
      {Array.isArray(config.path) && config.path.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded p-3">
          <p className="text-sm text-green-800">
            ✓ Path loaded with {config.path.length} points
          </p>
        </div>
      )}

      {/* Path Metrics */}
      {metrics && (
        <div className="bg-gray-50 border border-gray-200 rounded p-4">
          <h4 className="font-medium mb-2 text-sm">Path Metrics</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Points:</span>
              <span className="font-medium">{metrics.numPoints}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Duration:</span>
              <span className="font-medium">{metrics.duration.toFixed(2)}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Distance:</span>
              <span className="font-medium">{metrics.distance.toFixed(1)}px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Linear:</span>
              <span className="font-medium">{metrics.linear.toFixed(1)}px</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Velocity:</span>
              <span className="font-medium">{metrics.velocity.toFixed(0)}px/s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Complexity:</span>
              <span className="font-medium">{metrics.complexity.toFixed(2)}</span>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Complexity: 1.0 = straight line, &gt;1.0 = curved path
          </p>
        </div>
      )}

      {/* Path Visualization - TODO: Create PathVisualization component */}
      {/* {Array.isArray(config.path) && config.path.length > 0 && (
        <PathVisualization path={config.path} />
      )} */}

      {/* Mouse Button */}
      <div>
        <label className="block text-sm font-medium mb-2">Mouse Button</label>
        <select
          value={config.mouseButton || 'left'}
          onChange={(e) =>
            onChange({
              ...config,
              mouseButton: e.target.value as 'left' | 'right' | 'middle'
            })
          }
          className="w-full p-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value="left">Left</option>
          <option value="right">Right</option>
          <option value="middle">Middle</option>
        </select>
      </div>

      {/* Speed Multiplier */}
      <div>
        <label className="block text-sm font-medium mb-2">
          Speed Multiplier: {config.speedMultiplier || 1.0}x
        </label>
        <input
          type="range"
          min="0.1"
          max="3.0"
          step="0.1"
          value={config.speedMultiplier || 1.0}
          onChange={(e) =>
            onChange({
              ...config,
              speedMultiplier: parseFloat(e.target.value)
            })
          }
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0.1x (Slow)</span>
          <span>1.0x (Normal)</span>
          <span>3.0x (Fast)</span>
        </div>
      </div>

      {/* Start Offset */}
      <div>
        <label className="flex items-center gap-2 text-sm font-medium mb-2">
          <input
            type="checkbox"
            checked={!!config.startOffset}
            onChange={(e) =>
              onChange({
                ...config,
                startOffset: e.target.checked ? { x: 0, y: 0 } : undefined
              })
            }
            className="rounded"
          />
          Apply Start Offset
        </label>

        {config.startOffset && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <div>
              <label className="block text-xs text-gray-600 mb-1">Offset X</label>
              <input
                type="number"
                value={config.startOffset.x}
                onChange={(e) =>
                  onChange({
                    ...config,
                    startOffset: {
                      ...config.startOffset!,
                      x: parseInt(e.target.value) || 0
                    }
                  })
                }
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-600 mb-1">Offset Y</label>
              <input
                type="number"
                value={config.startOffset.y}
                onChange={(e) =>
                  onChange({
                    ...config,
                    startOffset: {
                      ...config.startOffset!,
                      y: parseInt(e.target.value) || 0
                    }
                  })
                }
                className="w-full p-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        )}
      </div>

      {/* Help Text */}
      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-sm text-blue-800">
          <strong>Tip:</strong> Capture a drag using the manual capture tool in the runner,
          then upload the drag_N.json file here to replay it exactly.
        </p>
      </div>
    </div>
  );
};
```

### 4. Register Component

Find where config components are registered/exported (likely in `src/components/ActionEditor/configs/index.ts` or similar):

```typescript
export { CustomDragConfig } from './CustomDragConfig';
```

### 5. Optional: Create Path Visualization

For a better UX, create a canvas component to visualize the path:

**File**: `src/components/ActionEditor/configs/PathVisualization.tsx`

```typescript
import React, { useEffect, useRef } from 'react';
import { PathPoint } from '@/lib/action-schema/action-types';

interface Props {
  path: PathPoint[];
  width?: number;
  height?: number;
}

export const PathVisualization: React.FC<Props> = ({
  path,
  width = 400,
  height = 300
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current || path.length < 2) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Calculate bounds
    const xs = path.map((p) => p.x);
    const ys = path.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const padding = 20;
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const scaleX = (width - 2 * padding) / rangeX;
    const scaleY = (height - 2 * padding) / rangeY;
    const scale = Math.min(scaleX, scaleY);

    // Transform point to canvas coordinates
    const transform = (p: PathPoint) => ({
      x: padding + (p.x - minX) * scale,
      y: padding + (p.y - minY) * scale
    });

    // Draw path
    ctx.strokeStyle = '#3B82F6';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.beginPath();
    const first = transform(path[0]);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < path.length; i++) {
      const point = transform(path[i]);
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();

    // Draw start point (green circle)
    const start = transform(path[0]);
    ctx.fillStyle = '#10B981';
    ctx.beginPath();
    ctx.arc(start.x, start.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    // Draw end point (red circle)
    const end = transform(path[path.length - 1]);
    ctx.fillStyle = '#EF4444';
    ctx.beginPath();
    ctx.arc(end.x, end.y, 6, 0, 2 * Math.PI);
    ctx.fill();

    // Draw direction arrow
    if (path.length > 1) {
      const prev = transform(path[path.length - 2]);
      const angle = Math.atan2(end.y - prev.y, end.x - prev.x);

      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(
        end.x - 10 * Math.cos(angle - Math.PI / 6),
        end.y - 10 * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        end.x - 10 * Math.cos(angle + Math.PI / 6),
        end.y - 10 * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
    }
  }, [path, width, height]);

  return (
    <div className="border border-gray-200 rounded p-3 bg-white">
      <div className="text-sm font-medium mb-2">Path Visualization</div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="border border-gray-300 rounded"
      />
      <div className="flex gap-4 mt-2 text-xs text-gray-600">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          Start
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          End
        </span>
      </div>
    </div>
  );
};
```

Then uncomment the visualization section in CustomDragConfig.tsx.

## Testing

### 1. Create Test Workflow
1. Open qontinui-web
2. Create new workflow
3. Add CUSTOM_DRAG action
4. Upload a captured drag file
5. Verify metrics display correctly
6. Adjust speed multiplier
7. Apply offset
8. Export workflow

### 2. Execute in Runner
1. Load workflow in qontinui-runner
2. Execute
3. Verify drag replays correctly
4. Check console logs for detailed execution info

## File Locations Summary

**Modified**:
- `src/lib/action-schema/configs/mouse-actions.ts` ✅
- `src/lib/action-schema/action-types.ts` ✅

**To Create**:
- `src/components/ActionEditor/configs/CustomDragConfig.tsx`
- `src/components/ActionEditor/configs/PathVisualization.tsx` (optional but recommended)

**To Find & Update**:
- Action definitions file (search for where DRAG is defined)
- Component exports file (search for where other config components are exported)

## Next Steps

1. Find and update action definitions
2. Create CustomDragConfig component
3. Export component
4. Test in development
5. Create example workflows

The backend is fully functional - once the UI is complete, users can capture complex drags and replay them perfectly!
