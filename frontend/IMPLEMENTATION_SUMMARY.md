# StateRegion Relative Positioning - Implementation Summary

## Overview
Implemented relative positioning for StateRegion objects, similar to how StateLocation works. Also implemented bidirectional linking between StateRegions (as SearchRegions) and StateImages.

## Completed Changes

### 1. TypeScript Interfaces (types.ts) ✓

**File**: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/contexts/automation-context/types.ts`

#### StateRegion
Added fields for relative positioning and search region functionality:
```typescript
export interface StateRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number

  // NEW: Relative positioning
  referenceImageId?: string
  position?: Position
  offsetX?: number
  offsetY?: number

  // NEW: SearchRegion flag
  isSearchRegion?: boolean

  actionHistory?: ActionHistory
}
```

#### StateImage
Added searchRegionIds array for linking to StateRegions:
```typescript
export interface StateImage {
  id: string
  name: string
  image: string
  mask?: string
  searchRegions?: SearchRegion[] // Legacy
  searchRegionIds?: string[] // NEW
  fixed?: boolean
  actionHistory?: ActionHistory
  source?: 'upload' | 'pattern-optimization'
  similarity?: number
  probability?: number
  index?: number
}
```

### 2. Export Schema (export-schema.ts) ✓

**File**: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/export-schema.ts`

#### StateRegion Interface
Added relative positioning fields:
```typescript
export interface StateRegion {
  id: string;
  name: string;
  bounds: Region;
  fixed?: boolean;
  isSearchRegion?: boolean;
  isInteractionRegion?: boolean;
  // NEW: Relative positioning
  referenceImageId?: string;
  position?: {
    percentW: number;
    percentH: number;
    positionName?: string;
  };
  offsetX?: number;
  offsetY?: number;
}
```

#### StateImage Interface
Added searchRegionIds and advanced properties:
```typescript
export interface StateImage {
  imageId: string;
  threshold: number;
  required: boolean;
  searchRegion?: Region;
  searchRegions?: SearchRegions; // Legacy
  searchRegionIds?: string[]; // NEW
  fixed?: boolean;
  shared?: boolean;
  probability?: number;
  index?: number; // NEW
  similarity?: number; // NEW
}
```

## Remaining Implementation Tasks

### 3. UI Components (state-properties-panel.tsx)

The UI implementation is ready in `/tmp/regions-tab-content.tsx`. It needs to be integrated into the main file.

#### Features Implemented in UI Code:

**Regions Tab:**
- Visual distinction for SearchRegions (purple background when `isSearchRegion = true`)
- SearchRegion checkbox with label
- Bidirectional link display ("Used by: [StateImage names]")
- Reference Image dropdown (like StateLocation)
- 9-position selector (TOPLEFT, TOPMIDDLE, TOPRIGHT, etc.)
- Offset X and Offset Y inputs
- Absolute/Relative mode indicator

**Images Tab (needs to be added):**
- SearchRegion selector showing available StateRegions
- Checkboxes for each StateRegion with `isSearchRegion = true`
- Updates `searchRegionIds` array in StateImage

### 4. State Machine Defaults (state-machine.tsx)

Update the `addRegion` function to initialize new fields:

```typescript
const addRegion = () => {
  if (!selectedNode) return
  const currentState = states.find((s) => s.id === selectedNode)
  if (!currentState) return

  const regions = currentState.regions || []
  const newRegion: StateRegion = {
    id: `region-${Date.now()}`,
    name: `Region ${regions.length + 1}`,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    isSearchRegion: false, // NEW
    offsetX: 0, // NEW
    offsetY: 0  // NEW
  }
  updateSelectedState({ regions: [...regions, newRegion] })
}
```

### 5. State Exporter (state-exporter.ts)

#### QontinuiStateRegion Interface
```typescript
interface QontinuiStateRegion {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isSearchRegion?: boolean; // NEW
  referenceImageId?: string; // NEW
  offsetX?: number; // NEW
  offsetY?: number; // NEW
  position?: { // NEW
    percentW: number;
    percentH: number;
    positionName?: string;
  };
}
```

#### Export Logic for StateRegions
```typescript
if (state.regions) {
  state.regions.forEach(region => {
    stateRegions.push({
      id: region.id,
      name: region.name,
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
      isSearchRegion: region.isSearchRegion, // NEW
      referenceImageId: region.referenceImageId, // NEW
      offsetX: region.offsetX ?? 0, // NEW
      offsetY: region.offsetY ?? 0, // NEW
      position: region.position // NEW
    });
  });
}
```

#### QontinuiStateImage Interface
```typescript
interface QontinuiStateImage {
  id: string;
  name: string;
  imagePath?: string;
  imageData?: string;
  searchRegions: QontinuiSearchRegion[];
  searchRegionIds?: string[]; // NEW
  fixed: boolean;
  similarity?: number; // NEW
  probability?: number; // NEW
  index?: number; // NEW
}
```

