# Unified State Discovery Schema

## Overview
This document describes the unified schema for state discovery that supports both automation sessions and recordings.

## Table: discovered_states

### Purpose
Stores discovered application states from either automation sessions (realtime) or recordings (post-hoc analysis).

### Source Discriminator Pattern
Uses a `source_type` field with mutually exclusive foreign keys to support both sources.

### Schema

```sql
CREATE TABLE discovered_states (
    -- Primary key
    id UUID PRIMARY KEY,

    -- Source discriminator (REQUIRED)
    source_type VARCHAR(50) NOT NULL,  -- 'automation_session' or 'recording'

    -- Source foreign keys (exactly one must be non-null)
    automation_session_id UUID REFERENCES automation_sessions(id) ON DELETE CASCADE,
    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,

    -- State identification
    name VARCHAR NOT NULL,
    description TEXT,
    cluster_id INTEGER,

    -- Visual elements
    state_images JSONB NOT NULL DEFAULT '[]',
    regions JSONB NOT NULL DEFAULT '[]',
    locations JSONB NOT NULL DEFAULT '[]',
    strings JSONB NOT NULL DEFAULT '[]',

    -- Frames
    frame_ids JSONB NOT NULL DEFAULT '[]',
    frame_count INTEGER NOT NULL DEFAULT 0,

    -- Position (for visualization)
    position_x FLOAT,
    position_y FLOAT,

    -- State properties
    is_initial BOOLEAN NOT NULL DEFAULT FALSE,
    is_error_state BOOLEAN NOT NULL DEFAULT FALSE,
    is_transient BOOLEAN NOT NULL DEFAULT FALSE,

    -- Confidence scores
    confidence FLOAT,
    uniqueness_score FLOAT,
    stability_score FLOAT,
    distinctiveness_score FLOAT,

    -- Context
    window_context JSONB,
    url_context VARCHAR,

    -- User review
    user_edited BOOLEAN NOT NULL DEFAULT FALSE,
    user_approved BOOLEAN NOT NULL DEFAULT FALSE,
    user_notes TEXT,

    -- Conversion to production state
    converted_to_state_id UUID,
    converted_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL,

    -- Constraints
    CONSTRAINT check_discovered_states_single_source CHECK (
        (automation_session_id IS NOT NULL AND recording_id IS NULL) OR
        (automation_session_id IS NULL AND recording_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX ix_discovered_states_recording ON discovered_states(recording_id);
CREATE INDEX ix_discovered_states_automation_session ON discovered_states(automation_session_id);
CREATE INDEX ix_discovered_states_confidence ON discovered_states(confidence);
```

## Table: state_transitions

### Purpose
Tracks transitions between states, triggered by either automation input events or recording interactions.

### Schema

```sql
CREATE TABLE state_transitions (
    -- Primary key
    id UUID PRIMARY KEY,

    -- Source discriminator (REQUIRED)
    source_type VARCHAR(50) NOT NULL,  -- 'automation_session' or 'recording'

    -- Source foreign keys (exactly one must be non-null)
    automation_session_id UUID REFERENCES automation_sessions(id) ON DELETE CASCADE,
    recording_id UUID REFERENCES recordings(id) ON DELETE CASCADE,

    -- Transition definition
    from_state_id UUID NOT NULL REFERENCES discovered_states(id),
    to_state_id UUID REFERENCES discovered_states(id),

    -- Multi-state support (for complex transitions)
    activate_state_ids JSONB NOT NULL DEFAULT '[]',
    deactivate_state_ids JSONB NOT NULL DEFAULT '[]',
    stays_visible BOOLEAN NOT NULL DEFAULT FALSE,

    -- Trigger information
    trigger_interaction_id UUID REFERENCES recording_interactions(id),  -- for recordings
    trigger_type VARCHAR,
    trigger_description TEXT,

    -- Timing
    latency_ms INTEGER,
    recommended_timeout_ms INTEGER,
    recommended_retry_count INTEGER NOT NULL DEFAULT 3,

    -- Generated workflow
    workflow JSONB,
    workflow_name VARCHAR,

    -- Confidence scores
    confidence FLOAT,
    clarity_score FLOAT,
    consistency_score FLOAT,
    completeness_score FLOAT,

    -- Position (for visualization)
    position_x FLOAT,
    position_y FLOAT,

    -- User review
    user_edited BOOLEAN NOT NULL DEFAULT FALSE,
    user_approved BOOLEAN NOT NULL DEFAULT FALSE,
    user_notes TEXT,

    -- Conversion to production transition
    converted_to_transition_id UUID,
    converted_at TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL,

    -- Constraints
    CONSTRAINT check_state_transitions_single_source CHECK (
        (automation_session_id IS NOT NULL AND recording_id IS NULL) OR
        (automation_session_id IS NULL AND recording_id IS NOT NULL)
    )
);

-- Indexes
CREATE INDEX ix_state_transitions_recording ON state_transitions(recording_id);
CREATE INDEX ix_state_transitions_automation_session ON state_transitions(automation_session_id);
CREATE INDEX ix_state_transitions_from_state ON state_transitions(from_state_id);
CREATE INDEX ix_state_transitions_to_state ON state_transitions(to_state_id);
```

