import { QontinuiConfig } from "./export-schema";

/**
 * Pre-built configuration templates for common automation scenarios
 */
export class ConfigTemplates {
  /**
   * Basic game automation template
   */
  static gameAutomation(): Partial<QontinuiConfig> {
    return {
      version: "1.0.0",
      metadata: {
        name: "Game Automation Template",
        description:
          "Basic template for game automation with menu navigation and gameplay states",
        tags: ["game", "automation", "template"],
        targetApplication: "Game",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
      states: [
        {
          id: "main-menu",
          name: "Main Menu",
          description: "Game main menu screen",
          stateImages: [],
          position: { x: 100, y: 100 },
          isInitial: true,
        },
        {
          id: "gameplay",
          name: "Gameplay",
          description: "Active gameplay state",
          stateImages: [],
          position: { x: 400, y: 100 },
        },
        {
          id: "inventory",
          name: "Inventory",
          description: "Inventory management screen",
          stateImages: [],
          position: { x: 250, y: 300 },
        },
        {
          id: "battle",
          name: "Battle",
          description: "Combat/battle state",
          stateImages: [],
          position: { x: 550, y: 300 },
        },
      ],
      workflows: [
        {
          id: "start-game",
          name: "Start Game",
          description: "Click play button to start game",
          type: "sequence",
          actions: [
            {
              id: "find-play-btn",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.9,
                },
              },
              timeout: 5000,
              retryCount: 3,
            },
            {
              id: "click-play-btn",
              type: "CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
          ],
        },
        {
          id: "open-inventory",
          name: "Open Inventory",
          description: "Press key to open inventory",
          type: "sequence",
          actions: [
            {
              id: "press-i-key",
              type: "KEY_PRESS",
              config: {
                keys: ["i"],
              },
              timeout: 500,
              retryCount: 1,
            },
          ],
        },
      ],
      transitions: [
        {
          id: "menu-to-game",
          type: "OutgoingTransition",
          name: "Start Game",
          workflows: ["start-game"],
          fromState: "main-menu",
          toState: "gameplay",
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
          timeout: 10000,
          retryCount: 3,
        },
        {
          id: "game-to-inventory",
          type: "OutgoingTransition",
          name: "Open Inventory",
          workflows: ["open-inventory"],
          fromState: "gameplay",
          toState: "inventory",
          staysVisible: true,
          activateStates: [],
          deactivateStates: [],
          timeout: 5000,
          retryCount: 2,
        },
      ],
      images: [],
      settings: {
        execution: {
          defaultTimeout: 10000,
          defaultRetryCount: 3,
          actionDelay: 500,
          failureStrategy: "stop",
          headless: false,
        },
        recognition: {
          defaultThreshold: 0.9,
          searchAlgorithm: "template_matching",
          multiScaleSearch: true,
          colorSpace: "rgb",
          edgeDetection: false,
          ocrEnabled: false,
        },
        logging: {
          level: "info",
          screenshotOnError: true,
          consoleOutput: true,
          detailedMatching: false,
        },
        performance: {
          maxParallelActions: 1,
          cacheImages: true,
          optimizeSearch: true,
        },
      },
    };
  }

