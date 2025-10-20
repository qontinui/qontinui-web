/**
 * Qontinui API Client
 * Connects to the qontinui-api service for real pattern matching
 *
 * Note: This API client uses custom types specific to the Qontinui domain.
 * While OpenAPI types are available in @/lib/api-client/qontinui-generated-types,
 * these custom types provide better developer experience for the pattern matching use case.
 */

import { Screenshot, ScreenshotRegion, ScreenshotLocation } from '../types/Screenshot';
import { State } from '../contexts/automation-context/types';

// API Configuration
const API_BASE_URL = process.env.NEXT_PUBLIC_QONTINUI_API_URL || 'http://localhost:8000';

// Types for API requests/responses
// Note: These could potentially be replaced with generated types from OpenAPI schema
// For now, keeping custom types for better control over the domain model
interface FindRequest {
  screenshot: string; // base64
  template: string; // base64
  similarity?: number;
  search_region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  find_all?: boolean;
}

interface MatchResponse {
  found: boolean;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  score: number;
  center?: {
    x: number;
    y: number;
  };
}

interface MatchesResponse {
  found: boolean;
  matches: MatchResponse[];
  best_match?: MatchResponse;
}

interface StateDetectionRequest {
  screenshot: string;
  states: any[];
  similarity?: number;
}

interface DetectedState {
  state_id: string;
  state_name: string;
  found: boolean;
  found_images: Array<{
    image_id: string;
    image_name: string;
    match: MatchResponse;
  }>;
  regions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  confidence: number;
}

interface StateDetectionResponse {
  screenshot_analyzed: boolean;
  detected_states: DetectedState[];
  total_states_found: number;
  active_states?: string[];
}

interface StateGraphResponse {
  graph: string;
  active_states: string[];
  total_states: number;
}

interface TransitionResponse {
  transitions: Array<{
    from_state: string;
    to_state: string;
    action_type: string;
    conditions: string[];
  }>;
  count: number;
}

interface LocationValidationRequest {
  screenshot: string;
  location_x: number;
  location_y: number;
  reference_image?: string;
}

interface LocationValidationResponse {
  valid: boolean;
  reference_found?: boolean;
  reference_region?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  calculated_location?: {
    x: number;
    y: number;
  };
  absolute_location?: {
    x: number;
    y: number;
  };
  within_bounds: boolean;
  error?: string;
}

/**
 * Qontinui API Client class
 */
