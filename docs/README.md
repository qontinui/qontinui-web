# Qontinui Documentation

Welcome to the comprehensive documentation for Qontinui, the advanced workflow automation platform.

## Quick Navigation

### Core Features

Qontinui provides two powerful automation systems:

#### 1. Workflow Builder (Actions & Workflows)

Enterprise-grade features for creating, managing, and optimizing automation workflows.

- **[Workflow Builder Overview](./workflow-builder/README.md)** - Complete overview and getting started guide
- **[Organization & Folders](./workflow-builder/organization.md)** - Hierarchical folder structure with tags and search
- **[Dependencies](./workflow-builder/dependencies.md)** - Analyze workflow relationships and detect circular dependencies
- **[Reusable Components](./workflow-builder/components.md)** - Create modular, parameterized workflow components
- **[Testing Framework](./workflow-builder/testing.md)** - Comprehensive testing with assertions and test suites
- **[Analytics & Metrics](./workflow-builder/analytics.md)** - Track performance metrics and identify bottlenecks
- **[Documentation System](./workflow-builder/documentation.md)** - Auto-generate and maintain workflow documentation
- **[Version Control](./workflow-builder/version-control.md)** - Git-like branches, versions, tags, and merging

#### 2. State Machine (Images, States & Transitions)

Powerful visual state machine builder for complex automation scenarios with large-scale project support.

- **[Image Library](./image-library/README.md)** - Centralized image management (100+ images)
- **[State Builder](./state-builder/README.md)** - Visual state machine builder (50+ states)
- **[Transitions](./transitions/README.md)** - Transition management and validation (100+ transitions)
- **[Project Management](./project-management/README.md)** - Project dashboard and optimization tools
- **[Best Practices](./best-practices/large-projects.md)** - Large project strategies and guidelines

## Image Library & Management

Master image organization and management for large automation projects.

### Image Library
- **[Image Library Overview](./image-library/README.md)** - Centralized image repository
  - Image upload and management
  - Usage tracking across states and workflows
  - Source categorization (uploaded, pattern optimization, extraction, state discovery)
  - Smart deletion protection
  - S3 cloud storage
- **[Image Organization](./image-library/organization.md)** - Organization strategies for 100+ images
  - Naming conventions and best practices
  - Tagging strategies
  - Collections and grouping
  - Search and filters
  - Bulk operations
  - Maintenance workflows

### Key Image Features
- **Centralized Management**: All images in one library
- **Automatic Tracking**: Usage across states and workflows
- **Smart Search**: Filter by name, source, usage, date
- **Cloud Storage**: Scalable S3 storage with presigned URLs
- **Usage Analysis**: Identify unused or overused images

## State Machine & Builder

Build and manage complex state machines visually.

### State Builder
- **[State Builder Overview](./state-builder/README.md)** - Visual state modeling
  - Creating and configuring states
  - StateImages, Regions, Locations, and Strings
  - Visual canvas with auto-layout
  - State validation
  - Usage tracking
- **[State Templates](./state-builder/templates.md)** - Reusable state patterns
  - Built-in templates (login, dashboard, form, dialog, error, loading)
  - Creating custom templates
  - Template best practices
- **[State Organization](./state-builder/organization.md)** - Managing 50+ states
  - Naming conventions
  - Virtual grouping strategies
  - Visual organization on canvas
  - Search and navigation
  - Dependency management
  - Maintenance workflows

### Key State Features
- **Visual Modeling**: Drag-and-drop state machine builder
- **Rich Components**: StateImages, Regions, Locations, Strings
- **State Templates**: Quickly create common patterns
- **Auto-Layout**: Automatic graph organization
- **Relative Positioning**: Responsive to layout changes

## Transitions & Flow

Manage state transitions and navigation logic.

### Transition Management
- **[Transitions Overview](./transitions/README.md)** - Transition types and management
  - Outgoing and Incoming transitions
  - State activation and deactivation
  - Workflow execution during transitions
  - Timeout and retry configuration
  - Bulk operations
- **[Transition Templates](./transitions/templates.md)** - Common transition patterns
  - Navigation, modal, form submission, login, data loading templates
  - Creating custom templates