  /**
   * Web application automation template
   */
  static webAutomation(): Partial<QontinuiConfig> {
    return {
      version: "1.0.0",
      metadata: {
        name: "Web Application Automation",
        description:
          "Template for automating web applications with login and navigation",
        tags: ["web", "browser", "automation"],
        targetApplication: "Web Browser",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
      states: [
        {
          id: "login-page",
          name: "Login Page",
          description: "Application login screen",
          stateImages: [],
          position: { x: 100, y: 100 },
          isInitial: true,
        },
        {
          id: "dashboard",
          name: "Dashboard",
          description: "Main dashboard after login",
          stateImages: [],
          position: { x: 400, y: 100 },
        },
        {
          id: "form-page",
          name: "Form Page",
          description: "Data entry form",
          stateImages: [],
          position: { x: 400, y: 300 },
        },
      ],
      workflows: [
        {
          id: "login-process",
          name: "Login",
          description: "Enter credentials and login",
          type: "sequence",
          actions: [
            {
              id: "find-username",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.95,
                },
              },
              timeout: 5000,
              retryCount: 3,
            },
            {
              id: "click-username",
              type: "CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
            {
              id: "type-username",
              type: "TYPE",
              config: {
                text: "${username}",
              },
              timeout: 2000,
              retryCount: 1,
            },
            {
              id: "tab-to-password",
              type: "KEY_PRESS",
              config: {
                keys: ["tab"],
              },
              timeout: 500,
              retryCount: 1,
            },
            {
              id: "type-password",
              type: "TYPE",
              config: {
                text: "${password}",
              },
              timeout: 2000,
              retryCount: 1,
            },
            {
              id: "submit-login",
              type: "KEY_PRESS",
              config: {
                keys: ["enter"],
              },
              timeout: 500,
              retryCount: 1,
            },
          ],
        },
        {
          id: "fill-form",
          name: "Fill Form",
          description: "Automated form filling",
          type: "sequence",
          actions: [
            {
              id: "find-field1",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.9,
                },
              },
              timeout: 3000,
              retryCount: 2,
            },
            {
              id: "click-field1",
              type: "CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
            {
              id: "type-field1",
              type: "TYPE",
              config: {
                text: "${field1_value}",
              },
              timeout: 2000,
              retryCount: 1,
            },
          ],
        },
      ],
      transitions: [
        {
          id: "login-to-dashboard",
          type: "OutgoingTransition",
          name: "Login",
          workflows: ["login-process"],
          fromState: "login-page",
          toState: "dashboard",
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
          timeout: 15000,
          retryCount: 2,
        },
      ],
      images: [],
      settings: {
        execution: {
          defaultTimeout: 10000,
          defaultRetryCount: 2,
          actionDelay: 200,
          failureStrategy: "pause",
          headless: false,
        },
        recognition: {
          defaultThreshold: 0.95,
          searchAlgorithm: "template_matching",
          multiScaleSearch: false,
          colorSpace: "rgb",
          edgeDetection: false,
          ocrEnabled: true,
          ocrLanguage: "eng",
        },
        logging: {
          level: "debug",
          screenshotOnError: true,
          consoleOutput: true,
          detailedMatching: true,
        },
        performance: {
          maxParallelActions: 1,
          cacheImages: true,
          optimizeSearch: false,
        },
      },
    };
  }

  /**
   * Desktop application automation template
   */
  static desktopAutomation(): Partial<QontinuiConfig> {
    return {
      version: "1.0.0",
      metadata: {
        name: "Desktop Application Automation",
        description: "Template for automating desktop applications",
        tags: ["desktop", "application", "automation"],
        targetApplication: "Desktop Application",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
      states: [
        {
          id: "app-closed",
          name: "Application Closed",
          description: "Application is not running",
          stateImages: [],
          position: { x: 100, y: 100 },
          isInitial: true,
        },
        {
          id: "app-main",
          name: "Main Window",
          description: "Application main window",
          stateImages: [],
          position: { x: 400, y: 100 },
        },
        {
          id: "file-dialog",
          name: "File Dialog",
          description: "File open/save dialog",
          stateImages: [],
          position: { x: 250, y: 300 },
        },
        {
          id: "settings",
          name: "Settings",
          description: "Application settings window",
          stateImages: [],
          position: { x: 550, y: 300 },
        },
      ],
      workflows: [
        {
          id: "launch-app",
          name: "Launch Application",
          description: "Start the application",
          type: "sequence",
          actions: [
            {
              id: "find-desktop-icon",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.9,
                },
              },
              timeout: 5000,
              retryCount: 3,
            },
            {
              id: "double-click-icon",
              type: "DOUBLE_CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
            {
              id: "wait-for-launch",
              type: "WAIT",
              config: {
                duration: 3000,
              },
              timeout: 3000,
              retryCount: 1,
            },
          ],
        },
        {
          id: "open-file",
          name: "Open File",
          description: "Open file via menu",
          type: "sequence",
          actions: [
            {
              id: "press-ctrl-o",
              type: "KEY_PRESS",
              config: {
                keys: ["ctrl", "o"],
              },
              timeout: 500,
              retryCount: 1,
            },
          ],
        },
        {
          id: "save-file",
          name: "Save File",
          description: "Save current file",
          type: "sequence",
          actions: [
            {
              id: "press-ctrl-s",
              type: "KEY_PRESS",
              config: {
                keys: ["ctrl", "s"],
              },
              timeout: 500,
              retryCount: 1,
            },
          ],
        },
      ],
      transitions: [
        {
          id: "launch-app-transition",
          type: "OutgoingTransition",
          name: "Launch Application",
          workflows: ["launch-app"],
          fromState: "app-closed",
          toState: "app-main",
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
          timeout: 10000,
          retryCount: 2,
        },
        {
          id: "open-file-dialog",
          type: "OutgoingTransition",
          name: "Open File Dialog",
          workflows: ["open-file"],
          fromState: "app-main",
          toState: "file-dialog",
          staysVisible: true,
          activateStates: [],
          deactivateStates: [],
          timeout: 5000,
          retryCount: 2,
        },
      ],
      images: [],
      settings: {
        execution: {
          defaultTimeout: 8000,
          defaultRetryCount: 2,
          actionDelay: 300,
          failureStrategy: "stop",
          headless: false,
        },
        recognition: {
          defaultThreshold: 0.9,
          searchAlgorithm: "template_matching",
          multiScaleSearch: true,
          colorSpace: "rgb",
          edgeDetection: false,
          ocrEnabled: false,
        },
        logging: {
          level: "info",
          screenshotOnError: true,
          consoleOutput: true,
          detailedMatching: false,
        },
        performance: {
          maxParallelActions: 1,
          cacheImages: true,
          optimizeSearch: true,
        },
      },
    };
  }

  /**
   * Data extraction automation template
   */
  static dataExtraction(): Partial<QontinuiConfig> {
    return {
      version: "1.0.0",
      metadata: {
        name: "Data Extraction Automation",
        description: "Template for extracting data from applications",
        tags: ["data", "extraction", "scraping"],
        targetApplication: "Any Application",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
      },
      states: [
        {
          id: "data-list",
          name: "Data List",
          description: "List view with data to extract",
          stateImages: [],
          position: { x: 100, y: 100 },
          isInitial: true,
        },
        {
          id: "detail-view",
          name: "Detail View",
          description: "Detailed view of single item",
          stateImages: [],
          position: { x: 400, y: 100 },
        },
        {
          id: "export-dialog",
          name: "Export Dialog",
          description: "Export/save dialog",
          stateImages: [],
          position: { x: 250, y: 300 },
        },
      ],
      workflows: [
        {
          id: "select-item",
          name: "Select Item",
          description: "Select next item from list",
          type: "sequence",
          actions: [
            {
              id: "find-next-item",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.85,
                },
              },
              timeout: 3000,
              retryCount: 2,
            },
            {
              id: "click-item",
              type: "CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
          ],
        },
        {
          id: "extract-data",
          name: "Extract Data",
          description: "Extract data from current view",
          type: "sequence",
          actions: [
            {
              id: "screenshot-data",
              type: "SCREENSHOT",
              config: {
                target: {
                  type: "region",
                  region: {
                    x: 100,
                    y: 100,
                    width: 800,
                    height: 600,
                  },
                },
              },
              timeout: 1000,
              retryCount: 1,
            },
            {
              id: "select-all",
              type: "KEY_PRESS",
              config: {
                keys: ["ctrl", "a"],
              },
              timeout: 500,
              retryCount: 1,
            },
            {
              id: "copy-data",
              type: "KEY_PRESS",
              config: {
                keys: ["ctrl", "c"],
              },
              timeout: 500,
              retryCount: 1,
            },
          ],
        },
        {
          id: "next-page",
          name: "Next Page",
          description: "Navigate to next page of results",
          type: "sequence",
          actions: [
            {
              id: "find-next-button",
              type: "FIND",
              config: {
                target: {
                  type: "image",
                  threshold: 0.9,
                },
              },
              timeout: 3000,
              retryCount: 2,
            },
            {
              id: "click-next",
              type: "CLICK",
              config: {},
              timeout: 1000,
              retryCount: 1,
            },
            {
              id: "wait-for-load",
              type: "WAIT",
              config: {
                duration: 2000,
              },
              timeout: 2000,
              retryCount: 1,
            },
          ],
        },
      ],
      transitions: [
        {
          id: "list-to-detail",
          type: "OutgoingTransition",
          name: "View Details",
          workflows: ["select-item"],
          fromState: "data-list",
          toState: "detail-view",
          staysVisible: false,
          activateStates: [],
          deactivateStates: [],
          timeout: 5000,
          retryCount: 2,
        },
        {
          id: "extract-and-return",
          type: "IncomingTransition",
          name: "Extract Data",
          workflows: ["extract-data"],
          toState: "detail-view",
          timeout: 5000,
          retryCount: 1,
        },
      ],
      images: [],
      settings: {
        execution: {
          defaultTimeout: 5000,
          defaultRetryCount: 2,
          actionDelay: 500,
          failureStrategy: "continue",
          headless: false,
        },
        recognition: {
          defaultThreshold: 0.85,
          searchAlgorithm: "template_matching",
          multiScaleSearch: false,
          colorSpace: "rgb",
          edgeDetection: false,
          ocrEnabled: true,
          ocrLanguage: "eng",
        },
        logging: {
          level: "debug",
          screenshotOnError: true,
          logFile: "extraction.log",
          consoleOutput: true,
          detailedMatching: true,
        },
        performance: {
          maxParallelActions: 1,
          cacheImages: false,
          optimizeSearch: false,
        },
      },
    };
  }

  /**
   * Get all available templates
   */
  static getAllTemplates(): Array<{
    id: string;
    name: string;
    description: string;
    generator: () => Partial<QontinuiConfig>;
  }> {
    return [
      {
        id: "game-automation",
        name: "Game Automation",
        description:
          "Template for automating games with menu navigation and gameplay states",
        generator: this.gameAutomation,
      },
      {
        id: "web-automation",
        name: "Web Application",
        description:
          "Template for automating web applications with login and navigation",
        generator: this.webAutomation,
      },
      {
        id: "desktop-automation",
        name: "Desktop Application",
        description: "Template for automating desktop applications",
        generator: this.desktopAutomation,
      },
      {
        id: "data-extraction",
        name: "Data Extraction",
        description: "Template for extracting data from applications",
        generator: this.dataExtraction,
      },
    ];
  }

  /**
   * Apply template to current configuration
   */
  static applyTemplate(templateId: string): Partial<QontinuiConfig> | null {
    const template = this.getAllTemplates().find((t) => t.id === templateId);
    return template ? template.generator() : null;
  }
}