## Usage Patterns

### For Automation Sessions

```python
# Create state from automation session
discovered_state = DiscoveredState(
    source_type='automation_session',
    automation_session_id=session.id,
    recording_id=None,  # Must be None
    name='Login Screen',
    state_images=[...],
    confidence=0.95
)

# Create transition from automation
transition = StateTransition(
    source_type='automation_session',
    automation_session_id=session.id,
    recording_id=None,
    from_state_id=login_state.id,
    to_state_id=dashboard_state.id,
    trigger_type='mouse_click'
)
```

### For Recordings

```python
# Create state from recording
discovered_state = DiscoveredState(
    source_type='recording',
    automation_session_id=None,  # Must be None
    recording_id=recording.id,
    name='Login Screen',
    state_images=[...],
    confidence=0.95
)

# Create transition from recording
transition = StateTransition(
    source_type='recording',
    automation_session_id=None,
    recording_id=recording.id,
    from_state_id=login_state.id,
    to_state_id=dashboard_state.id,
    trigger_interaction_id=click_interaction.id
)
```

### Querying

```python
# Get all states from automation sessions
automation_states = session.query(DiscoveredState).filter(
    DiscoveredState.source_type == 'automation_session'
).all()

# Get all states from recordings
recording_states = session.query(DiscoveredState).filter(
    DiscoveredState.source_type == 'recording'
).all()

# Get states for a specific automation session
session_states = session.query(DiscoveredState).filter(
    DiscoveredState.automation_session_id == session_id
).all()

# Get states for a specific recording
recording_states = session.query(DiscoveredState).filter(
    DiscoveredState.recording_id == recording_id
).all()
```

## Additional Tables

### automation_sessions (tracking fields added)

```sql
ALTER TABLE automation_sessions ADD COLUMN state_discovery_status VARCHAR(50);
ALTER TABLE automation_sessions ADD COLUMN state_discovery_started_at TIMESTAMP;
ALTER TABLE automation_sessions ADD COLUMN state_discovery_completed_at TIMESTAMP;
ALTER TABLE automation_sessions ADD COLUMN state_discovery_error TEXT;
```

These fields track the state discovery process for automation sessions:
- `state_discovery_status`: 'pending', 'in_progress', 'completed', 'failed'
- `state_discovery_started_at`: When discovery began
- `state_discovery_completed_at`: When discovery finished
- `state_discovery_error`: Error message if discovery failed

## Migration Path

### From Recording-Only Implementation
1. States already in `discovered_states` table
2. Set `source_type = 'recording'` for all existing states
3. `recording_id` already populated
4. `automation_session_id` remains NULL

### From Automation-Only Implementation
1. States in separate `discovered_states` table
2. Migrate to unified table
3. Set `source_type = 'automation_session'`
4. Populate `automation_session_id` from old `session_id`
5. `recording_id` remains NULL

### Unification Migration
The `f2g3h4i5j6k7_unify_state_discovery.py` migration handles:
1. Renaming `discovered_transitions` → `state_transitions` (if needed)
2. Adding `source_type` columns
3. Adding `automation_session_id` columns
4. Making `recording_id` nullable
5. Adding check constraints
6. Adding indexes

## Benefits

1. **Single Source of Truth**: One schema for both automation and recording state discovery
2. **Type Safety**: Check constraints enforce mutual exclusivity
3. **Flexibility**: Easy to add new source types in future
4. **Queryability**: Simple queries using source_type filter
5. **Maintainability**: Single codebase for state discovery logic
6. **Performance**: Indexes on both source foreign keys

## Future Enhancements

Potential future source types:
- `manual_annotation` - States manually annotated by users
- `api_inspection` - States discovered via API introspection
- `screen_scraping` - States from automated screen scraping
- `test_execution` - States from automated test runs

To add a new source type:
1. Add new table with state discovery capability
2. Add migration to add FK column to `discovered_states` and `state_transitions`
3. Update check constraint to include new source
4. Add new value to `source_type` enum/validation
