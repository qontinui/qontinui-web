/**
 * Getting Started Tutorial for Qontinui Web
 *
 * A comprehensive tutorial that walks new users through the basics
 * of creating and managing automation projects in Qontinui.
 */

import type { Tutorial } from "@/types/tutorial";

export const gettingStartedTutorial: Tutorial = {
  id: "getting-started-web",
  title: "Getting Started with Qontinui",
  description:
    "Learn the basics of creating and managing visual automation projects. This tutorial will guide you through the interface and help you create your first automation.",
  duration: "5 minutes",
  estimatedTime: 5,
  difficulty: "beginner",
  mode: "contextual",
  focusPage: "dashboard",
  category: "Getting Started",
  tags: ["basics", "introduction", "first-project", "onboarding"],
  learningObjectives: [
    "Navigate the Qontinui interface",
    "Create a new automation project",
    "Understand the main sections of the app",
    "Learn where to find help and documentation",
  ],
  steps: [
    {
      id: "welcome",
      title: "Welcome to Qontinui!",
      content:
        "Qontinui is a visual automation platform that uses a state machine approach to create robust, maintainable automations.\n\n" +
        "This tutorial will show you around the interface and help you get started with your first project.",
      tips: [
        "You can use keyboard shortcuts: Arrow keys to navigate, Escape to close",
        "Your progress is saved automatically",
      ],
    },
    {
      id: "sidebar-overview",
      title: "The Sidebar",
      content:
        "The sidebar is your main navigation hub. It contains all the tools you need to build and manage your automations.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-main"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
        scrollIntoView: false,
      },
      tips: [
        "You can collapse the sidebar to save space",
        "Hover over collapsed icons to see tooltips",
      ],
    },
    {
      id: "project-switcher",
      title: "Project Switcher",
      content:
        "Use the Project Switcher to switch between your automation projects or create new ones.\n\n" +
        "Click here to see your projects and create new ones.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-project-switcher"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: true,
      },
      action: "Click to open the project menu",
      wait: {
        type: "dom-event",
        event: "click",
        selector: '[data-tutorial-id="sidebar-project-switcher"]',
        timeout: 15000,
        onTimeout: "show-hint",
        hint: "Click on the project switcher to continue",
        advanceDelay: 500,
      },
      interactive: true,
    },
    {
      id: "create-project",
      title: "Create a New Project",
      content:
        "To start automating, you'll need a project. Projects contain all your states, images, workflows, and configurations.\n\n" +
        "Click '+ Create new project' to create your first automation project.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-create-project"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: true,
      },
      action: "Click to create a new project",
      wait: {
        type: "dom-event",
        event: "click",
        selector: '[data-tutorial-id="sidebar-create-project"]',
        timeout: 20000,
        onTimeout: "allow-skip",
        hint: "Click '+ Create new project' or skip to continue",
      },
      interactive: true,
    },
    {
      id: "navigation-build",
      title: "Build Section",
      content:
        "The Build section is where you create your automation logic:\n\n" +
        "• **State Machine** - Define the states your application can be in\n" +
        "• **Workflows** - Create action sequences for automation\n" +
        "• **Variables** - Store configuration values",
      targetElement: {
        selector: '[data-tutorial-id="nav-build"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "navigation-assets",
      title: "Assets Section",
      content:
        "The Assets section manages your visual resources:\n\n" +
        "• **Images** - Pattern images used for recognition\n" +
        "• **Screenshots** - Full screenshots for pattern extraction",
      targetElement: {
        selector: '[data-tutorial-id="nav-assets"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "navigation-create",
      title: "Create Section",
      content:
        "The Create section helps you build pattern images:\n\n" +
        "• **Extract Images** - Cut patterns from screenshots\n" +
        "• **Pattern Extraction** - AI-assisted pattern optimization",
      targetElement: {
        selector: '[data-tutorial-id="nav-create"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "navigation-runners",
      title: "Desktop Runners",
      content:
        "Runners are desktop applications that execute your automations.\n\n" +
        "You'll need to install and connect a runner to run your automations on your computer.",
      targetElement: {
        selector: '[data-tutorial-id="nav-runners"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
      tips: [
        "Download the runner from the Connect Runner page",
        "Runners can be connected to multiple projects",
      ],
    },
    {
      id: "help-button",
      title: "Help & Tutorials",
      content:
        "Click here anytime to restart this tutorial or access other help resources.\n\n" +
        "You can also find documentation and community support through this menu.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-help"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "complete",
      title: "You're Ready to Go!",
      content:
        "Congratulations! You now know the basics of the Qontinui interface.\n\n" +
        "**Next steps:**\n" +
        "1. Create a project if you haven't already\n" +
        "2. Upload some screenshots of the application you want to automate\n" +
        "3. Extract pattern images from your screenshots\n" +
        "4. Define states and build your automation logic\n\n" +
        "Happy automating!",
      tips: [
        "Check out the documentation for more detailed guides",
        "Join our community for help and inspiration",
      ],
    },
  ],
};

/**
 * Quick tour for returning users
 */
export const quickTourTutorial: Tutorial = {
  id: "quick-tour",
  title: "Quick Tour",
  description: "A quick refresher on the Qontinui interface.",
  duration: "2 minutes",
  estimatedTime: 2,
  difficulty: "beginner",
  mode: "contextual",
  focusPage: "dashboard",
  category: "Getting Started",
  tags: ["basics", "refresher"],
  steps: [
    {
      id: "sidebar",
      title: "Navigation",
      content: "Use the sidebar to navigate between different sections of the app.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-nav"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "projects",
      title: "Projects",
      content: "Switch between projects or create new ones using the project switcher.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-project-switcher"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "help",
      title: "Need Help?",
      content: "Click here anytime to access tutorials and documentation.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-help"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
  ],
};
