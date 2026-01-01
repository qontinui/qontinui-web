import { TokenStorage } from "./auth/token-storage";
import { TokenValidator } from "./auth/token-validator";
import { TokenManager } from "./auth/token-manager";
import { TokenRefreshService } from "./auth/token-refresh-service";
import { AuthService } from "./auth/auth-service";
import { HttpClient } from "./http-client";
import { ProjectService } from "./project-service";
import { FileUploadService } from "./file-upload-service";
import { ProfileService } from "./profile-service";
import { AnalyticsService } from "./analytics-service";
import { BillingService } from "./billing-service";
import { RunnerService } from "./runner-service";
import { OrganizationService } from "./collaboration/organization-service";
import { ProjectCollaborationService } from "./collaboration/project-collaboration-service";
import { LockService } from "./collaboration/lock-service";
import { CommentService } from "./collaboration/comment-service";
import { ActivityService } from "./collaboration/activity-service";
import { TestingService } from "./testing-service";
import { RecordingService } from "./recording-service";
import { CaptureService } from "./capture-service";
import { CodePackageService } from "./code-package-service";
import { ExtractionService } from "./extraction-service";
import { RAGExportService } from "./rag-export-service";
import { RAGDashboardService } from "./rag-dashboard-service";
import { IssuesService } from "./issues-service";
import { DiscoveriesService } from "./discoveries-service";

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
  public readonly billingService: BillingService;
  public readonly runnerService: RunnerService;
  public readonly organizationService: OrganizationService;
  public readonly projectCollaborationService: ProjectCollaborationService;
  public readonly lockService: LockService;
  public readonly commentService: CommentService;
  public readonly activityService: ActivityService;
  public readonly testingService: TestingService;
  public readonly recordingService: RecordingService;
  public readonly captureService: CaptureService;
  public readonly codePackageService: CodePackageService;
  public readonly extractionService: ExtractionService;
  public readonly ragExportService: RAGExportService;
  public readonly ragDashboardService: RAGDashboardService;
  public readonly issuesService: IssuesService;
  public readonly discoveriesService: DiscoveriesService;

  private constructor() {
    // Initialize auth services in dependency order
    this.tokenStorage = new TokenStorage();
    this.tokenValidator = new TokenValidator();
    this.tokenManager = new TokenManager(
      this.tokenStorage,
      this.tokenValidator
    );
    this.tokenRefreshService = new TokenRefreshService(this.tokenManager);
    this.authService = new AuthService(
      this.tokenManager,
      this.tokenRefreshService
    );

    // Initialize other services
    this.httpClient = new HttpClient(this.tokenManager);
    this.projectService = new ProjectService(this.httpClient);
    this.fileUploadService = new FileUploadService(this.tokenManager);
    this.profileService = new ProfileService(this.httpClient);
    this.analyticsService = new AnalyticsService(this.httpClient);
    this.billingService = new BillingService(this.httpClient);
    this.runnerService = new RunnerService(this.httpClient);

    // Initialize collaboration services
    this.organizationService = new OrganizationService(this.httpClient);
    this.projectCollaborationService = new ProjectCollaborationService(
      this.httpClient
    );
    this.lockService = new LockService(this.httpClient);
    this.commentService = new CommentService(this.httpClient);
    this.activityService = new ActivityService(this.httpClient);

    // Initialize testing service
    this.testingService = new TestingService(this.httpClient);

    // Initialize recording service
    this.recordingService = new RecordingService(this.httpClient);

    // Initialize capture service
    this.captureService = new CaptureService(this.httpClient);

    // Initialize code package service
    this.codePackageService = new CodePackageService(this.httpClient);

    // Initialize extraction service
    this.extractionService = new ExtractionService(this.httpClient);
    this.ragExportService = new RAGExportService(this.httpClient);
    this.ragDashboardService = new RAGDashboardService(this.httpClient);

    // Initialize issues service
    this.issuesService = new IssuesService(this.httpClient);

    // Initialize discoveries service
    this.discoveriesService = new DiscoveriesService(this.httpClient);

    // Wire up session expiry handling for 401 responses
    this.httpClient.setSessionExpiredHandler(() => {
      this.authService.logout();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("session-expired"));
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
export const billingService = factory.billingService;
export const runnerService = factory.runnerService;
export const organizationService = factory.organizationService;
export const projectCollaborationService = factory.projectCollaborationService;
export const lockService = factory.lockService;
export const commentService = factory.commentService;
export const activityService = factory.activityService;
export const testingService = factory.testingService;
export const recordingService = factory.recordingService;
export const captureService = factory.captureService;
export const codePackageService = factory.codePackageService;
export const extractionService = factory.extractionService;
export const ragExportService = factory.ragExportService;
export const ragDashboardService = factory.ragDashboardService;
export const issuesService = factory.issuesService;
export const discoveriesService = factory.discoveriesService;
