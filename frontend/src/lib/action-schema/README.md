## Qontinui Action Schema v2

A flexible, type-safe action configuration system that makes it easy to add new action types without breaking existing code.

## Key Features

- **Type Safety**: TypeScript ensures configurations match action types at compile time
- **Modularity**: Each action type has its own dedicated configuration interface
- **Extensibility**: Adding new actions requires minimal changes to core code
- **Clean JSON**: Only relevant properties are included in exported configs
- **Composability**: Actions can be nested and composed
- **Self-Documenting**: Types serve as documentation

## Architecture

### File Structure

```
action-schema/
├── index.ts                     # Main exports
├── action-types.ts              # Core action type system
├── shared/                      # Shared configuration modules
│   ├── common-types.ts         # Basic types (Region, Coordinates, etc.)
│   ├── target-config.ts        # Target system (image, region, text, etc.)
│   ├── search-options.ts       # Search configuration
│   ├── verification-config.ts  # Result verification
│   └── timing-config.ts        # Base settings, execution, logging
├── configs/                     # Action-specific configurations
│   ├── find-actions.ts         # FIND, VANISH, WAIT, EXISTS
│   ├── mouse-actions.ts        # CLICK, DRAG, SCROLL, etc.
│   ├── keyboard-actions.ts     # TYPE, KEY_PRESS, etc.
│   ├── control-flow-actions.ts # IF, LOOP, BREAK, TRY_CATCH, etc.
│   ├── data-actions.ts         # SORT, FILTER, MAP, SET_VARIABLE, etc.
│   └── state-actions.ts        # GO_TO_STATE, RUN_PROCESS, etc.
├── examples.ts                  # Usage examples
└── README.md                    # This file
```

### Core Types

```typescript
// Base action structure
interface Action<T extends ActionType> {
  id: string;
  type: T;
  name?: string;
  config: ActionConfigMap[T];  // Type-safe config
  base?: BaseActionSettings;
  execution?: ExecutionSettings;
}

// Type-safe configuration mapping
interface ActionConfigMap {
  CLICK: ClickActionConfig;
  TYPE: TypeActionConfig;
  LOOP: LoopActionConfig;
  SORT: SortActionConfig;
  // ... all other action types
}
```

## Usage

### Creating Actions

```typescript
import { createAction } from './action-schema';

// Create a CLICK action
const clickAction = createAction('CLICK', {
  target: {
    type: 'image',
    imageId: 'submit-button',
    searchOptions: {
      similarity: 0.8,
      timeout: 5000,
    },
  },
  numberOfClicks: 1,
  mouseButton: 'LEFT',
}, {
  name: 'Click submit',
  base: {
    pauseBeforeBegin: 100,
  },
  execution: {
    timeout: 10000,
    retryCount: 2,
  },
});
```

### Type Safety

TypeScript enforces valid configurations:

```typescript
// ✅ Valid - config matches action type
const valid = createAction('CLICK', {
  target: { type: 'image', imageId: 'btn' },
  numberOfClicks: 1,
});

// ❌ Compile error - TYPE doesn't have 'numberOfClicks'
const invalid = createAction('TYPE', {
  numberOfClicks: 2, // TypeScript error!
});
```

### Type Guards

```typescript
import { isActionOfType } from './action-schema';

if (isActionOfType(action, 'CLICK')) {
  // action.config is now typed as ClickActionConfig
  console.log(action.config.numberOfClicks);
}
```

## Action Categories

### Find Actions
- `FIND` - Search for a target
- `FIND_STATE_IMAGE` - Find state-specific image
- `VANISH` - Wait for target to disappear
- `EXISTS` - Check existence without waiting
- `WAIT` - Wait for condition or time

### Mouse Actions
- `CLICK`, `DOUBLE_CLICK`, `RIGHT_CLICK`
- `MOUSE_MOVE`, `MOUSE_DOWN`, `MOUSE_UP`
- `DRAG` - Drag from source to destination
- `SCROLL` - Scroll in a direction

### Keyboard Actions
- `TYPE` - Type text
- `KEY_PRESS` - Press and release key
- `KEY_DOWN`, `KEY_UP` - Low-level key control
- `HOTKEY` - Press key combination

### Control Flow Actions (NEW)
- `IF` - Conditional execution
- `LOOP` - FOR, WHILE, FOREACH loops
- `BREAK` - Exit loop early
- `CONTINUE` - Skip to next iteration
- `SWITCH` - Multi-way conditional
- `TRY_CATCH` - Error handling

