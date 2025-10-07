# Application Settings Implementation Documentation

## Overview

This document details the implementation of the application settings system in qontinui-web, based on Brobot's BrobotProperties framework. The settings system provides centralized configuration management for the Qontinui automation framework.

## Architecture

### Components

1. **Backend (Python)**
   - QontinuiProperties class with Pydantic models
   - FastAPI endpoints for settings CRUD operations
   - Settings schemas for API validation

2. **Frontend (React/TypeScript)**
   - SettingsTab component with categorized UI
   - Integration with automation-builder
   - REST API client for settings management

3. **Configuration Persistence**
   - Settings stored in backend
   - Support for YAML/JSON export/import
   - Default values from Brobot framework

## Brobot Properties Analysis

### BrobotProperties Structure

Brobot's configuration system uses Spring Boot's `@ConfigurationProperties` to organize settings into logical groups:

#### 1. Core Settings
- **image_path**: Path to image resources (classpath, absolute, or relative)
- **mock**: Enable mock mode for simulated execution
- **headless**: Run without GUI
- **package_name**: Default package name for generated code

#### 2. Mouse Settings
- **move_delay**: Delay for mouse movements (seconds)
- **pause_before_down**: Pause before mouse down action
- **pause_after_down**: Pause after mouse down action
- **pause_before_up**: Pause before mouse up action
- **pause_after_up**: Pause after mouse up action
- **x_move_after_down**: X offset after mouse down (pixels)
- **y_move_after_down**: Y offset after mouse down (pixels)

#### 3. Mock Mode Settings
- **time_find_first**: Simulated time for find first operation
- **time_find_all**: Simulated time for find all operation
- **time_drag**: Simulated time for drag operation
- **time_click**: Simulated time for click operation
- **time_move**: Simulated time for move operation
- **time_find_histogram**: Simulated time for histogram find
- **time_find_color**: Simulated time for color find
- **time_classify**: Simulated time for classify operation
- **action_success_probability**: Mock action success rate (0.0-1.0)

#### 4. Screenshot Settings
- **save_snapshots**: Enable screenshot saving
- **save_history**: Enable history saving with illustrations
- **path**: Path for screenshots
- **filename**: Filename prefix for screenshots
- **history_path**: Path for history screenshots
- **history_filename**: Filename prefix for history
- **test_screenshots**: List of test screenshots
- **test_path**: Path for test screenshots

#### 5. Illustration Settings
- **draw_find**: Draw find results
- **draw_click**: Draw click locations
- **draw_drag**: Draw drag paths
- **draw_move**: Draw move paths
- **draw_highlight**: Draw highlight regions
- **draw_repeated_actions**: Draw repeated actions
- **draw_classify**: Draw classify results
- **draw_define**: Draw define regions

#### 6. Analysis Settings
- **k_means_in_profile**: Default k value for k-means clustering
- **max_k_means_to_store**: Maximum k value to store
- **init_static_profiles**: Initialize profiles for static images
- **init_dynamic_profiles**: Initialize profiles for dynamic images
- **include_state_objects**: Include state objects in scene analysis

#### 7. Recording Settings
- **seconds_to_capture**: Maximum recording duration (seconds)
- **capture_frequency**: Capture frequency (frames per second)
- **folder**: Recording folder path

#### 8. Dataset Settings
- **build**: Enable dataset building
- **path**: Dataset storage path

#### 9. Testing Settings
- **iteration**: Current test iteration
- **send_logs**: Send logs to external systems

#### 10. Monitor Settings
- **default_screen_index**: Monitor index for automation (0=primary, 1=secondary, -1=primary)
- **multi_monitor_enabled**: Enable multi-monitor support
- **search_all_monitors**: Search across all monitors when finding elements
- **log_monitor_info**: Log monitor information for each operation
- **operation_monitor_map**: Monitor assignment for specific operations

## Python Implementation

### File Structure

```
qontinui/src/qontinui/config/
├── qontinui_properties.py    # Main properties class
├── settings.py                # Settings singleton (separate system)
├── configuration_manager.py   # Configuration management
├── framework_settings.py      # Framework-specific settings
└── execution_environment.py   # Environment configuration
```

### QontinuiProperties Class

Location: `/home/jspinak/qontinui_parent_directory/qontinui/src/qontinui/config/qontinui_properties.py`

The QontinuiProperties class uses Pydantic for type-safe configuration:

```python
class QontinuiProperties(BaseModel):
    """Centralized configuration properties for the Qontinui framework."""

    core: CoreConfig
    mouse: MouseConfig
    mock: MockConfig
    screenshot: ScreenshotConfig
    illustration: IllustrationConfig
    analysis: AnalysisConfig
    recording: RecordingConfig
    dataset: DatasetConfig
    testing: TestingConfig
    monitor: MonitorConfig
```