- **[Transition Validation](./transitions/validation.md)** - Validation and debugging
  - Broken reference detection
  - Circular dependency detection
  - Unreachable state detection
  - Automated fixing

### Key Transition Features
- **Two Types**: Outgoing (from→to) and Incoming (initialization)
- **State Management**: Activate/deactivate states intelligently
- **Workflow Integration**: Execute workflows during transitions
- **Validation**: Detect and fix issues automatically
- **Visual Flow**: See transition relationships on canvas

## Project Management

Tools for managing large automation projects.

### Project Tools
- **[Project Dashboard](./project-management/README.md)** - Overview and health monitoring
  - Project health score (0-100)
  - Resource counts and tracking
  - Issue detection and recommendations
  - Backup and export
- **[Project Optimization](./project-management/optimization.md)** - Keep projects lean
  - Finding unused resources
  - Detecting duplicates
  - Fixing broken references
  - Performance optimization
  - Improving health score
- **[Global Search](./project-management/global-search.md)** - Quick resource access
  - Universal search (Cmd/Ctrl+K)
  - Search operators and filters
  - Searching by resource type
  - Quick actions from search

### Key Project Features
- **Health Monitoring**: Track project health (0-100 score)
- **Resource Tracking**: Monitor all images, states, transitions, workflows
- **Optimization Tools**: Find and fix issues automatically
- **Global Search**: Cmd/Ctrl+K to find anything instantly
- **Export/Import**: Backup and restore projects

## Best Practices

Guidelines for building and maintaining large automation projects.

### Best Practices Guide
- **[Large Projects](./best-practices/large-projects.md)** - Comprehensive best practices
  - Organization strategies for 100+ resources
  - Naming conventions (images, states, transitions, workflows)
  - Folder structure recommendations
  - Performance optimization tips
  - Team collaboration workflows
  - Maintenance schedules (daily, weekly, monthly, quarterly)
  - Common pitfalls and solutions

### Key Best Practices
- **Naming Conventions**: Hierarchical, consistent, descriptive
- **Organization**: Feature-based grouping with prefixes
- **Performance**: Optimize images, simplify states
- **Maintenance**: Regular cleanup (weekly/monthly)
- **Team Collaboration**: Documentation and ownership
- **Validation**: Run before commits

## API Reference

Technical reference for developers.

### API Documentation
- **[Resource Services](./api-reference/resource-services.md)** - Complete API reference
  - Image Service (add, delete, update, find, usage tracking)
  - State Service (CRUD operations, validation)
  - Transition Service (CRUD, validation, circular dependency detection)
  - Project Service (health metrics, export/import)
  - Validation Service (automated validation and fixing)
  - Search Service (global search, query parsing)
  - Complete type definitions and interfaces

### Workflow Builder API
- **[Workflow API Reference](./workflow-builder/api-reference.md)** - Workflow builder APIs
- **[Data Models](./workflow-builder/data-models.md)** - Type definitions and schemas

## Getting Started

### For New Users

**State Machine:**
1. **Start Here**: Read the [Image Library Overview](./image-library/README.md)
2. **Build States**: Learn [State Builder](./state-builder/README.md)
3. **Create Flow**: Master [Transitions](./transitions/README.md)
4. **Follow Best Practices**: [Large Project Guide](./best-practices/large-projects.md)

**Workflow Builder:**
1. **Start Here**: Read the [Workflow Builder Overview](./workflow-builder/README.md)
2. **Learn Organization**: [Organization Guide](./workflow-builder/organization.md)
3. **Try Examples**: [Complete Examples](./workflow-builder/examples.md)
4. **Follow Best Practices**: [Best Practices Guide](./workflow-builder/best-practices.md)

### For Developers

**State Machine:**
1. **API Reference**: [Resource Services API](./api-reference/resource-services.md)
2. **Type Definitions**: See API Reference for complete types
3. **Examples**: Each guide includes code examples

**Workflow Builder:**
1. **API Reference**: [Complete API Documentation](./workflow-builder/api-reference.md)
2. **Data Models**: [Type Definitions](./workflow-builder/data-models.md)
3. **Examples**: [Code Examples](./workflow-builder/examples.md)