### Data Actions (NEW)
- `SET_VARIABLE`, `GET_VARIABLE` - Variable management
- `SORT` - Sort collections
- `FILTER` - Filter arrays
- `MAP` - Transform arrays
- `REDUCE` - Reduce to single value
- `STRING_OPERATION` - String manipulation
- `MATH_OPERATION` - Mathematical calculations

### State Actions
- `GO_TO_STATE` - Navigate to state
- `RUN_PROCESS` - Execute process
- `SCREENSHOT` - Capture screen

## Adding a New Action Type

### 1. Create Configuration Interface

```typescript
// In configs/my-actions.ts
export interface MyNewActionConfig {
  requiredProperty: string;
  optionalProperty?: number;
}
```

### 2. Add to Action Type Union

```typescript
// In action-types.ts
export type MyActionCategory = 'MY_NEW_ACTION' | 'ANOTHER_ACTION';

export type ActionType =
  | FindActionType
  | MouseActionType
  | MyActionCategory  // Add here
  // ...
```

### 3. Add to Configuration Map

```typescript
// In action-types.ts
interface ActionConfigMap {
  // ... existing mappings
  MY_NEW_ACTION: MyNewActionConfig;
}
```

### 4. Export from Index

```typescript
// In index.ts
export * from './configs/my-actions';
```

### That's it!

The new action is now fully integrated with type safety and validation.

## Shared Configuration Modules

### Target Configuration

```typescript
type TargetConfig =
  | ImageTarget
  | RegionTarget
  | TextTarget
  | CoordinatesTarget
  | StateStringTarget;
```

Used by actions that need to locate something on screen.

### Search Options

```typescript
interface SearchOptions {
  similarity?: number;
  timeout?: number;
  searchRegions?: Region[];
  strategy?: SearchStrategy;
  polling?: PollingConfig;
  pattern?: PatternOptions;
  adjustment?: MatchAdjustment;
}
```

Used by actions that search for targets.

### Verification

```typescript
interface VerificationConfig {
  mode: VerificationMode;
  target?: TargetConfig;
  timeout?: number;
  continueOnFailure?: boolean;
}
```

Used to verify action results.

## Benefits

### For Developers

- **Autocomplete**: IDE suggests only valid properties
- **Error Detection**: Compile-time errors for invalid configs
- **Documentation**: Types serve as API documentation
- **Refactoring**: Safe to modify individual action configs

### For Users

- **Validation**: Clear error messages
- **Flexibility**: Easy to add custom actions
- **Performance**: Smaller JSON payloads

### For Maintainers

- **Modularity**: Actions are isolated
- **Extensibility**: New actions don't affect existing ones
- **Clarity**: Self-documenting code

## JSON Format Comparison

### Old Format
```json
{
  "id": "action-123",
  "type": "CLICK",
  "config": {
    "target": {...},
    "numberOfClicks": 1,
    "typeDelay": 50,        // ❌ Not relevant
    "dragDuration": 500,    // ❌ Not relevant
    // ... 90+ more irrelevant properties
  }
}
```

### New Format
```json
{
  "id": "action-123",
  "type": "CLICK",
  "config": {
    "target": {...},
    "numberOfClicks": 1
  },
  "base": {...},
  "execution": {...}
}
```

**Result**: 40-60% smaller JSON files with cleaner structure.

## Migration Guide

Since we're not maintaining backward compatibility:

1. Import the new schema: `import { Action, createAction } from './action-schema'`
2. Use typed action creation: `createAction('CLICK', {...})`
3. Update exports to use the new format
4. Regenerate all JSON configurations

## Examples

See `examples.ts` for comprehensive usage examples including:
- Basic actions (CLICK, TYPE, FIND)
- Control flow (IF, LOOP, TRY_CATCH)
- Data operations (SORT, FILTER, MAP)
- Complex scenarios

## Future Enhancements

Possible future additions:
- `PARALLEL` - Execute actions in parallel
- `REPEAT_UNTIL` - Repeat until condition
- `SCHEDULE` - Time-based execution
- `HTTP_REQUEST` - API calls
- `DATABASE_QUERY` - Database operations
- `FILE_OPERATION` - File system operations
- Custom action plugins

## Questions?

See the architecture document at `/docs/ACTION_CONFIG_REFACTOR.md` for more details.