#### Key Features

1. **Type Safety**: Pydantic validation ensures type correctness
2. **Default Values**: All settings have sensible defaults from Brobot
3. **Validation**: Field constraints (e.g., `ge=0`, `le=1.0`, `pattern="^(png|jpg|jpeg|bmp)$"`)
4. **Serialization**: Built-in YAML/JSON export/import
5. **Environment Variables**: Support for `.env` files

#### Configuration Categories

Each category is a separate Pydantic model with validation:

**CoreConfig**:
- Paths to external tools (Sikuli, Tesseract)
- Image caching configuration
- Default wait timeouts
- Mock and headless modes

**MouseConfig**:
- Timing for mouse movements
- Pauses before/after mouse actions
- Click and drag delays

**MockConfig**:
- Simulated durations for all action types
- Used when testing without actual GUI interaction

**ScreenshotConfig**:
- Save options and paths
- History management
- Format and quality settings
- Error capture options

**IllustrationConfig**:
- Visual feedback options
- Highlight colors and styles
- Annotation settings

**AnalysisConfig**:
- K-means clustering parameters
- Color matching tolerance
- Contour detection settings

**RecordingConfig**:
- Video recording options
- FPS and codec settings
- Duration limits

**DatasetConfig**:
- AI training data collection
- Data format options
- Compression settings

**TestingConfig**:
- Test execution parameters
- Retry and timeout settings
- Logging options

**MonitorConfig**:
- Multi-monitor support
- Monitor selection
- Per-operation monitor mapping

### Enhancements to Brobot Design

1. **Additional Fields**:
   - `sikuli_jar_path`, `tesseract_path` in CoreConfig
   - `image_cache_size`, `auto_wait_timeout` in CoreConfig
   - `click_delay`, `drag_delay` in MouseConfig
   - `max_history`, `quality`, `include_timestamp`, `capture_on_error` in ScreenshotConfig

2. **Python-Specific Features**:
   - Type hints throughout
   - Pydantic validation
   - Environment variable support via pydantic-settings
   - Path objects instead of strings where appropriate

## Backend API Implementation

### File Structure

```
qontinui-web/backend/app/
├── api/v1/endpoints/
│   └── settings.py          # Settings API endpoints
└── schemas/
    └── settings.py          # Pydantic schemas for API
```

### API Endpoints

Location: `/home/jspinak/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/settings.py`

#### GET /api/v1/settings/
Get current settings (with defaults if none exist)

**Response**: Complete QontinuiSettings object

#### PUT /api/v1/settings/
Update settings

**Request Body**: QontinuiSettingsUpdate (partial update)
**Response**: Updated QontinuiSettings

#### POST /api/v1/settings/reset
Reset to default values

**Response**: Default QontinuiSettings

#### GET /api/v1/settings/export
Export settings to YAML or JSON

**Query Parameters**:
- `format`: "yaml" or "json"

**Response**:
```json
{
  "format": "yaml",
  "content": "..."
}
```

#### POST /api/v1/settings/import
Import settings from YAML or JSON

**Request Body**:
```json
{
  "content": "...",
  "format": "yaml"
}
```

**Response**:
```json
{
  "success": true,
  "settings": {...}
}
```

### API Schemas

Location: `/home/jspinak/qontinui_parent_directory/qontinui-web/backend/app/schemas/settings.py`

Pydantic schemas mirror the Python properties structure:

- `QontinuiSettings`: Complete settings object
- `QontinuiSettingsUpdate`: Partial update schema with all fields Optional
- Category-specific schemas: `CoreSettingsSchema`, `MouseSettingsSchema`, etc.

All fields are optional in update schemas to support partial updates.

## Frontend Implementation

### File Structure

```
qontinui-web/frontend/src/components/
└── settings/
    └── SettingsTab.tsx      # Main settings UI component
```

### SettingsTab Component

Location: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/settings/SettingsTab.tsx`

#### Features

1. **Categorized UI**: Settings organized into 5 main tabs:
   - **Core**: Essential framework and monitor settings
   - **Actions**: Mouse and mock mode settings
   - **Capture**: Screenshot, recording, and illustration settings
   - **Analysis**: Analysis and dataset settings
   - **Testing**: Test execution settings

2. **Action Buttons**:
   - **Save**: Persist settings to backend
   - **Reset**: Reset to default values
   - **Export**: Download settings as YAML file

3. **Input Types**:
   - Text inputs for paths and strings
   - Number inputs for numeric values
   - Switches for boolean flags
   - Select dropdowns for enums (format, quality, etc.)
   - Sliders for range values (planned)

4. **Real-time Updates**: State changes immediately update local state

5. **API Integration**:
   - Loads settings on mount
   - Saves to backend on button click
   - Handles authentication via localStorage token

#### Component Structure

```typescript
interface QontinuiSettings {
  core: { ... }
  mouse: { ... }
  mock: { ... }
  screenshot: { ... }
  illustration: { ... }
  analysis: { ... }
  recording: { ... }
  dataset: { ... }
  testing: { ... }
  monitor: { ... }
}

