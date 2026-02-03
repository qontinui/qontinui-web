/**
 * Onboarding Tour Tutorial
 *
 * Migrated from the legacy OnboardingTour component.
 * Walks new users through the main UI elements.
 */

import type { Tutorial } from "@/types/tutorial";

export const onboardingTourTutorial: Tutorial = {
  id: "onboarding-tour",
  title: "Welcome to Qontinui!",
  description:
    "A quick tour to help you get started with building visual automation workflows.",
  duration: "3 minutes",
  estimatedTime: 3,
  difficulty: "beginner",
  mode: "contextual",
  focusPage: "projects",
  category: "Getting Started",
  tags: ["basics", "introduction", "onboarding", "tour"],
  learningObjectives: [
    "Understand the main areas of the interface",
    "Learn how to create a new project",
    "Discover where to find key features",
  ],
  steps: [
    {
      id: "welcome",
      title: "Welcome to Qontinui!",
      content:
        "Let's take a quick tour to help you get started with building visual automation workflows.\n\n" +
        "Qontinui uses a state machine approach to create robust, maintainable automations.",
      tips: [
        "Use arrow keys to navigate the tour",
        "Press Escape to close at any time",
      ],
    },
    {
      id: "sidebar-overview",
      title: "Navigation Sidebar",
      content:
        "The sidebar is your main navigation hub. It contains all the tools you need to build and manage your automations.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-main"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
        scrollIntoView: false,
      },
    },
    {
      id: "project-switcher",
      title: "Project Switcher",
      content:
        "Use the Project Switcher to switch between your automation projects.\n\n" +
        "Each project contains a state machine that defines your workflow.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-project-switcher"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "create-project",
      title: "Create Your First Project",
      content:
        "Click here to create a new automation project. Projects contain all your states, images, workflows, and configurations.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-create-project"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: true,
      },
      action: "Click to create a new project",
    },
    {
      id: "build-section",
      title: "Build Your Workflow",
      content:
        "The Build section is where you design your automation:\n\n" +
        "- **State Machine** - Define states and connect them with transitions\n" +
        "- **Workflows** - Create action sequences\n" +
        "- **Variables** - Store configuration values",
      targetElement: {
        selector: '[data-tutorial-id="nav-build"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "assets-section",
      title: "Manage Assets",
      content:
        "The Assets section manages your visual resources:\n\n" +
        "- **Images** - Pattern images for recognition\n" +
        "- **Screenshots** - Full screenshots for pattern extraction",
      targetElement: {
        selector: '[data-tutorial-id="nav-assets"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "create-section",
      title: "Create Pattern Images",
      content:
        "Use the Create section to build pattern images from screenshots.\n\n" +
        "The automation will find and interact with these elements on screen.",
      targetElement: {
        selector: '[data-tutorial-id="nav-create"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "runners-section",
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
        "Export your project configuration to use with the runner",
      ],
    },
    {
      id: "help-section",
      title: "Need Help?",
      content:
        "Click here anytime to restart this tour or access other tutorials and documentation.",
      targetElement: {
        selector: '[data-tutorial-id="sidebar-help"]',
        highlightType: "spotlight",
        position: "right",
        allowInteraction: false,
      },
    },
    {
      id: "complete",
      title: "You're Ready!",
      content:
        "You now know the basics of the Qontinui interface.\n\n" +
        "**Next steps:**\n" +
        "1. Create a new project\n" +
        "2. Upload screenshots of the app you want to automate\n" +
        "3. Extract pattern images\n" +
        "4. Build your state machine\n" +
        "5. Connect a runner and start automating!\n\n" +
        "Happy automating!",
      tips: [
        "Check the Help menu for more detailed tutorials",
        "Join our community for tips and inspiration",
      ],
    },
  ],
};
