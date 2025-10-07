import { TokenStorage } from './auth/token-storage';
import { TokenValidator } from './auth/token-validator';
import { TokenManager } from './auth/token-manager';
import { TokenRefreshService } from './auth/token-refresh-service';
import { AuthService } from './auth/auth-service';
import { HttpClient } from './http-client';
import { ProjectService } from './project-service';
import { FileUploadService } from './file-upload-service';
import { ProfileService } from './profile-service';
import { AnalyticsService } from './analytics-service';
import { ApiConfig } from './api-config';

/**
 * ServiceFactory - Single Responsibility: Create and wire up services
 * Manages dependency injection and service lifecycle
 */
export class ServiceFactory {
  private static instance: ServiceFactory;

  public readonly tokenStorage: TokenStorage;
  public readonly tokenValidator: TokenValidator;
  public readonly tokenManager: TokenManager;
  public readonly tokenRefreshService: TokenRefreshService;
  public readonly authService: AuthService;
  public readonly httpClient: HttpClient;
  public readonly projectService: ProjectService;
  public readonly fileUploadService: FileUploadService;
  public readonly profileService: ProfileService;
  public readonly analyticsService: AnalyticsService;

  private constructor() {
    // Initialize auth services in dependency order
    this.tokenStorage = new TokenStorage();
    this.tokenValidator = new TokenValidator();
    this.tokenManager = new TokenManager(this.tokenStorage, this.tokenValidator);
    this.tokenRefreshService = new TokenRefreshService(this.tokenManager, ApiConfig.API_BASE_URL);
    this.authService = new AuthService(this.tokenManager, this.tokenRefreshService, ApiConfig.API_BASE_URL);

    // Initialize other services
    this.httpClient = new HttpClient(this.tokenManager);
    this.projectService = new ProjectService(this.httpClient);
    this.fileUploadService = new FileUploadService(this.tokenManager);
    this.profileService = new ProfileService(this.httpClient);
    this.analyticsService = new AnalyticsService(this.httpClient);

    // Wire up session expiry handling for 401 responses
    this.httpClient.setSessionExpiredHandler(() => {
      this.authService.logout();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('session-expired'));
      }
    });
  }

  public static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }
}

// Export singleton instances
const factory = ServiceFactory.getInstance();

export const tokenStorage = factory.tokenStorage;
export const tokenValidator = factory.tokenValidator;
export const tokenManager = factory.tokenManager;
export const tokenRefreshService = factory.tokenRefreshService;
export const authService = factory.authService;
export const httpClient = factory.httpClient;
export const projectService = factory.projectService;
export const fileUploadService = factory.fileUploadService;
export const profileService = factory.profileService;
export const analyticsService = factory.analyticsService;