export function SettingsTab() {
  const [settings, setSettings] = useState<QontinuiSettings>(defaultSettings)
  const [loading, setLoading] = useState(false)

  // Load, save, reset, export functions
  // updateSetting helper for nested state updates

  return (
    <Tabs>
      {/* Category tabs with cards for each setting group */}
    </Tabs>
  )
}
```

### Integration with Automation Builder

Location: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/automation-builder.tsx`

The Settings tab is added as a top-level category alongside:
- Build Automation Processes
- Develop State Structure
- Verify Automation

```typescript
<TabsTrigger value="settings" className="...">
  Settings
</TabsTrigger>

<TabsContent value="settings" className="...">
  <SettingsTab />
</TabsContent>
```

## Configuration Persistence

### Current Implementation

Settings are currently stored in-memory with:
- Default values from QontinuiProperties
- REST API for CRUD operations
- Export/import via YAML/JSON

### Future Enhancements (TODO)

1. **Database Storage**:
   - Add settings table to database
   - Store user-specific settings
   - Project-specific settings overrides

2. **Settings Hierarchy**:
   - System defaults (from QontinuiProperties)
   - User defaults
   - Project-specific overrides
   - Session overrides

3. **Settings Profiles**:
   - Predefined profiles (Development, Testing, Production, CI/CD)
   - Custom user profiles
   - Quick profile switching

## Application Startup

### Settings Load Sequence

1. **Backend Initialization**:
   - Load QontinuiProperties with defaults
   - Check for configuration files (qontinui.yaml, .env)
   - Apply environment variables

2. **Frontend Load**:
   - User navigates to Settings tab
   - Component mounts and calls `GET /api/v1/settings/`
   - Backend returns current settings (or defaults)
   - UI populates with loaded values

3. **Runtime Updates**:
   - User modifies settings in UI
   - Clicks "Save" to persist via `PUT /api/v1/settings/`
   - Backend validates and stores settings
   - Settings take effect immediately (or on next operation)

### Configuration Sources (Priority Order)

1. Session/runtime overrides
2. Database settings (TODO)
3. Project configuration files
4. Environment variables
5. Default values from QontinuiProperties

## Usage Examples

### Python: Loading and Using Settings

```python
from qontinui.config.qontinui_properties import QontinuiProperties

# Load default settings
props = QontinuiProperties()

# Access settings
if props.core.mock:
    # Use mock timings
    wait_time = props.mock.click_duration
else:
    # Use real mouse delays
    wait_time = props.mouse.move_delay

# Load from YAML
props = QontinuiProperties.from_yaml(Path("config.yaml"))

# Export to YAML
props.to_yaml(Path("exported_config.yaml"))
```

### Frontend: Updating Settings

```typescript
// In SettingsTab component
const updateSetting = (category: keyof QontinuiSettings, key: string, value: any) => {
  setSettings((prev) => ({
    ...prev,
    [category]: {
      ...prev[category],
      [key]: value,
    },
  }))
}

// Save to backend
const saveSettings = async () => {
  const response = await fetch("/api/v1/settings/", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${localStorage.getItem("token")}`,
    },
    body: JSON.stringify(settings),
  })
}
```

### API: Exporting Settings

```bash
# Export as YAML
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/v1/settings/export?format=yaml"

# Export as JSON
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/v1/settings/export?format=json"
```

## Comparison with Brobot

### Similarities

1. **Structure**: Same category organization (Core, Mouse, Mock, etc.)
2. **Defaults**: Default values preserved from Brobot
3. **Purpose**: Centralized configuration management
4. **Categories**: All Brobot categories implemented

### Differences

1. **Technology**:
   - Brobot: Spring Boot @ConfigurationProperties
   - Qontinui: Pydantic BaseModel

2. **Storage**:
   - Brobot: application.yml / application.properties
   - Qontinui: Database + YAML/JSON export

3. **Validation**:
   - Brobot: Spring Validation annotations
   - Qontinui: Pydantic validators (ge, le, pattern, etc.)

4. **UI**:
   - Brobot: No built-in UI
   - Qontinui: React-based settings UI

5. **Additional Features**:
   - Python-specific: Path objects, type hints
   - Web-specific: REST API, import/export
   - Enhanced: More granular screenshot and recording options

## Testing

### Backend Tests (TODO)

```python
def test_get_default_settings():
    response = client.get("/api/v1/settings/")
    assert response.status_code == 200
    data = response.json()
    assert data["core"]["mock"] == False

