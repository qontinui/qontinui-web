# StateRegion Relative Positioning Implementation

## Summary

This document describes the implementation of relative positioning for StateRegion, similar to how StateLocation works. It also implements bidirectional linking between StateRegions (as SearchRegions) and StateImages.

## Changes Completed

### 1. TypeScript Types Updated

**File: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/contexts/automation-context/types.ts`**

#### StateRegion Interface
Added the following fields to `StateRegion`:

```typescript
export interface StateRegion {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number

  // NEW: Relative positioning (similar to StateLocation)
  referenceImageId?: string   // ID of StateImage for relative positioning
  position?: Position         // Position within referenced image region
  offsetX?: number            // X offset in pixels (default 0)
  offsetY?: number            // Y offset in pixels (default 0)

  // NEW: SearchRegion flag
  isSearchRegion?: boolean    // If true, this region can be used as a search region for StateImages

  actionHistory?: ActionHistory
}
```

#### StateImage Interface
Added the following field to `StateImage`:

```typescript
export interface StateImage {
  id: string
  name: string
  image: string
  mask?: string
  searchRegions?: SearchRegion[] // Legacy: inline search regions
  searchRegionIds?: string[] // NEW: IDs of StateRegions used as search regions
  fixed?: boolean
  actionHistory?: ActionHistory
  source?: 'upload' | 'pattern-optimization'
  similarity?: number
  probability?: number
  index?: number
}
```

## Changes Needed (UI Implementation)

### 2. StateRegion Panel UI (state-properties-panel.tsx)

**Location: Regions Tab, lines ~400-478**

Replace the existing Regions Tab content with the enhanced version that includes:

1. **Visual Indication of SearchRegions**
   - Change background color when `isSearchRegion` is true
   - Purple theme (#BD00FF) for SearchRegion highlighting

2. **SearchRegion Checkbox**
   ```tsx
   <Checkbox
     id={`region-search-${region.id}`}
     checked={region.isSearchRegion || false}
     onCheckedChange={(checked) => updateRegion(index, "isSearchRegion", checked as boolean)}
   />
   <Label>SearchRegion (can be used by StateImages)</Label>
   ```

3. **Bidirectional Link Display**
   - Show which StateImages use this region as a search region
   - Display: "Used by: [StateImage names]"

4. **Reference Image Dropdown** (similar to StateLocation)
   ```tsx
   <select value={region.referenceImageId || ""}>
     <option value="">None (absolute positioning)</option>
     {state.stateImages.map(img => (
       <option key={img.id} value={img.id}>{img.name}</option>
     ))}
   </select>
   ```

5. **Position Selector** (when referenceImageId is set)
   - 9 standard positions (TOPLEFT, TOPMIDDLE, TOPRIGHT, etc.)
   - Same implementation as StateLocation

6. **Offset Fields** (when referenceImageId is set)
   - Offset X and Offset Y number inputs
   - Default to 0

### 3. StateImage Panel UI (state-properties-panel.tsx)

**Location: Images Tab, after advanced properties section**

Add a new section for SearchRegion selection:

```tsx
{/* Search Regions Selector */}
{state.regions && state.regions.filter(r => r.isSearchRegion).length > 0 && (
  <div className="space-y-1">
    <Label className="text-xs text-gray-300">Search Regions</Label>
    <div className="space-y-1">
      {state.regions.filter(r => r.isSearchRegion).map(region => (
        <div key={region.id} className="flex items-center space-x-2">
          <Checkbox
            id={`searchregion-${stateImage.id}-${region.id}`}
            checked={stateImage.searchRegionIds?.includes(region.id) || false}
            onCheckedChange={(checked) => {
              const currentIds = stateImage.searchRegionIds || []
              const newIds = checked
                ? [...currentIds, region.id]
                : currentIds.filter(id => id !== region.id)
              updateStateImage(index, { searchRegionIds: newIds })
            }}
          />
          <Label className="text-xs text-gray-300">{region.name}</Label>
        </div>
      ))}
    </div>
  </div>
)}
```

### 4. Export Logic Updates

#### state-exporter.ts

**File: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/state-exporter.ts`**

