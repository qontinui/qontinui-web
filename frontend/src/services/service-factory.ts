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
import type { BillingService } from "./billing-service";
import { RunnerService } from "./runner-service";
import type { OrganizationService } from "./collaboration/organization-service";
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
import { TaskRunsService } from "./task-runs-service";
import { TemplateCaptureService } from "./template-capture-service";
import { StateMachineConfigService } from "./state-machine-config-service";
import { SkillSharingService } from "./skill-sharing-service";
import { getService } from "@/lib/extension-slots";

/**
 * Build a Proxy that forwards method access to whatever cloud-control has
 * registered into `getService(slotName)`. Resolved on each property access,
 * so cloud-control's `registerCloudExtensions` call can land after this
 * Proxy was constructed (no module-load-order coupling). When no service
 * is registered (OSS-only build), method calls throw with a clear message;
 * routes that drive these calls aren't mounted in OSS-only mode anyway.
 */
function cloudOnlySlot<T extends object>(slotName: string): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const svc = getService<T>(slotName);
      if (svc === undefined) {
        return () => {
          throw new Error(
            `${slotName} is only available in the cloud-control deployment ` +
              `(slot '${slotName}' has no registered service)`,
          );
        };
      }
      return Reflect.get(svc as object, prop, receiver);
    },
  });
}

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
  public readonly taskRunsService: TaskRunsService;
  public readonly templateCaptureService: TemplateCaptureService;
  public readonly stateMachineConfigService: StateMachineConfigService;
  public readonly skillSharingService: SkillSharingService;

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
    // billingService / organizationService are slot-backed Proxies — OSS
    // does not instantiate stubs. Cloud-control's `registerCloudExtensions`
    // attaches the real implementations; the Proxy resolves on every method
    // access, so registration order is irrelevant.
    this.billingService = cloudOnlySlot<BillingService>("billingService");
    this.runnerService = new RunnerService(this.httpClient);

    // Initialize collaboration services
    this.organizationService = cloudOnlySlot<OrganizationService>(
      "organizationService"
    );
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

    // Initialize task runs service
    this.taskRunsService = new TaskRunsService(this.httpClient);

    // Initialize template capture service
    this.templateCaptureService = new TemplateCaptureService(this.httpClient);

    // Initialize state machine config service
    this.stateMachineConfigService = new StateMachineConfigService(
      this.httpClient
    );

    // Initialize skill sharing service
    this.skillSharingService = new SkillSharingService(this.httpClient);

    // Wire up session expiry handling for 401 responses.
    //
    // This is a NON-user-initiated teardown, so pass `redirectToCognito=false`:
    // it must clear local state WITHOUT navigating to the Cognito hosted-UI
    // `/logout`. The default (`logout()` → `redirectToCognito=true`) caused a
    // `/login` ⇄ `auth.qontinui.io/logout` ping-pong — on the unauthenticated
    // /login page a background poll 401s → this handler → Cognito `/logout`
    // (logout_uri=/login) → back to /login → 401 → … (~6 navs/sec). That churn
    // cancels the outbound OAuth navigation when the user clicks a sign-in
    // button, so login could never leave /login. The `session-expired` event
    // (handled in auth-context, already /login-guarded) does the routing.
    this.httpClient.setSessionExpiredHandler(() => {
      this.authService.logout(false);
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
export const taskRunsService = factory.taskRunsService;
export const templateCaptureService = factory.templateCaptureService;
export const stateMachineConfigService = factory.stateMachineConfigService;
export const skillSharingService = factory.skillSharingService;
