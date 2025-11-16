# Workflow Schema Reference

## Complete Workflow Schema

### Top-Level Workflow Object

```json
{
  "id": "workflow_123",
  "name": "My Workflow",
  "version": "1.0.0",
  "format": "graph",
  "actions": [...],
  "connections": {...},
  "visibility": "public",
  "variables": {...},
  "settings": {...},
  "metadata": {...},
  "category": "automation",
  "tags": ["tag1", "tag2"]
}
```

### Required Fields
- `id` (string): Unique workflow identifier
- `name` (string): Human-readable workflow name
- `version` (string): Workflow version (e.g., "1.0.0")
- `format` (string): Must be "graph"
- `actions` (array): List of action objects
- `connections` (object): Nested dict structure for connections

### Optional Fields
- `visibility` (string): "public", "internal", or "system" (default: "public")
- `variables` (object): Multi-scope variables
- `settings` (object): Workflow-level execution settings
- `metadata` (object): Author, description, timestamps
- `category` (string): Category for organizing workflows
- `tags` (array): List of tags for categorization

## Action Schema

```json
{
  "id": "action_123",
  "type": "FIND",
  "name": "Find login button",
  "config": {
    "target": {
      "type": "image",
      "imageId": "img_123"
    },
    "searchOptions": {
      "threshold": 0.9
    }
  },
  "base": {
    "enabled": true,
    "notes": "Optional notes"
  },
  "execution": {
    "timeout": 5000,
    "retryCount": 3,
    "continueOnError": false
  },
  "position": [100, 200]
}
```

### Action Required Fields
- `id` (string): Unique action identifier
- `type` (string): Action type (FIND, CLICK, TYPE, etc.)
- `config` (object): Action-specific configuration

### Action Optional Fields
- `name` (string): Human-readable action name
- `base` (object): Base settings (enabled, notes)
- `execution` (object): Execution settings (timeout, retryCount, continueOnError)
- `position` (array): [x, y] coordinates for graph layout

## Connections Schema

Connections use a nested dictionary structure:

```json
{
  "connections": {
    "action1": {
      "main": [
        [
          {
            "action": "action2",
            "type": "main",
            "index": 0
          }
        ]
      ],
      "error": [
        [
          {
            "action": "action3",
            "type": "error",
            "index": 0
          }
        ]
      ]
    },
    "action2": {
      "main": [
        [
          {
            "action": "action4",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  }
}
```

### Connection Structure
- **Level 1 (Source)**: `dict[source_action_id, ...]`
- **Level 2 (Type)**: `dict[connection_type, ...]`
- **Level 3 (List)**: `list[list[Connection]]`
- **Level 4 (Connection)**: List of Connection objects

### Connection Types
- `main`: Normal execution flow
- `error`: Error handling flow
- `success`: Success-specific flow
- `true`/`false`: Conditional branches (IF action)
- `case_N`: Switch case branches

### Connection Object
```json
{
  "action": "target_action_id",
  "type": "main",
  "index": 0
}
```

## Variables Schema

```json
{
  "variables": {
    "local": {
      "counter": 0,
      "result": null
    },
    "process": {
      "session_id": "abc123"
    },
    "global": {
      "api_key": "secret"
    }
  }
}
```

### Variable Scopes
- `local`: Scoped to current workflow execution
- `process`: Shared across process executions
- `global`: Shared globally across all workflows

## Workflow Settings Schema

```json
{
  "settings": {
    "timeout": 30000,
    "retryCount": 3,
    "continueOnError": false,
    "parallelExecution": false,
    "maxParallelActions": 1
  }
}
```

### Settings Fields (All Optional)
- `timeout` (number): Workflow timeout in milliseconds
- `retryCount` (number): Number of retry attempts
- `continueOnError` (boolean): Continue on action failure
- `parallelExecution` (boolean): Enable parallel execution
- `maxParallelActions` (number): Max actions to run in parallel

## Workflow Metadata Schema

```json
{
  "metadata": {
    "created": "2025-01-01T00:00:00Z",
    "updated": "2025-01-15T12:30:00Z",
    "author": "username",
    "description": "This workflow automates login process",
    "version": "1.0.0"
  }
}
```

