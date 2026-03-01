export interface QontinuiSettings {
  core: {
    image_path: string;
    mock: boolean;
    headless: boolean;
    sikuli_jar_path: string | null;
    tesseract_path: string | null;
    image_cache_size: number;
    auto_wait_timeout: number;
  };
  mouse: {
    move_delay: number;
    pause_before_down: number;
    pause_after_down: number;
    pause_before_up: number;
    pause_after_up: number;
    click_delay: number;
    drag_delay: number;
  };
  mock: {
    click_duration: number;
    type_duration: number;
    find_duration: number;
    drag_duration: number;
    scroll_duration: number;
    wait_duration: number;
    vanish_duration: number;
    exists_duration: number;
  };
  screenshot: {
    save_snapshots: boolean;
    path: string;
    max_history: number;
    format: string;
    quality: number;
    include_timestamp: boolean;
    capture_on_error: boolean;
  };
  illustration: {
    enabled: boolean;
    show_click: boolean;
    show_drag: boolean;
    show_type: boolean;
    show_find: boolean;
    highlight_color: string;
    highlight_thickness: number;
    annotation_font_size: number;
  };
  analysis: {
    kmeans_clusters: number;
    color_tolerance: number;
    hsv_bins: number[];
    min_contour_area: number;
    max_contour_area: number;
  };
  recording: {
    enabled: boolean;
    path: string;
    fps: number;
    codec: string;
    quality: string;
    include_audio: boolean;
    max_duration_minutes: number;
  };
  dataset: {
    collect: boolean;
    path: string;
    include_screenshots: boolean;
    include_actions: boolean;
    include_timing: boolean;
    include_results: boolean;
    format: string;
    compression: string | null;
  };
  testing: {
    timeout_multiplier: number;
    retry_failed: boolean;
    max_retries: number;
    screenshot_on_failure: boolean;
    verbose_logging: boolean;
    parallel_execution: boolean;
    random_seed: number | null;
    iteration: number;
    send_logs: boolean;
  };
  monitor: {
    default_screen_index: number;
    multi_monitor_enabled: boolean;
    search_all_monitors: boolean;
    log_monitor_info: boolean;
    operation_monitor_map: Record<string, number>;
  };
}

export const defaultSettings: QontinuiSettings = {
  core: {
    image_path: "classpath:images/",
    mock: false,
    headless: false,
    sikuli_jar_path: null,
    tesseract_path: null,
    image_cache_size: 100,
    auto_wait_timeout: 3.0,
  },
  mouse: {
    move_delay: 0.5,
    pause_before_down: 0.0,
    pause_after_down: 0.0,
    pause_before_up: 0.0,
    pause_after_up: 0.0,
    click_delay: 0.0,
    drag_delay: 0.5,
  },
  mock: {
    click_duration: 0.5,
    type_duration: 2.0,
    find_duration: 0.3,
    drag_duration: 1.0,
    scroll_duration: 0.5,
    wait_duration: 0.1,
    vanish_duration: 1.0,
    exists_duration: 0.3,
  },
  screenshot: {
    save_snapshots: true,
    path: "screenshots/",
    max_history: 50,
    format: "png",
    quality: 90,
    include_timestamp: true,
    capture_on_error: true,
  },
  illustration: {
    enabled: true,
    show_click: true,
    show_drag: true,
    show_type: true,
    show_find: true,
    highlight_color: "red",
    highlight_thickness: 3,
    annotation_font_size: 12,
  },
  analysis: {
    kmeans_clusters: 3,
    color_tolerance: 30,
    hsv_bins: [50, 60, 60],
    min_contour_area: 100,
    max_contour_area: 100000,
  },
  recording: {
    enabled: false,
    path: "recordings/",
    fps: 30,
    codec: "mp4v",
    quality: "medium",
    include_audio: false,
    max_duration_minutes: 60,
  },
  dataset: {
    collect: false,
    path: "datasets/",
    include_screenshots: true,
    include_actions: true,
    include_timing: true,
    include_results: true,
    format: "json",
    compression: null,
  },
  testing: {
    timeout_multiplier: 2.0,
    retry_failed: true,
    max_retries: 3,
    screenshot_on_failure: true,
    verbose_logging: true,
    parallel_execution: false,
    random_seed: null,
    iteration: 1,
    send_logs: true,
  },
  monitor: {
    default_screen_index: -1,
    multi_monitor_enabled: false,
    search_all_monitors: false,
    log_monitor_info: true,
    operation_monitor_map: {},
  },
};

export type UpdateSettingFn = (
  category: keyof QontinuiSettings,
  key: string,
  value: unknown
) => void;

export interface SettingsCardProps {
  settings: QontinuiSettings;
  updateSetting: UpdateSettingFn;
}
