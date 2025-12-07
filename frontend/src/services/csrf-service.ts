/**
 * CSRF Service - Singleton for managing CSRF token access
 *
 * This service provides centralized CSRF token management across the application.
 * It attempts to retrieve the token from two sources (in order):
 * 1. Meta tag: <meta name="csrf-token" content="...">
 * 2. Cookies: csrf_token=...
 */

export class CsrfService {
  private static instance: CsrfService;
  private csrfToken: string | null = null;

  /**
   * Private constructor to enforce singleton pattern
   */
  private constructor() {
    this.initialize();
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): CsrfService {
    if (!CsrfService.instance) {
      CsrfService.instance = new CsrfService();
    }
    return CsrfService.instance;
  }

  /**
   * Initialize the CSRF token from available sources
   */
  private initialize(): void {
    // Skip initialization in server-side rendering
    if (typeof window === "undefined") {
      return;
    }

    try {
      // First, try to get token from meta tag
      const metaTag = document.querySelector('meta[name="csrf-token"]');
      if (metaTag) {
        this.csrfToken = metaTag.getAttribute("content");
        return;
      }

      // Fallback to parsing from cookies
      const match = document.cookie.match(/csrf_token=([^;]+)/);
      if (match) {
        this.csrfToken = match[1] ?? null;
      }
    } catch (error) {
      console.warn("Failed to initialize CSRF token:", error);
    }
  }

  /**
   * Get the current CSRF token
   *
   * @returns The CSRF token or null if not available
   */
  getToken(): string | null {
    return this.csrfToken;
  }

  /**
   * Refresh the CSRF token by re-initializing
   *
   * This can be called after page updates or token rotation
   */
  refresh(): void {
    this.initialize();
  }

  /**
   * Check if a CSRF token is available
   *
   * @returns true if a token is available, false otherwise
   */
  hasToken(): boolean {
    return this.csrfToken !== null;
  }
}

// Export a default instance for convenience
export const csrfService = CsrfService.getInstance();
