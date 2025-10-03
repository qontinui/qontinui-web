"""Pydantic schemas for Qontinui settings API."""

from pydantic import BaseModel, Field


class CoreSettingsSchema(BaseModel):
    """Core framework settings schema."""

    image_path: str | None = None
    mock: bool | None = None
    headless: bool | None = None
    sikuli_jar_path: str | None = None
    tesseract_path: str | None = None
    image_cache_size: int | None = None
    auto_wait_timeout: float | None = None


class MouseSettingsSchema(BaseModel):
    """Mouse action configuration schema."""

    move_delay: float | None = None
    pause_before_down: float | None = None
    pause_after_down: float | None = None
    pause_before_up: float | None = None
    pause_after_up: float | None = None
    click_delay: float | None = None
    drag_delay: float | None = None


class MockSettingsSchema(BaseModel):
    """Mock mode timing configuration schema."""

    click_duration: float | None = None
    type_duration: float | None = None
    find_duration: float | None = None
    drag_duration: float | None = None
    scroll_duration: float | None = None
    wait_duration: float | None = None
    vanish_duration: float | None = None
    exists_duration: float | None = None


class ScreenshotSettingsSchema(BaseModel):
    """Screenshot and history settings schema."""

    save_snapshots: bool | None = None
    path: str | None = None
    max_history: int | None = None
    format: str | None = None
    quality: int | None = None
    include_timestamp: bool | None = None
    capture_on_error: bool | None = None


class IllustrationSettingsSchema(BaseModel):
    """Action illustration settings schema."""

    enabled: bool | None = None
    show_click: bool | None = None
    show_drag: bool | None = None
    show_type: bool | None = None
    show_find: bool | None = None
    highlight_color: str | None = None
    highlight_thickness: int | None = None
    annotation_font_size: int | None = None


class AnalysisSettingsSchema(BaseModel):
    """Color analysis settings schema."""

    kmeans_clusters: int | None = None
    color_tolerance: int | None = None
    hsv_bins: list[int] | None = None
    min_contour_area: int | None = None
    max_contour_area: int | None = None


class RecordingSettingsSchema(BaseModel):
    """Screen recording settings schema."""

    enabled: bool | None = None
    path: str | None = None
    fps: int | None = None
    codec: str | None = None
    quality: str | None = None
    include_audio: bool | None = None
    max_duration_minutes: int | None = None


class DatasetSettingsSchema(BaseModel):
    """AI dataset generation settings schema."""

    collect: bool | None = None
    path: str | None = None
    include_screenshots: bool | None = None
    include_actions: bool | None = None
    include_timing: bool | None = None
    include_results: bool | None = None
    format: str | None = None
    compression: str | None = None


class TestingSettingsSchema(BaseModel):
    """Test execution settings schema."""

    timeout_multiplier: float | None = None
    retry_failed: bool | None = None
    max_retries: int | None = None
    screenshot_on_failure: bool | None = None
    verbose_logging: bool | None = None
    parallel_execution: bool | None = None
    random_seed: int | None = None
    iteration: int | None = None
    send_logs: bool | None = None


class MonitorSettingsSchema(BaseModel):
    """Monitor configuration settings schema."""

    default_screen_index: int | None = None
    multi_monitor_enabled: bool | None = None
    search_all_monitors: bool | None = None
    log_monitor_info: bool | None = None
    operation_monitor_map: dict[str, int] | None = None


class QontinuiSettings(BaseModel):
    """Complete Qontinui settings."""

    core: CoreSettingsSchema = Field(default_factory=CoreSettingsSchema)
    mouse: MouseSettingsSchema = Field(default_factory=MouseSettingsSchema)
    mock: MockSettingsSchema = Field(default_factory=MockSettingsSchema)
    screenshot: ScreenshotSettingsSchema = Field(
        default_factory=ScreenshotSettingsSchema
    )
    illustration: IllustrationSettingsSchema = Field(
        default_factory=IllustrationSettingsSchema
    )
    analysis: AnalysisSettingsSchema = Field(default_factory=AnalysisSettingsSchema)
    recording: RecordingSettingsSchema = Field(default_factory=RecordingSettingsSchema)
    dataset: DatasetSettingsSchema = Field(default_factory=DatasetSettingsSchema)
    testing: TestingSettingsSchema = Field(default_factory=TestingSettingsSchema)
    monitor: MonitorSettingsSchema = Field(default_factory=MonitorSettingsSchema)


class QontinuiSettingsUpdate(BaseModel):
    """Update schema for Qontinui settings."""

    core: CoreSettingsSchema | None = None
    mouse: MouseSettingsSchema | None = None
    mock: MockSettingsSchema | None = None
    screenshot: ScreenshotSettingsSchema | None = None
    illustration: IllustrationSettingsSchema | None = None
    analysis: AnalysisSettingsSchema | None = None
    recording: RecordingSettingsSchema | None = None
    dataset: DatasetSettingsSchema | None = None
    testing: TestingSettingsSchema | None = None
    monitor: MonitorSettingsSchema | None = None