#### Export Logic for StateImages
```typescript
state.stateImages.forEach(stateImage => {
  stateImages.push({
    id: stateImage.id,
    name: stateImage.name,
    imageData: stateImage.image,
    searchRegions: (stateImage.searchRegions || []).map(sr => ({
      id: sr.id,
      name: sr.name,
      x: sr.x,
      y: sr.y,
      width: sr.width,
      height: sr.height
    })),
    searchRegionIds: stateImage.searchRegionIds, // NEW
    fixed: stateImage.fixed || false,
    similarity: stateImage.similarity, // NEW
    probability: stateImage.probability, // NEW
    index: stateImage.index // NEW
  });
});
```

#### Python Code Generator Update
```typescript
// Around line 308-314
if (state.stateRegions.length > 0) {
  lines.push('# StateRegions');
  state.stateRegions.forEach(region => {
    const params = [
      `"${region.name}"`,
      `${region.x}`,
      `${region.y}`,
      `${region.width}`,
      `${region.height}`
    ];

    // Add optional parameters
    if (region.isSearchRegion) params.push('is_search_region=True');
    if (region.referenceImageId) params.push(`reference_image_id="${region.referenceImageId}"`);
    if (region.offsetX) params.push(`offset_x=${region.offsetX}`);
    if (region.offsetY) params.push(`offset_y=${region.offsetY}`);
    if (region.position) {
      params.push(`position_name="${region.position.positionName || 'TOPLEFT'}"`);
    }

    lines.push(`state.add_state_region(StateRegion(${params.join(', ')}))`);
  });
  lines.push('');
}
```

### 6. Config Exporter (config-exporter.ts)

This file may need updates if it handles StateRegion/StateImage exports. Check the implementation and update similarly to state-exporter.ts.

## Design Decisions

### 1. Relative Positioning
- Same approach as StateLocation for consistency
- `referenceImageId` links to a StateImage
- When set, position is relative to matched image location
- When not set, position is absolute (screen coordinates)
- 9 standard positions: TOPLEFT through BOTTOMRIGHT
- Offsets allow fine-tuning

### 2. SearchRegion System
- Boolean flag `isSearchRegion` on StateRegion
- StateImage has `searchRegionIds` array pointing to StateRegion IDs
- Bidirectional visualization in UI
- Legacy `searchRegions` array preserved for backward compatibility

### 3. Visual Design
- Purple theme (#BD00FF) for StateRegions/SearchRegions
- Color scheme: Images=#00D9FF, Regions=#BD00FF, Locations=#00FF88, Strings=#FFD700
- SearchRegions have purple-tinted background and border
- Clear visual indicators for absolute vs relative mode

### 4. Backward Compatibility
- All new fields are optional
- Existing StateRegions work without changes
- Legacy searchRegions array preserved
- Default values provided for new fields

## Implementation Files

### Completed ✓
1. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/contexts/automation-context/types.ts`
2. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/export-schema.ts`

### Pending
3. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/state-properties-panel.tsx`
   - Regions Tab: Use code from `/tmp/regions-tab-content.tsx`
   - Images Tab: Add SearchRegion selector (code provided in implementation doc)

4. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/state-machine.tsx`
   - Update `addRegion` function with default values

5. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/state-exporter.ts`
   - Update interfaces and export logic
   - Update Python code generator

6. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/config-exporter.ts`
   - Check and update if needed

## Testing Checklist

- [ ] Create StateRegion with absolute positioning
- [ ] Create StateRegion with relative positioning to StateImage
- [ ] Mark StateRegion as SearchRegion
- [ ] Link StateImage to use StateRegion as search region
- [ ] Verify bidirectional link display works
- [ ] Export state and check JSON structure
- [ ] Export to Python and verify syntax
- [ ] Test all 9 position options
- [ ] Test offset values
- [ ] Verify color-coding (purple for SearchRegions)
- [ ] Test backward compatibility with existing states

## Code Locations

### Complete UI Code for Regions Tab
`/tmp/regions-tab-content.tsx` contains the full implementation

### Implementation Documentation
`/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/STATEREGION_RELATIVE_POSITIONING_IMPLEMENTATION.md`

## Next Steps

1. **Apply UI changes to state-properties-panel.tsx**
   - Replace Regions Tab with code from `/tmp/regions-tab-content.tsx`
   - Add SearchRegion selector to Images Tab

2. **Update state-machine.tsx**
   - Modify `addRegion` function

3. **Update state-exporter.ts**
   - Update interfaces
   - Update export logic
   - Update Python generator

4. **Test thoroughly**
   - Create test cases for all features
   - Verify exports work correctly

5. **Consider config-exporter.ts**
   - Review and update if needed