def test_update_settings():
    update = {"core": {"mock": True}}
    response = client.put("/api/v1/settings/", json=update)
    assert response.status_code == 200
    assert response.json()["core"]["mock"] == True

def test_reset_settings():
    response = client.post("/api/v1/settings/reset")
    assert response.status_code == 200
```

### Frontend Tests (TODO)

```typescript
describe("SettingsTab", () => {
  test("loads settings on mount", async () => {
    render(<SettingsTab />)
    await waitFor(() => {
      expect(screen.getByLabelText("Mock Mode")).toBeInTheDocument()
    })
  })

  test("updates setting value", async () => {
    render(<SettingsTab />)
    const mockSwitch = screen.getByLabelText("Mock Mode")
    fireEvent.click(mockSwitch)
    expect(mockSwitch).toBeChecked()
  })
})
```

## Future Enhancements

### High Priority

1. **Database Persistence**:
   - Add settings table to PostgreSQL
   - User-specific settings
   - Project-specific overrides

2. **Settings Validation**:
   - Validate paths exist
   - Check tool availability (Tesseract, SikuliX)
   - Warn about conflicting settings

3. **Settings Impact**:
   - Show which settings require restart
   - Preview changes before saving
   - Rollback mechanism

### Medium Priority

1. **Settings Profiles**:
   - Quick switch between profiles
   - Import/export profiles
   - Share profiles with team

2. **Settings Search**:
   - Search/filter settings
   - Recent changes
   - Setting descriptions

3. **Advanced UI**:
   - Keyboard shortcuts
   - Bulk edit
   - Compare settings

### Low Priority

1. **Settings Templates**:
   - Templates for common scenarios
   - Industry-specific presets
   - Community-contributed templates

2. **Settings History**:
   - Track changes over time
   - Revert to previous values
   - Audit log

3. **Settings Sync**:
   - Sync across devices
   - Team settings
   - Cloud backup

## Troubleshooting

### Common Issues

1. **Settings not saving**:
   - Check authentication token
   - Verify backend is running
   - Check browser console for errors

2. **Settings not loading**:
   - Verify API endpoint is accessible
   - Check CORS configuration
   - Ensure qontinui package is installed in backend

3. **Invalid values**:
   - Pydantic will raise validation errors
   - Check field constraints (ge, le, pattern)
   - Review error messages in API response

### Debug Steps

1. Check backend logs for errors
2. Inspect network requests in browser DevTools
3. Verify settings schema matches frontend interface
4. Test API endpoints directly with curl/Postman
5. Check Pydantic validation errors

## References

### Source Files

- **Brobot**: `/home/jspinak/brobot-parent-directory/brobot/library/src/main/java/io/github/jspinak/brobot/config/core/BrobotProperties.java`
- **Qontinui Properties**: `/home/jspinak/qontinui_parent_directory/qontinui/src/qontinui/config/qontinui_properties.py`
- **Backend API**: `/home/jspinak/qontinui_parent_directory/qontinui-web/backend/app/api/v1/endpoints/settings.py`
- **Backend Schemas**: `/home/jspinak/qontinui_parent_directory/qontinui-web/backend/app/schemas/settings.py`
- **Frontend UI**: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/settings/SettingsTab.tsx`
- **Integration**: `/home/jspinak/qontinui_parent_directory/qontinui-web/frontend/src/components/automation-builder.tsx`

### External Documentation

- [Pydantic Documentation](https://docs.pydantic.dev/)
- [FastAPI Configuration](https://fastapi.tiangolo.com/advanced/settings/)
- [React useState Hook](https://react.dev/reference/react/useState)
- [Spring Boot Configuration Properties](https://docs.spring.io/spring-boot/docs/current/reference/html/features.html#features.external-config)

## Conclusion

The application settings system provides a comprehensive, type-safe configuration framework for Qontinui, faithful to Brobot's design while leveraging Python and web technologies. The implementation includes:

- ✅ Complete property categories from Brobot
- ✅ Type-safe Python implementation with Pydantic
- ✅ REST API for settings management
- ✅ User-friendly React UI with categorized tabs
- ✅ Export/import functionality
- ✅ Integration with automation builder

The system is extensible and ready for future enhancements like database persistence, settings profiles, and advanced validation.
