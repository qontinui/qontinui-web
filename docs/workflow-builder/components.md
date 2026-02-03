# Reusable Workflow Components

This guide covers creating and managing reusable workflow components (subflows) with parameterization and versioning.

## Table of Contents

- [Overview](#overview)
- [Creating Components](#creating-components)
- [Component Parameters](#component-parameters)
- [Using Components](#using-components)
- [Component Library](#component-library)
- [Versioning](#versioning)
- [Best Practices](#best-practices)

## Overview

The Workflow Components Service enables you to create reusable workflow fragments (subflows) that can be parameterized and shared across multiple workflows. Think of components as functions in programming - they encapsulate logic and can be called with different parameters.

### Key Features

- Create reusable workflow components
- Parameterize components with inputs/outputs
- Version control for components
- Built-in component library
- Component sharing and export
- Parameter validation
- Usage tracking

## Creating Components

### From Workflow Actions

```typescript
import { workflowComponentsService } from '@/services/workflow-components-service';

// Create a component from selected actions
const component = workflowComponentsService.createComponent({
  name: 'Login',
  description: 'Handles user login with username and password',
  category: 'Authentication',
  actions: selectedActions,  // Array of Action objects
  parameters: [
    {
      name: 'username',
      type: 'string',
      description: 'User login name',
      required: true
    },
    {
      name: 'password',
      type: 'string',
      description: 'User password',
      required: true,
      sensitive: true
    }
  ],
  outputs: [
    {
      name: 'sessionToken',
      type: 'string',
      description: 'Authentication token'
    },
    {
      name: 'userId',
      type: 'string',
      description: 'Unique user identifier'
    }
  ]
});
```

### Component Structure

```typescript
interface SubflowComponent {
  id: string;
  name: string;
  description: string;
  category: string;

  // Component workflow definition
  actions: Action[];
  connections: Connections;

  // Parameters
  parameters: ComponentParameter[];
  outputs: ComponentOutput[];

  // Metadata
  version: string;
  createdAt: string;
  updatedAt: string;
  author?: string;
  tags?: string[];

  // Usage tracking
  usageCount?: number;
  lastUsed?: string;
}
```

### Component Categories

```typescript
// Common component categories
const categories = {
  authentication: 'Authentication',
  validation: 'Data Validation',
  navigation: 'Page Navigation',
  forms: 'Form Handling',
  api: 'API Interactions',
  dataSetup: 'Data Setup',
  cleanup: 'Cleanup Operations',
  assertions: 'Assertions & Checks',
  utilities: 'Utilities'
};
```

## Component Parameters

### Parameter Types

```typescript
interface ComponentParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  defaultValue?: any;
  sensitive?: boolean;      // For passwords, tokens, etc.
  validation?: {
    pattern?: string;       // Regex pattern
    min?: number;          // Min value/length
    max?: number;          // Max value/length
    enum?: any[];          // Allowed values
  };
}
```

### Define Parameters

```typescript
// Example: Search component with parameters
const searchComponent = workflowComponentsService.createComponent({
  name: 'Search Products',
  description: 'Searches for products with filters',
  category: 'Search',
  actions: searchActions,
  parameters: [
    {
      name: 'query',
      type: 'string',
      description: 'Search query text',
      required: true,
      validation: {
        min: 1,
        max: 100
      }
    },
    {
      name: 'category',
      type: 'string',
      description: 'Product category filter',
      required: false,
      validation: {
        enum: ['Electronics', 'Clothing', 'Books', 'Home']
      }
    },
    {
      name: 'maxResults',
      type: 'number',
      description: 'Maximum number of results',
      required: false,
      defaultValue: 10,
      validation: {
        min: 1,
        max: 100
      }
    },
    {
      name: 'sortBy',
      type: 'string',
      description: 'Sort order',
      required: false,
      defaultValue: 'relevance',
      validation: {
        enum: ['relevance', 'price-low', 'price-high', 'newest']
      }
    }
  ],
  outputs: [
    {
      name: 'results',
      type: 'array',
      description: 'Search results'
    },
    {
      name: 'totalCount',
      type: 'number',
      description: 'Total number of matching products'
    }
  ]
});
```

### Parameter Mapping

When using a component, map workflow variables to component parameters:

```typescript
// Map workflow variables to component parameters
const parameterMapping = {
  query: '{{searchText}}',           // From workflow variable
  category: 'Electronics',            // Static value
  maxResults: '{{resultsPerPage}}',  // From workflow variable
  sortBy: 'price-low'                // Static value
};
```

## Using Components

### Insert Component into Workflow

```typescript
// Get component
const component = workflowComponentsService.getComponent(componentId);

if (!component) {
  throw new Error('Component not found');
}

// Insert into workflow with parameter mapping
const insertedActions = workflowComponentsService.insertComponent(
  workflow,
  component,
  {
    username: '{{currentUser}}',
    password: '{{userPassword}}'
  },
  insertPosition
);

// The component's actions are now part of your workflow
// with parameters replaced by your values
```

### Component Instantiation

```typescript
// Create a component instance (reference)
const instance = workflowComponentsService.createComponentInstance({
  componentId: component.id,
  parameterValues: {
    username: '{{testUsername}}',
    password: '{{testPassword}}'
  },
  position: [100, 200]
});

// Add to workflow
workflow.actions.push(instance.action);
```

### Parameter Validation

```typescript
// Validate parameters before using component
const validation = workflowComponentsService.validateParameters(
  component,
  {
    username: 'john.doe',
    password: ''  // Missing required parameter
  }
);

if (!validation.valid) {
  console.error('Invalid parameters:');
  validation.errors.forEach(error => {
    console.error(`- ${error.parameter}: ${error.message}`);
  });
}
```

## Component Library

### Built-in Components

The system includes a library of common components:

```typescript
// Get all built-in components
const builtInComponents = workflowComponentsService.getBuiltInComponents();

builtInComponents.forEach(component => {
  console.log(`${component.name} (${component.category})`);
  console.log(`  ${component.description}`);
});
```

### Common Built-in Components

#### 1. Login Component

```typescript
{
  name: 'Login',
  category: 'Authentication',
  parameters: [
    { name: 'username', type: 'string', required: true },
    { name: 'password', type: 'string', required: true, sensitive: true }
  ],
  outputs: [
    { name: 'sessionToken', type: 'string' },
    { name: 'userId', type: 'string' }
  ]
}
```

#### 2. Form Fill Component

```typescript
{
  name: 'Fill Form',
  category: 'Form Handling',
  parameters: [
    { name: 'formSelector', type: 'string', required: true },
    { name: 'fieldValues', type: 'object', required: true }
  ],
  outputs: [
    { name: 'success', type: 'boolean' }
  ]
}
```

#### 3. API Call Component

```typescript
{
  name: 'API Request',
  category: 'API Interactions',
  parameters: [
    { name: 'url', type: 'string', required: true },
    { name: 'method', type: 'string', required: true },
    { name: 'headers', type: 'object', required: false },
    { name: 'body', type: 'object', required: false },
    { name: 'output_variable', type: 'string', required: false }
  ],
  outputs: [
    { name: 'response', type: 'object' },
    { name: 'statusCode', type: 'number' }
  ]
}
```

**Output Variable (API Request Chaining)**

The `output_variable` parameter enables API request chaining by storing the response body in a variable that subsequent steps can reference using `{{variable_name}}` syntax.

```typescript
// Store entire response
{ output_variable: 'auth_response' }
// Reference in next step: {{auth_response}}

// Extract specific field using JSON path syntax
{ output_variable: 'token.access_token' }
// Extracts $.access_token and stores in variable 'token'
// Reference in next step: {{token}}
```

#### 4. Wait for Element Component

```typescript
{
  name: 'Wait for Element',
  category: 'Utilities',
  parameters: [
    { name: 'selector', type: 'string', required: true },
    { name: 'timeout', type: 'number', required: false, defaultValue: 5000 },
    { name: 'visible', type: 'boolean', required: false, defaultValue: true }
  ],
  outputs: [
    { name: 'found', type: 'boolean' },
    { name: 'element', type: 'object' }
  ]
}
```

### Custom Component Library

```typescript
// Create your own component library
class CustomComponentLibrary {
  private components: Map<string, SubflowComponent> = new Map();

  addComponent(component: SubflowComponent): void {
    this.components.set(component.id, component);
  }

  getComponent(id: string): SubflowComponent | undefined {
    return this.components.get(id);
  }

  getByCategory(category: string): SubflowComponent[] {
    return Array.from(this.components.values())
      .filter(c => c.category === category);
  }

  search(query: string): SubflowComponent[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.components.values()).filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.description.toLowerCase().includes(lowerQuery) ||
      c.tags?.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
}
```

## Versioning

### Component Versions

```typescript
// Create a new version of a component
const newVersion = workflowComponentsService.createComponentVersion({
  componentId: component.id,
  version: '2.0.0',
  changes: 'Added support for OAuth authentication',
  author: 'john.doe@example.com'
});

// Version structure
interface ComponentVersion {
  id: string;
  componentId: string;
  version: string;
  component: SubflowComponent;
  changes: string;
  createdAt: string;
  author?: string;
  deprecated?: boolean;
}
```

### Semantic Versioning

```typescript
// Follow semantic versioning: MAJOR.MINOR.PATCH

// MAJOR version (breaking changes)
// v1.0.0 -> v2.0.0
// - Changed parameter types
// - Removed parameters
// - Changed behavior significantly

// MINOR version (new features, backward compatible)
// v1.0.0 -> v1.1.0
// - Added new optional parameters
// - Added new outputs
// - Enhanced functionality

// PATCH version (bug fixes)
// v1.0.0 -> v1.0.1
// - Fixed bugs
// - Performance improvements
// - Documentation updates
```

### Get Component Version

```typescript
// Get specific version
const version = workflowComponentsService.getComponentVersion(
  componentId,
  '1.0.0'
);

// Get all versions
const versions = workflowComponentsService.getComponentVersions(componentId);

// Get latest version
const latest = workflowComponentsService.getLatestComponentVersion(componentId);
```

### Upgrade Component Instances

```typescript
// Find all instances of a component in workflows
const instances = workflowComponentsService.findComponentInstances(
  componentId,
  workflows
);

// Upgrade to latest version
instances.forEach(instance => {
  workflowComponentsService.upgradeComponentInstance(
    instance.workflowId,
    instance.actionId,
    'latest'
  );
});
```

## Best Practices

### Component Design

```typescript
// ✅ Good: Single responsibility
{
  name: 'Login',
  description: 'Authenticates user',
  // Only handles login logic
}

// ❌ Bad: Multiple responsibilities
{
  name: 'Login and Setup Dashboard',
  description: 'Logs in user and sets up dashboard',
  // Does too much - split into separate components
}
```

### Parameter Naming

```typescript
// ✅ Good: Clear, descriptive names
{
  parameters: [
    { name: 'username', type: 'string' },
    { name: 'password', type: 'string' },
    { name: 'rememberMe', type: 'boolean' }
  ]
}

// ❌ Bad: Vague names
{
  parameters: [
    { name: 'user', type: 'string' },
    { name: 'pass', type: 'string' },
    { name: 'flag', type: 'boolean' }
  ]
}
```

### Component Documentation

```typescript
// Always provide comprehensive documentation
const component = workflowComponentsService.createComponent({
  name: 'Login',
  description: `
Authenticates a user with username and password.

## Usage
This component handles the complete login flow including:
1. Navigate to login page
2. Fill username and password fields
3. Click login button
4. Wait for redirect to dashboard
5. Verify login success

## Parameters
- username: User's login name
- password: User's password (stored securely)

## Outputs
- sessionToken: JWT token for API calls
- userId: Unique identifier for the logged-in user

## Example
\`\`\`
username: "john.doe@example.com"
password: "SecurePass123!"
\`\`\`
  `.trim(),
  // ... rest of component definition
});
```

### Error Handling in Components

```typescript
// Include error handling in component design
const componentWithErrorHandling = {
  name: 'Safe API Call',
  actions: [
    // Try block
    {
      type: 'TRY_CATCH',
      config: {
        tryActions: [
          // API call actions
        ],
        catchActions: [
          // Error handling
          {
            type: 'SET_VARIABLE',
            config: {
              name: 'error',
              value: '{{$error}}'
            }
          }
        ]
      }
    }
  ],
  outputs: [
    { name: 'response', type: 'object' },
    { name: 'error', type: 'string' }
  ]
};
```

### Component Testing

```typescript
// Test components before adding to library
import { workflowTestingService } from '@/services/workflow-testing-service';

// Create test for component
const testCase = workflowTestingService.createTestCase({
  name: 'Test Login Component',
  workflowId: testWorkflowId,
  description: 'Verify login component works with valid credentials',
  setup: {
    variables: {
      username: 'test@example.com',
      password: 'TestPass123'
    }
  },
  assertions: [
    {
      type: 'exists',
      actual: '{{sessionToken}}',
      message: 'Should return session token'
    },
    {
      type: 'exists',
      actual: '{{userId}}',
      message: 'Should return user ID'
    }
  ]
});
```

### Component Catalog

```typescript
// Maintain a searchable component catalog
interface ComponentCatalog {
  categories: Map<string, SubflowComponent[]>;
  tags: Map<string, SubflowComponent[]>;
  search: (query: string) => SubflowComponent[];
  mostUsed: () => SubflowComponent[];
  recentlyAdded: () => SubflowComponent[];
}

// Implementation
class ComponentCatalogImpl implements ComponentCatalog {
  // ... implementation
}

const catalog = new ComponentCatalogImpl();

// Usage
const authComponents = catalog.categories.get('Authentication');
const apiComponents = catalog.tags.get('api');
const searchResults = catalog.search('login');
```

## Advanced Patterns

### Nested Components

```typescript
// Components can use other components
const parentComponent = {
  name: 'Complete User Registration',
  actions: [
    // Fill registration form (component)
    createComponentInstance('fill-registration-form'),

    // Verify email (component)
    createComponentInstance('verify-email'),

    // Complete profile (component)
    createComponentInstance('complete-profile')
  ]
};
```

### Conditional Components

```typescript
// Components with conditional logic
const conditionalComponent = {
  name: 'Smart Login',
  parameters: [
    { name: 'useOAuth', type: 'boolean', defaultValue: false }
  ],
  actions: [
    {
      type: 'IF',
      config: {
        condition: '{{useOAuth}}',
        thenActions: [
          // OAuth login flow
        ],
        elseActions: [
          // Standard login flow
        ]
      }
    }
  ]
};
```

### Component Composition

```typescript
// Build complex workflows from simple components
function buildCheckoutWorkflow(): Workflow {
  return {
    name: 'Complete Checkout',
    actions: [
      // Reusable components
      ...useComponent('add-to-cart', { productId: '{{product}}' }),
      ...useComponent('fill-shipping-info', { address: '{{shippingAddress}}' }),
      ...useComponent('select-payment', { method: '{{paymentMethod}}' }),
      ...useComponent('review-order'),
      ...useComponent('place-order'),
      ...useComponent('verify-confirmation')
    ]
  };
}
```

## Troubleshooting

### Component Not Found

```typescript
// Always check if component exists
const component = workflowComponentsService.getComponent(componentId);

if (!component) {
  console.error('Component not found. Available components:');
  workflowComponentsService.getAllComponents().forEach(c => {
    console.log(`- ${c.name} (${c.id})`);
  });
  return;
}
```

### Parameter Mismatch

```typescript
// Validate parameters before using
const result = workflowComponentsService.validateParameters(component, params);

if (!result.valid) {
  console.error('Parameter validation failed:');
  result.errors.forEach(err => {
    console.error(`- ${err.parameter}: ${err.message}`);
  });
}
```

### Version Conflicts

```typescript
// Handle version conflicts when upgrading
try {
  workflowComponentsService.upgradeComponentInstance(
    workflowId,
    actionId,
    targetVersion
  );
} catch (error) {
  if (error.message.includes('breaking change')) {
    console.warn('Manual migration required due to breaking changes');
    // Show migration guide
  }
}
```

## See Also

- [Testing Guide](./testing.md) - Test your components
- [Version Control](./version-control.md) - Version your components
- [Best Practices](./best-practices.md) - Component design patterns
- [API Reference](./api-reference.md) - Complete API documentation