export class QontinuiAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Helper to make API requests
   */
  private async request<T>(
    endpoint: string,
    method: string = 'GET',
    body?: any
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[QontinuiAPI] Making request to: ${url}`);

    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API Error: ${response.status} - ${error}`);
      }

      return response.json();
    } catch (error) {
      console.error(`[QontinuiAPI] Request failed:`, error);
      console.error(`[QontinuiAPI] URL was: ${url}`);
      console.error(`[QontinuiAPI] Base URL: ${this.baseUrl}`);
      throw error;
    }
  }

  /**
   * Find a single template match in a screenshot
   * Uses real qontinui pattern matching
   */
  async find(
    screenshot: string,
    template: string,
    similarity: number = 0.8,
    searchRegion?: ScreenshotRegion
  ): Promise<MatchResponse> {
    const request: FindRequest = {
      screenshot,
      template,
      similarity,
    };

    if (searchRegion) {
      request.search_region = {
        x: searchRegion.bounds.x,
        y: searchRegion.bounds.y,
        width: searchRegion.bounds.width,
        height: searchRegion.bounds.height,
      };
    }

    return this.request<MatchResponse>('/find', 'POST', request);
  }

  /**
   * Find all template matches in a screenshot
   */
  async findAll(
    screenshot: string,
    template: string,
    similarity: number = 0.8,
    searchRegion?: ScreenshotRegion
  ): Promise<MatchesResponse> {
    const request: FindRequest = {
      screenshot,
      template,
      similarity,
      find_all: true,
    };

    if (searchRegion) {
      request.search_region = {
        x: searchRegion.bounds.x,
        y: searchRegion.bounds.y,
        width: searchRegion.bounds.width,
        height: searchRegion.bounds.height,
      };
    }

    return this.request<MatchesResponse>('/find_all', 'POST', request);
  }

  /**
   * Detect which states are present in a screenshot
   * Uses real qontinui state detection
   */
  async detectStates(
    screenshot: string,
    states: State[],
    similarity: number = 0.8
  ): Promise<StateDetectionResponse> {
    const request: StateDetectionRequest = {
      screenshot,
      states: states as any[], // Convert to plain objects
      similarity,
    };

    return this.request<StateDetectionResponse>('/detect_states', 'POST', request);
  }

  /**
   * Validate if a location is accessible in a screenshot
   */
  async validateLocation(
    screenshot: string,
    location: ScreenshotLocation,
    referenceImage?: string
  ): Promise<LocationValidationResponse> {
    const request: LocationValidationRequest = {
      screenshot,
      location_x: location.x,
      location_y: location.y,
      reference_image: referenceImage,
    };

    return this.request<LocationValidationResponse>('/validate_location', 'POST', request);
  }

  /**
   * Register states with Qontinui's state management
   */
  async registerStates(states: State[]): Promise<{
    registered: string[];
    total: number;
  }> {
    return this.request('/states/register', 'POST', states);
  }

  /**
   * Get currently active states from Qontinui
   */
  async getActiveStates(): Promise<{
    active_states: string[];
    count: number;
  }> {
    return this.request('/states/active');
  }

  /**
   * Set active states in Qontinui
   */
  async setActiveStates(stateIds: string[]): Promise<{
    success: boolean;
    active_states: string[];
    count: number;
  }> {
    return this.request('/states/active', 'POST', { state_ids: stateIds });
  }

  /**
   * Activate a single state with evidence
   */
  async activateState(stateId: string, evidenceScore: number = 1.0): Promise<{
    state_id: string;
    activated: boolean;
    evidence_score: number;
  }> {
    return this.request(`/states/activate/${stateId}?evidence_score=${evidenceScore}`, 'POST');
  }

  /**
   * Deactivate a single state
   */
  async deactivateState(stateId: string): Promise<{
    state_id: string;
    deactivated: boolean;
  }> {
    return this.request(`/states/deactivate/${stateId}`, 'POST');
  }

  /**
   * Get possible transitions from current states
   */
  async getPossibleTransitions(): Promise<TransitionResponse> {
    return this.request('/states/transitions');
  }

  /**
   * Execute a state transition
   */
  async executeTransition(
    fromState: string,
    toState: string,
    actionType?: string
  ): Promise<{
    success: boolean;
    from_state: string;
    to_state: string;
    current_states: string[];
    error?: string;
  }> {
    return this.request('/states/transition', 'POST', {
      from_state: fromState,
      to_state: toState,
      action_type: actionType,
    });
  }

  /**
   * Get state graph visualization
   */
  async getStateGraph(): Promise<StateGraphResponse> {
    return this.request('/states/graph');
  }

  /**
   * Reset state manager to initial state
   */
  async resetStateManager(): Promise<{
    success: boolean;
    active_states: string[];
  }> {
    return this.request('/states/reset', 'POST');
  }

  /**
   * Execute a process in hybrid mock mode
   */
  async executeProcess(
    process: any,
    screenshots: string[],
    states: any[],
    categories: any[] = [],
    mode: 'hybrid' | 'full_mock' = 'hybrid',
    similarity: number = 0.8
  ): Promise<{
    session_id: string;
    process_id: string;
    process_name: string;
    category_name: string;
    status: string;
    current_action: number;
    total_actions: number;
    results: any[];
  }> {
    return this.request('/process/execute', 'POST', {
      process,
      screenshots,
      states,
      categories,
      mode,
      similarity
    });
  }

  /**
   * Execute a single step in a process
   */
  async executeProcessStep(
    sessionId: string,
    action: any
  ): Promise<{
    actionId: string;
    actionType: string;
    success: boolean;
    message: string;
    duration: number;
    timestamp: string;
  }> {
    return this.request(`/process/execute_step/${sessionId}`, 'POST', action);
  }

  /**
   * Get the status of a process execution
   */
  async getProcessStatus(sessionId: string): Promise<{
    session_id: string;
    total_actions: number;
    successful_actions: number;
    success_rate: number;
    active_states: string[];
    current_screenshot: number;
    history: any[];
  }> {
    return this.request(`/process/status/${sessionId}`);
  }

  /**
   * Complete a process execution
   */
  async completeProcess(sessionId: string): Promise<{
    session_id: string;
    status: string;
    total_actions: number;
    successful_actions: number;
    success_rate: number;
    execution_history: any[];
  }> {
    return this.request(`/process/complete/${sessionId}`, 'POST');
  }

  /**
   * Health check for the API service
   */
  async healthCheck(): Promise<{
    status: string;
    service: string;
    version: string;
    qontinui_available: boolean;
    state_management?: {
      active_states: number;
      registered_states: number;
    };
  }> {
    return this.request('/health');
  }

  /**
   * Test connection to the API
   */
  async testConnection(): Promise<boolean> {
    try {
      const health = await this.healthCheck();
      return health.status === 'healthy' && health.qontinui_available;
    } catch (error) {
      console.error('Failed to connect to Qontinui API:', error);
      return false;
    }
  }
}

