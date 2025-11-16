# Workflow Export Fix - Implementation Summary

## Overview
Fixed JSON export in qontinui-web to ensure workflows are exported with the correct Pydantic schema format matching the qontinui library requirements.

## Changes Made

### 1. Updated Export Schema (`app/schemas/export.py`)

#### Renamed Process to Workflow
- Changed `Process` class to `Workflow` class
- Updated to match qontinui library's Workflow Pydantic schema exactly

#### New Workflow Schema Structure
```python
class Workflow(BaseModel):
    id: str
    name: str
    version: str
    format: str = "graph"  # Always "graph"
    actions: list[Action]
    connections: dict[str, dict[str, list[list[Connection]]]]
    visibility: str | None = "public"
    variables: Variables | None = None
    settings: WorkflowSettings | None = None
    metadata: WorkflowMetadata | None = None
    category: str | None = None  # For organizing workflows
    tags: list[str] | None = None
```

#### Updated Action Schema
- Changed from simple `ActionConfig` to flexible dict-based config
- Added `BaseActionSettings` and `ExecutionSettings` classes
- Updated `Action` to include:
  - `config: dict[str, Any]` (flexible for all action types)
  - `base: BaseActionSettings | None`
  - `execution: ExecutionSettings | None`
  - `position: tuple[int, int] | None` (required for graph format)

#### Added Supporting Classes
- `Connection`: For graph connections between actions
- `Variables`: Multi-scope variables (local, process, global)
- `WorkflowSettings`: Workflow-level execution settings
- `WorkflowMetadata`: Author, description, timestamps

#### Updated ConfigurationExport
- Changed field from `processes` to `workflows`
- Updated comment: "List of workflow categories" (was "process categories")

### 2. Updated Export/Import Service (`app/services/export_import.py`)

#### Updated Default Configuration
- Changed `"processes": []` to `"workflows": []`

#### Updated Merge Logic
- Renamed all "process" references to "workflow" in merge method:
  - `existing_processes` → `existing_workflows`
  - `new_process` → `new_workflow`
  - `merged["processes"]` → `merged["workflows"]`

#### Added Workflow Schema Validation (`_ensure_workflow_schema`)
New method that ensures all workflows match the Pydantic schema:

1. **Format Field**: Ensures `format: "graph"` is always set
2. **Version Field**: Adds version if missing (defaults to "1.0.0")
3. **Connections Structure**:
   - Ensures connections field exists and is a dict
   - Validates nested structure: `dict[str, dict[str, list[list[Connection]]]]`
   - Fixes invalid structures by resetting to empty dict
4. **Actions List**: Ensures actions is a list
5. **Action Positions**: Ensures all actions have valid positions for graph format

#### Updated Action Config Transformation
- Already correctly references "workflows" instead of "processes"
- Transforms FIND/VANISH/EXISTS actions to new format with target structure

### 3. Updated Validator (`app/services/json_validator.py`)

#### Renamed All Process References to Workflow
- Changed validation loop from `config.processes` to `config.workflows`
- Updated error messages:
  - "Duplicate process ID" → "Duplicate workflow ID"
  - "Transition references non-existent process" → "Transition references non-existent workflow"
  - "Orphaned processes" → "Orphaned workflows"

#### Added Workflow-Specific Validations
1. **Format Validation**: Ensures workflow format is "graph"
2. **Connections Structure Validation**:
   - Validates connections is a dict
   - Validates nested structure (source → type → list)
3. **Action Type Validation**: Changed from error to warning for unknown types
4. **Image Reference Validation**: Updated to work with dict-based config

## Key Features

### Format Enforcement
- All workflows are forced to use `format: "graph"`
- No backward compatibility for sequential format

### Connections Structure
- Enforces correct nested dict structure: `dict[source_id, dict[connection_type, list[list[Connection]]]]`
- Example:
  ```json
  {
    "action1": {
      "main": [[{"action": "action2", "type": "main", "index": 0}]],
      "error": [[{"action": "action3", "type": "error", "index": 0}]]
    }
  }
  ```

### Field Name Consistency
- Uses camelCase for all field names (matching JSON convention)
- Examples: `retryCount`, `continueOnError`, `maxParallelActions`

### Action Config Flexibility
- `config` field is `dict[str, Any]` to support all action types
- Transformation method handles legacy imageId format

### Required Fields
All workflows exported will have:
- `id`: Unique identifier
- `name`: Human-readable name
- `version`: Workflow version
- `format`: Always "graph"
- `actions`: List of actions
- `connections`: Nested dict structure

## Files Modified

1. `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/schemas/export.py`
   - Complete rewrite of Process → Workflow schema
   - Added Connection, Variables, WorkflowSettings, WorkflowMetadata classes
   - Updated ConfigurationExport to use "workflows"

2. `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/services/export_import.py`
   - Updated merge logic to use "workflows"
   - Added `_ensure_workflow_schema()` method
   - Updated default configuration

3. `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui-web/backend/app/services/json_validator.py`
   - Renamed all process references to workflow
   - Added workflow format validation
   - Added connections structure validation

## Testing Recommendations

1. **Export Test**: Export a project and verify:
   - Field name is "workflows" (not "processes")
   - Each workflow has `format: "graph"`
   - Connections are in correct nested dict structure
   - All required fields are present

2. **Import Test**: Import a configuration and verify:
   - Legacy "processes" field is rejected (no backward compatibility)
   - Invalid connection structures are fixed
   - Missing format/version fields are added

3. **Validation Test**: Test validation endpoint with:
   - Valid workflow configurations
   - Invalid format values (should error)
   - Invalid connection structures (should error)
   - Missing required fields (should error)

## Migration Notes

**BREAKING CHANGE**: This update removes all backward compatibility for:
- "processes" terminology (now "workflows")
- Sequential workflow format (now only "graph")
- Old connection formats (now enforces nested dict structure)

Any existing configurations using the old format will need to be migrated. The import service will attempt to fix some issues automatically (like adding format/version fields), but cannot migrate from "processes" to "workflows" automatically.

## Alignment with qontinui Library

This implementation now matches the qontinui library's Workflow schema exactly:
- Same field names (id, name, version, format, actions, connections)
- Same field types (Connections as nested dict, Actions as list)
- Same required/optional field structure
- Same nested models (Variables, WorkflowSettings, WorkflowMetadata)

Reference: `/mnt/c/Users/jspin/Documents/qontinui_parent/qontinui/src/qontinui/config/models/workflow.py`