Update `QontinuiStateRegion` interface:

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
  position?: {  // NEW
    percentW: number;
    percentH: number;
    positionName?: string;
  };
}
```

Update the export logic (around line 148-160):

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
      isSearchRegion: region.isSearchRegion,
      referenceImageId: region.referenceImageId,
      offsetX: region.offsetX ?? 0,
      offsetY: region.offsetY ?? 0,
      position: region.position
    });
  });
}
```

Update `QontinuiStateImage` interface:

```typescript
interface QontinuiStateImage {
  id: string;
  name: string;
  imagePath?: string;
  imageData?: string;
  searchRegions: QontinuiSearchRegion[];
  searchRegionIds?: string[]; // NEW
  fixed: boolean;
  similarity?: number;  // NEW (may already exist)
  probability?: number; // NEW (may already exist)
  index?: number;       // NEW (may already exist)
}
```

Update StateImage export logic (around line 96-113):

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
    similarity: stateImage.similarity,   // NEW
    probability: stateImage.probability, // NEW
    index: stateImage.index              // NEW
  });
});
```

Update Python code generator (around line 308-314):

```python
# Add StateRegions
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

#### config-exporter.ts

**File: Search for config-exporter.ts**

Similar updates needed if this file handles StateRegion/StateImage exports.

### 5. State Machine (Default Values)

**File: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/state-machine.tsx`**

Update `addRegion` function (around line 457-472):

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
    // NEW: Initialize defaults for optional fields
    isSearchRegion: false,
    offsetX: 0,
    offsetY: 0
  }
  updateSelectedState({ regions: [...regions, newRegion] })
}
```

## Design Decisions

### 1. **Relative Positioning System**
- Used the same approach as StateLocation for consistency
- When `referenceImageId` is set, position is calculated relative to the matched image
- When `referenceImageId` is not set, position is absolute (screen coordinates)

### 2. **SearchRegion Flag**
- Used a boolean flag `isSearchRegion` instead of a separate array
- Simpler to implement and understand
- StateRegions can serve dual purposes (regular region AND search region)

### 3. **Bidirectional Linking**
- StateImage has `searchRegionIds` (array of StateRegion IDs)
- StateRegion has `isSearchRegion` flag
- UI shows both directions: "which regions this image uses" and "which images use this region"

### 4. **Visual Design**
- Purple theme (#BD00FF) for StateRegions and SearchRegions
- Consistent with the color scheme (Images=#00D9FF, Locations=#00FF88, Strings=#FFD700)
- SearchRegions have purple-tinted background when flag is checked

### 5. **Backward Compatibility**
- All new fields are optional
- Existing StateRegions will work without changes
- Legacy `searchRegions` array in StateImage is preserved
- New `searchRegionIds` is the preferred approach going forward

## Testing Checklist

- [ ] Create a StateRegion with absolute positioning
- [ ] Create a StateRegion with relative positioning to a StateImage
- [ ] Mark a StateRegion as a SearchRegion
- [ ] Link a StateImage to use a StateRegion as its search region
- [ ] Verify bidirectional link display (region shows which images use it, image shows which regions it uses)
- [ ] Export state and verify JSON structure
- [ ] Export to Python code and verify syntax
- [ ] Verify offset values are applied correctly
- [ ] Test all 9 position options
- [ ] Verify color-coding works (purple for SearchRegions)

## Implementation Files

### Modified Files
1. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/contexts/automation-context/types.ts` ✓ COMPLETED
2. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/state-properties-panel.tsx` (Regions Tab + Images Tab)
3. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/state-machine.tsx` (addRegion function)
4. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/state-exporter.ts`
5. `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/lib/config-exporter.ts` (if exists)

### UI Component Location
The detailed UI code for the Regions Tab is available in:
`/tmp/regions-tab-content.tsx`

This file contains the complete implementation of the Regions Tab with all features:
- SearchRegion checkbox
- Bidirectional link display
- Reference image dropdown
- Position selector (9 positions)
- Offset inputs
- Visual color-coding

## Next Steps

1. Copy the content from `/tmp/regions-tab-content.tsx` to replace the Regions Tab in `state-properties-panel.tsx`
2. Add SearchRegion selector to Images Tab
3. Update state-machine.tsx addRegion function
4. Update state-exporter.ts export interfaces and logic
5. Update config-exporter.ts if it exists
6. Test all functionality