// Singleton instance
export const qontinuiAPI = new QontinuiAPIClient();

// Helper functions for common operations

/**
 * Extract image region from screenshot as base64
 */
export function extractImageRegion(
  screenshot: string,
  region: ScreenshotRegion
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = region.bounds.width;
      canvas.height = region.bounds.height;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(
        img,
        region.bounds.x,
        region.bounds.y,
        region.bounds.width,
        region.bounds.height,
        0,
        0,
        region.bounds.width,
        region.bounds.height
      );

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = screenshot;
  });
}

/**
 * Test a single state image against a screenshot
 */
export async function testStateImage(
  screenshot: Screenshot,
  stateImage: string,
  similarity: number = 0.8
): Promise<{
  found: boolean;
  matches: MatchResponse[];
  confidence: number;
}> {
  try {
    const result = await qontinuiAPI.findAll(
      screenshot.imageData,
      stateImage,
      similarity
    );

    return {
      found: result.found,
      matches: result.matches,
      confidence: result.best_match?.score || 0,
    };
  } catch (error) {
    console.error('Failed to test state image:', error);
    return {
      found: false,
      matches: [],
      confidence: 0,
    };
  }
}

/**
 * Run state detection on a screenshot
 */
export async function runStateDetection(
  screenshot: Screenshot,
  states: State[],
  similarity: number = 0.8
): Promise<DetectedState[]> {
  try {
    // First register states if needed
    await qontinuiAPI.registerStates(states);

    // Then detect states
    const result = await qontinuiAPI.detectStates(
      screenshot.imageData,
      states,
      similarity
    );

    return result.detected_states;
  } catch (error) {
    console.error('Failed to detect states:', error);
    return [];
  }
}

/**
 * Get current active states from Qontinui
 */
export async function getCurrentActiveStates(): Promise<string[]> {
  try {
    const result = await qontinuiAPI.getActiveStates();
    return result.active_states;
  } catch (error) {
    console.error('Failed to get active states:', error);
    return [];
  }
}

/**
 * Execute a state transition
 */
export async function executeStateTransition(
  fromState: string,
  toState: string
): Promise<boolean> {
  try {
    const result = await qontinuiAPI.executeTransition(fromState, toState);
    return result.success;
  } catch (error) {
    console.error('Failed to execute transition:', error);
    return false;
  }
}

/**
 * Validate all locations in a screenshot
 */
export async function validateAllLocations(
  screenshot: Screenshot
): Promise<Map<string, LocationValidationResponse>> {
  const results = new Map<string, LocationValidationResponse>();

  for (const location of screenshot.locations) {
    try {
      // Get reference image if location has one
      let referenceImage: string | undefined;
      if (location.referenceImageId) {
        // Extract the reference image region from screenshot
        // This would need to be implemented based on your state image storage
        referenceImage = undefined; // Placeholder
      }

      const validation = await qontinuiAPI.validateLocation(
        screenshot.imageData,
        location,
        referenceImage
      );

      results.set(location.id, validation);
    } catch (error) {
      console.error(`Failed to validate location ${location.id}:`, error);
      results.set(location.id, {
        valid: false,
        within_bounds: false,
        error: String(error),
      });
    }
  }

  return results;
}

/**
 * Test pattern matching for template in screenshot
 * Returns detailed results for visualization
 */
export async function testPatternMatching(
  template: string,
  screenshot: string,
  similarity: number = 0.8,
  findAll: boolean = true
): Promise<{
  success: boolean;
  matches: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    score: number;
    confidence: number;
    rank: number;
  }>;
  templateSize?: {
    width: number;
    height: number;
  };
  threshold?: number;
  totalMatches?: number;
}> {
  try {
    const response = await fetch(`${API_BASE_URL}/pattern_matching/test`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        template,
        screenshot,
        similarity,
        find_all: findAll
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Pattern matching test failed:', error);
    // Return empty results on error
    return {
      success: false,
      matches: [],
      totalMatches: 0
    };
  }
}