### For QA/Test Engineers

1. **Testing Framework**: [Testing Guide](./workflow-builder/testing.md)
2. **Validation**: [Transition Validation](./transitions/validation.md)
3. **Analytics**: [Performance & Metrics](./workflow-builder/analytics.md)

## Documentation Structure

```
docs/
├── README.md (this file)
│
├── image-library/
│   ├── README.md                 # Image library overview
│   └── organization.md           # Organization strategies
│
├── state-builder/
│   ├── README.md                 # State builder overview
│   ├── templates.md              # State templates
│   └── organization.md           # State organization
│
├── transitions/
│   ├── README.md                 # Transition overview
│   ├── templates.md              # Transition templates
│   └── validation.md             # Validation guide
│
├── project-management/
│   ├── README.md                 # Project dashboard
│   ├── optimization.md           # Optimization guide
│   └── global-search.md          # Search features
│
├── best-practices/
│   └── large-projects.md         # Best practices
│
├── api-reference/
│   └── resource-services.md      # API reference
│
└── workflow-builder/
    ├── README.md                 # Overview and getting started
    ├── organization.md           # Folder management
    ├── dependencies.md           # Dependency analysis
    ├── components.md             # Reusable components
    ├── testing.md                # Testing framework
    ├── analytics.md              # Analytics and performance
    ├── documentation.md          # Documentation system
    ├── version-control.md        # Version control
    ├── api-reference.md          # Complete API reference
    ├── data-models.md            # Type definitions
    ├── migration-guide.md        # Migration from legacy
    ├── best-practices.md         # Best practices
    ├── troubleshooting.md        # Troubleshooting guide
    └── examples.md               # Complete examples
```

## Quick Links by Role

### Automation Engineers
- [Image Library](./image-library/README.md) - Manage visual assets
- [State Builder](./state-builder/README.md) - Build state machines
- [Transitions](./transitions/README.md) - Define state flow
- [Best Practices](./best-practices/large-projects.md) - Proven strategies

### Developers
- [API Reference](./api-reference/resource-services.md) - State machine APIs
- [Workflow API](./workflow-builder/api-reference.md) - Workflow APIs
- [Data Models](./workflow-builder/data-models.md) - Type definitions

### QA Engineers
- [Testing Guide](./workflow-builder/testing.md) - Test framework
- [Validation](./transitions/validation.md) - State validation
- [Analytics](./workflow-builder/analytics.md) - Performance metrics

### Project Managers
- [Project Dashboard](./project-management/README.md) - Project overview
- [Optimization](./project-management/optimization.md) - Health monitoring
- [Best Practices](./best-practices/large-projects.md) - Project strategies

## Quick Links by Task

