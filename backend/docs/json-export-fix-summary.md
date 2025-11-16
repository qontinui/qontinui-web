# JSON Export Fix: FIND Action Schema Transformation

## Problem

The qontinui-web backend was exporting FIND actions with an invalid schema format that didn't match the Pydantic models used by the qontinui runner library.

**Old Format (Invalid):**
```json
{
  "type": "FIND",
  "config": {
    "imageId": "img_123",
    "searchOptions": {
      "threshold": 0.9
    }
  }
}
```

**Required Format (Valid):**
```json
{
  "type": "FIND",
  "config": {
    "target": {
      "type": "image",
      "imageId": "img_123"
    },
    "searchOptions": {
      "threshold": 0.9
    }
  }
}
```

## Root Cause

The FindActionConfig Pydantic schema requires a `target` field containing a TargetConfig discriminated union with 6 types:
- image
- text
- region
- coordinates
- stateString
- currentPosition

For image-based finding, the target must be: `{"type": "image", "imageId": "img_xxx"}`

The old database/frontend was storing actions with `imageId` directly at the config level instead of nested in a `target` object.

## Solution

Added transformation logic in the export service to automatically convert action configs from the old format to the new format during export.

### Files Modified

#### 1. `/backend/app/services/export_import.py`

Added three new methods:

**`_transform_action_configs(config: dict[str, Any])`**
- Called during export before validation
- Iterates through all workflows and inline workflows
- Transforms FIND, VANISH, and EXISTS actions

**`_transform_find_action_config(config: dict[str, Any])`**
- Handles the actual transformation
- Converts `{"imageId": "..."}` to `{"target": {"type": "image", "imageId": "..."}}`
- Preserves other fields like `searchOptions`
- Idempotent - safe to run multiple times
- Handles edge cases (missing type field, already-transformed configs)

**`_ensure_workflow_schema(config: dict[str, Any])`**
- Already existed in the modified file
- Ensures workflows have correct format and connections structure

### Key Features

1. **Automatic Transformation**: Runs during every export
2. **Idempotent**: Can run multiple times without breaking already-correct configs
3. **Preserves Other Fields**: searchOptions and other config fields are maintained
4. **Handles Edge Cases**:
   - Old format with imageId at top level
   - Target exists but missing type field
   - Already-transformed configs
5. **Affects Multiple Locations**:
   - Regular workflow actions
   - Inline workflow actions in transitions

## Action Types Affected

- **FIND**: Find an image on screen
- **VANISH**: Wait for an image to disappear
- **EXISTS**: Check if an image exists

**Note**: FIND_STATE_IMAGE is NOT transformed because it has a different schema structure where `imageId` remains at the top level.

## Testing

Created two test files to verify the transformation:

### Test File 1: `test_action_transformation.py`
- Tests with full service import (requires dependencies)
- Comprehensive integration test

### Test File 2: `test_action_transformation_standalone.py`
- Standalone test that doesn't require service dependencies
- Tests transformation logic directly
- All tests passing ✓

### Test Cases

1. ✓ Transform old format FIND action
2. ✓ Transform old format VANISH action
3. ✓ Preserve CLICK action unchanged
4. ✓ Transform inline workflow FIND actions
5. ✓ Handle already-transformed actions (idempotent)
6. ✓ Add missing type field to existing targets

## Example Transformation

### Before Export
```json
{
  "workflows": [
    {
      "id": "workflow_1",
      "actions": [
        {
          "id": "action_1",
          "type": "FIND",
          "config": {
            "imageId": "img_button",
            "searchOptions": {
              "threshold": 0.9
            }
          }
        }
      ]
    }
  ]
}
```

### After Export (Automatic)
```json
{
  "workflows": [
    {
      "id": "workflow_1",
      "actions": [
        {
          "id": "action_1",
          "type": "FIND",
          "config": {
            "target": {
              "type": "image",
              "imageId": "img_button"
            },
            "searchOptions": {
              "threshold": 0.9
            }
          }
        }
      ]
    }
  ]
}
```

## Validation

The transformation runs BEFORE validation, ensuring that:
1. Exported configs always match the Pydantic schema
2. Validation errors are caught with corrected format
3. Runner library can parse the exported JSON without errors

## Backward Compatibility

**This fix does NOT maintain backward compatibility with the old format.**

As per project guidelines in CLAUDE.md:
> "This project is in active development. Backward compatibility is NOT a priority."

The transformation only works one way: old → new. The runner library expects the new format only.

## Future Considerations

### Frontend Updates Needed

The frontend should also be updated to:
1. Store actions in the new format in the database
2. Generate the new format when creating actions
3. Update any action creation/editing UI to use the target structure

This will eliminate the need for transformation at export time.

### Migration Script

Consider creating a migration script to update all existing projects in the database to use the new format, which would:
1. Load each project configuration
2. Apply the transformation
3. Save back to database

This would make the transformation at export time unnecessary in the future.

## Impact

- ✅ Exported JSON now matches qontinui runner Pydantic schemas
- ✅ FIND/VANISH/EXISTS actions work correctly
- ✅ No breaking changes to export API
- ✅ Validation passes after transformation
- ✅ Runner library can parse exported configs
- ✅ Transformation is automatic and transparent

## References

- Frontend FindActionConfig: `/frontend/src/lib/action-schema/configs/find-actions.ts`
- Backend Export Service: `/backend/app/services/export_import.py`
- Backend Export Schema: `/backend/app/schemas/export.py`
- Test Files:
  - `/backend/test_action_transformation.py`
  - `/backend/test_action_transformation_standalone.py`