### Metadata Fields (All Optional)
- `created` (string): ISO 8601 timestamp
- `updated` (string): ISO 8601 timestamp
- `author` (string): Author username
- `description` (string): Workflow description
- `version` (string): Metadata version (separate from workflow version)

## Complete Configuration Export Schema

```json
{
  "version": "1.0.0",
  "metadata": {
    "name": "Project Name",
    "description": "Project description",
    "author": "username",
    "created": "2025-01-01T00:00:00Z",
    "modified": "2025-01-15T12:30:00Z",
    "tags": ["automation", "testing"],
    "targetApplication": "My App"
  },
  "images": [
    {
      "id": "img_123",
      "name": "login_button.png",
      "data": "base64_encoded_data",
      "format": "png",
      "width": 100,
      "height": 50,
      "hash": "sha256_hash"
    }
  ],
  "workflows": [
    {
      "id": "workflow_123",
      "name": "Login Workflow",
      "version": "1.0.0",
      "format": "graph",
      "actions": [...],
      "connections": {...}
    }
  ],
  "states": [...],
  "transitions": [...],
  "categories": ["main", "automation"],
  "settings": {
    "execution": {
      "defaultTimeout": 10000,
      "defaultRetryCount": 3,
      "actionDelay": 100,
      "failureStrategy": "stop"
    },
    "recognition": {
      "defaultThreshold": 0.9,
      "searchAlgorithm": "template_matching",
      "multiScaleSearch": true,
      "colorSpace": "rgb"
    },
    "logging": {
      "level": "info",
      "screenshotOnError": true,
      "consoleOutput": true
    },
    "performance": {
      "maxParallelActions": 1,
      "cacheImages": true,
      "optimizeSearch": true
    }
  }
}
```

## Field Naming Convention

All field names use **camelCase** for JSON export:
- ✅ `retryCount`, `continueOnError`, `maxParallelActions`
- ❌ `retry_count`, `continue_on_error`, `max_parallel_actions`

## Common Action Config Examples

### FIND Action
```json
{
  "type": "FIND",
  "config": {
    "target": {
      "type": "image",
      "imageId": "img_123"
    },
    "searchOptions": {
      "threshold": 0.9,
      "region": null
    }
  }
}
```

### CLICK Action
```json
{
  "type": "CLICK",
  "config": {
    "target": {
      "type": "image",
      "imageId": "img_123"
    },
    "button": "left",
    "clicks": 1
  }
}
```

### TYPE Action
```json
{
  "type": "TYPE",
  "config": {
    "text": "Hello World",
    "interval": 0.01
  }
}
```

### IF Action (Control Flow)
```json
{
  "type": "IF",
  "config": {
    "condition": {
      "type": "variable",
      "variable": "counter",
      "operator": ">",
      "value": 5
    }
  }
}
```

### SET_VARIABLE Action
```json
{
  "type": "SET_VARIABLE",
  "config": {
    "variable": "result",
    "value": 42,
    "scope": "local"
  }
}
```

## Validation Rules

### Workflow Validation
1. `format` must be "graph"
2. `connections` must be a nested dict structure
3. All actions must have valid `position` for graph format
4. `id`, `name`, `version` are required

### Connection Validation
1. Source action IDs must exist in actions list
2. Target action IDs must exist in actions list
3. Connection structure must be: `dict[str, dict[str, list[list[Connection]]]]`

### Action Validation
1. `type` must be a known action type
2. `config` must match the action type's schema
3. Image references must exist in images list
4. Position must be `[x, y]` for graph format

## Migration from Old Format

### Old Format (Processes)
```json
{
  "processes": [
    {
      "id": "proc_123",
      "type": "sequence",
      "actions": [...]
    }
  ]
}
```

### New Format (Workflows)
```json
{
  "workflows": [
    {
      "id": "proc_123",
      "format": "graph",
      "version": "1.0.0",
      "actions": [...],
      "connections": {}
    }
  ]
}
```

### Key Changes
1. `processes` → `workflows`
2. `type: "sequence"` → `format: "graph"`
3. Added required `version` field
4. Added required `connections` field
5. Actions must have `position` field