### Setting Up a Project
- [Getting Started - Images](./image-library/README.md#getting-started)
- [Getting Started - States](./state-builder/README.md#getting-started)
- [Organization Strategies](./best-practices/large-projects.md#organization-strategies)
- [Naming Conventions](./best-practices/large-projects.md#naming-conventions)

### Building Automation
- [Uploading Images](./image-library/README.md#uploading-images)
- [Creating States](./state-builder/README.md#creating-your-first-state)
- [Creating Transitions](./transitions/README.md#creating-transitions)
- [Using Templates](./state-builder/templates.md)

### Managing Large Projects
- [Image Organization](./image-library/organization.md)
- [State Organization](./state-builder/organization.md)
- [Global Search](./project-management/global-search.md)
- [Project Optimization](./project-management/optimization.md)

### Maintenance & Optimization
- [Finding Unused Resources](./project-management/optimization.md#finding-unused-resources)
- [Detecting Duplicates](./project-management/optimization.md#detecting-duplicates)
- [Validation](./transitions/validation.md)
- [Performance Tips](./best-practices/large-projects.md#performance-tips)

### Troubleshooting
- [Image Issues](./image-library/README.md#troubleshooting)
- [State Issues](./state-builder/README.md#troubleshooting)
- [Transition Issues](./transitions/README.md#troubleshooting)
- [Workflow Issues](./workflow-builder/troubleshooting.md)

## Feature Comparison

### State Machine vs. Workflow Builder

**Use State Machine when:**
- Modeling application screens/states
- Visual pattern matching needed
- Complex state relationships
- UI-driven automation

**Use Workflow Builder when:**
- Sequential action flows
- Complex logic and branching
- Reusable components needed
- API/service automation

**Use Both when:**
- Complete automation solution
- State transitions trigger workflows
- Workflows navigate between states

## Common Workflows

### Create and Organize Images
1. Upload images: [Upload Guide](./image-library/README.md#uploading-images)
2. Organize with naming: [Naming Guide](./image-library/organization.md#naming-conventions)
3. Track usage: [Usage Tracking](./image-library/README.md#usage-tracking)
4. Maintain library: [Maintenance](./image-library/organization.md#maintenance-workflows)

### Build a State Machine
1. Create states: [State Creation](./state-builder/README.md#creating-your-first-state)
2. Add StateImages: [StateImages](./state-builder/README.md#stateimages)
3. Create transitions: [Transitions](./transitions/README.md#creating-transitions)
4. Validate: [Validation](./transitions/validation.md)
5. Test: [Testing](./workflow-builder/testing.md)

### Optimize a Large Project
1. Check health: [Health Metrics](./project-management/README.md#health-monitoring)
2. Find unused resources: [Unused Resources](./project-management/optimization.md#finding-unused-resources)
3. Fix broken references: [Broken References](./project-management/optimization.md#fixing-broken-references)
4. Optimize performance: [Performance](./project-management/optimization.md#performance-optimization)
5. Re-validate: [Validation](./transitions/validation.md#running-validation)

### Manage Team Collaboration
1. Establish conventions: [Naming Conventions](./best-practices/large-projects.md#naming-conventions)
2. Document standards: [Documentation](./best-practices/large-projects.md#team-collaboration)
3. Regular maintenance: [Maintenance](./best-practices/large-projects.md#maintenance)
4. Code reviews: [Team Workflows](./best-practices/large-projects.md#team-workflows)

## Support & Resources

### Getting Help

- **Image Library**: [Troubleshooting](./image-library/README.md#troubleshooting)
- **State Builder**: [Troubleshooting](./state-builder/README.md#troubleshooting)
- **Transitions**: [Troubleshooting](./transitions/README.md#troubleshooting)
- **Workflows**: [Troubleshooting Guide](./workflow-builder/troubleshooting.md)

### Additional Resources

- **Best Practices**: [Large Projects](./best-practices/large-projects.md)
- **API Reference**: [Complete API Docs](./api-reference/resource-services.md)
- **Examples**: [Workflow Examples](./workflow-builder/examples.md)

## Keyboard Shortcuts

### Global
- `Cmd/Ctrl + K`: Open global search
- `Cmd/Ctrl + S`: Save project
- `Cmd/Ctrl + Z`: Undo
- `Cmd/Ctrl + Shift + Z`: Redo

### State Builder
- `Ctrl/Cmd + Click`: Multi-select states
- `Delete`: Delete selected state
- `F`: Fit view to all states
- `Arrow Keys`: Nudge selected state

### Image Library
- `Ctrl/Cmd + F`: Focus search
- `Ctrl/Cmd + U`: Upload images
- `Delete`: Delete selected image (with confirmation)

## Feedback & Contributions

We welcome feedback and contributions to improve this documentation. If you:

- Find errors or outdated information
- Have suggestions for improvements
- Want to contribute examples
- Need clarification on any topic

Please reach out to the development team or create an issue in the project repository.

## Version History

- **v2.0.0** (2025-01-14) - Added comprehensive State Machine documentation
  - Image Library guides
  - State Builder guides
  - Transition management guides
  - Project management guides
  - Best practices for large projects
  - Complete API reference

- **v1.0.0** (2024-01-15) - Initial Workflow Builder documentation release
  - Complete API reference
  - All feature guides
  - Migration guide
  - Best practices
  - Troubleshooting guide
  - Examples

---

**Last Updated:** 2025-01-14
**Documentation Version:** 2.0.0
**Qontinui Version:** 2.0.0

