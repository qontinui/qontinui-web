import { TokenManager } from './token-manager';
import { HttpClient } from './http-client';
import { AuthService } from './auth-service';
import { ProjectService } from './project-service';
import { FileUploadService } from './file-upload-service';
import { ProfileService } from './profile-service';
import { AnalyticsService } from './analytics-service';
import { ApiConfig } from './api-config';

export class ServiceFactory {
  private static instance: ServiceFactory;

  public readonly tokenManager: TokenManager;
  public readonly httpClient: HttpClient;
  public readonly authService: AuthService;
  public readonly projectService: ProjectService;
  public readonly fileUploadService: FileUploadService;
  public readonly profileService: ProfileService;
  public readonly analyticsService: AnalyticsService;

  private constructor() {
    this.tokenManager = new TokenManager();
    this.httpClient = new HttpClient(this.tokenManager);
    this.authService = new AuthService(this.tokenManager, ApiConfig.API_BASE_URL);
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

export const tokenManager = factory.tokenManager;
export const httpClient = factory.httpClient;
export const authService = factory.authService;
export const projectService = factory.projectService;
export const fileUploadService = factory.fileUploadService;
export const profileService = factory.profileService;
export const analyticsService = factory.analyticsService;
