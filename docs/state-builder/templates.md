# State Templates

Comprehensive guide for using and creating state templates to accelerate state creation and ensure consistency across your automation project.

## Table of Contents

- [Overview](#overview)
- [Built-in Templates](#built-in-templates)
- [Using Templates](#using-templates)
- [Creating Custom Templates](#creating-custom-templates)
- [Template Best Practices](#template-best-practices)
- [Template Library](#template-library)
- [Examples](#examples)

## Overview

State templates are pre-configured state structures that can be quickly instantiated and customized. They save time and ensure consistency when creating similar states.

### Benefits of Templates

- **Speed**: Create states 10x faster
- **Consistency**: Ensure uniform structure
- **Best Practices**: Encode proven patterns
- **Reduce Errors**: Pre-validated configurations
- **Onboarding**: Help new team members

### When to Use Templates

Use templates when:
- Creating multiple similar states (login, forms, dialogs)
- Starting a new feature area
- Standardizing across the project
- Onboarding new developers
- Implementing design patterns

## Built-in Templates

### Basic State Template

Minimal state with standard setup:

```typescript
{
  name: "Basic State",
  description: "Empty state ready for customization",
  initial: false,
  stateImages: [],
  regions: [],
  locations: [],
  strings: [],
  position: { x: 0, y: 0 }
}
```

**Use for:**
- Quick state creation
- Custom state structures
- Prototyping

**Customization needed:**
- Add StateImages
- Define regions/locations
- Set name and description

### Login Screen Template

Standard authentication screen:

```typescript
{
  name: "Login Screen",
  description: "User authentication page",
  initial: false,
  stateImages: [
    {
      name: "Company Logo",
      patterns: [],
      shared: true
    },
    {
      name: "Login Form Background",
      patterns: [],
      shared: false
    },
    {
      name: "Submit Button",
      patterns: [],
      shared: false
    }
  ],
  regions: [
    {
      name: "Form Container",
      x: 100,
      y: 100,
      width: 400,
      height: 500,
      isSearchRegion: true
    }
  ],
  locations: [
    {
      name: "Username Field",
      x: 300,
      y: 200,
      fixed: false,
      anchor: false
    },
    {
      name: "Password Field",
      x: 300,
      y: 280,
      fixed: false,
      anchor: false
    }
  ],
  strings: [
    {
      name: "Username",
      value: "",
      inputText: true
    },
    {
      name: "Password",
      value: "",
      inputText: true
    },
    {
      name: "Login Title",
      value: "Sign In",
      identifier: true
    }
  ]
}
```

**Use for:**
- Login pages
- Signup pages
- Authentication screens

**Customization needed:**
- Link StateImages to actual images
- Adjust coordinates
- Update string values

### Dashboard Template

Application main screen:

```typescript
{
  name: "Dashboard",
  description: "Main application dashboard",
  initial: false,
  stateImages: [
    {
      name: "Dashboard Icon",
      patterns: [],
      shared: true
    }
  ],
  regions: [
    {
      name: "Header",
      x: 0,
      y: 0,
      width: 1920,
      height: 80,
      isSearchRegion: false
    },
    {
      name: "Sidebar",
      x: 0,
      y: 80,
      width: 250,
      height: 1000,
      isSearchRegion: true
    },
    {
      name: "Main Content",
      x: 250,
      y: 80,
      width: 1670,
      height: 1000,
      isSearchRegion: true
    },
    {
      name: "Footer",
      x: 0,
      y: 1080,
      width: 1920,
      height: 40,
      isSearchRegion: false
    }
  ],
  locations: [],
  strings: [
    {
      name: "Page Title",
      value: "Dashboard",
      identifier: true
    }
  ]
}
```

**Use for:**
- Main screens
- Admin dashboards
- Analytics pages

**Customization needed:**
- Adjust region dimensions
- Add specific StateImages
- Update page title

### Form Template

Generic data entry form:

```typescript
{
  name: "Form Screen",
  description: "Data entry form",
  initial: false,
  stateImages: [
    {
      name: "Submit Button",
      patterns: [],
      shared: true
    }
  ],
  regions: [
    {
      name: "Form Area",
      x: 100,
      y: 100,
      width: 800,
      height: 600,
      isSearchRegion: true
    }
  ],
  locations: [],
  strings: [
    {
      name: "Form Title",
      value: "",
      identifier: true
    },
    {
      name: "Field 1",
      value: "",
      inputText: true
    },
    {
      name: "Field 2",
      value: "",
      inputText: true
    }
  ]
}
```

**Use for:**
- Contact forms
- Registration forms
- Data entry screens
- Settings pages

**Customization needed:**
- Add form fields
- Update field names
- Link submit button image

### Dialog Template

Modal dialog box:

```typescript
{
  name: "Dialog",
  description: "Modal dialog box",
  initial: false,
  stateImages: [
    {
      name: "Dialog Background",
      patterns: [],
      shared: false
    },
    {
      name: "Close Button",
      patterns: [],
      shared: true
    }
  ],
  regions: [
    {
      name: "Dialog Container",
      x: 500,
      y: 300,
      width: 600,
      height: 400,
      isSearchRegion: true
    }
  ],
  locations: [
    {
      name: "Primary Action",
      x: 700,
      y: 650,
      fixed: false,
      anchor: false
    },
    {
      name: "Cancel Action",
      x: 600,
      y: 650,
      fixed: false,
      anchor: false
    }
  ],
  strings: [
    {
      name: "Dialog Title",
      value: "",
      identifier: true
    },
    {
      name: "Dialog Message",
      value: "",
      identifier: true
    }
  ]
}
```

**Use for:**
- Confirmation dialogs
- Error messages
- Success notifications
- Alert boxes

**Customization needed:**
- Set dialog dimensions
- Link images
- Update message text

### Error State Template

Error screen or message:

```typescript
{
  name: "Error State",
  description: "Error condition display",
  initial: false,
  stateImages: [
    {
      name: "Error Icon",
      patterns: [],
      shared: true
    }
  ],
  regions: [
    {
      name: "Error Container",
      x: 400,
      y: 200,
      width: 800,
      height: 400,
      isSearchRegion: true
    }
  ],
  locations: [
    {
      name: "Retry Button",
      x: 800,
      y: 500,
      fixed: false,
      anchor: false
    }
  ],
  strings: [
    {
      name: "Error Title",
      value: "Error",
      identifier: true
    },
    {
      name: "Error Message",
      value: "",
      expectedText: true
    }
  ]
}
```

**Use for:**
- Error pages
- 404 screens
- Network errors
- Validation errors

**Customization needed:**
- Update error messages
- Link error icon
- Add retry logic

### Loading State Template

Loading or progress indicator:

```typescript
{
  name: "Loading State",
  description: "Loading indicator",
  initial: false,
  stateImages: [
    {
      name: "Loading Spinner",
      patterns: [],
      shared: true
    },
    {
      name: "Loading Background",
      patterns: [],
      shared: false
    }
  ],
  regions: [],
  locations: [],
  strings: [
    {
      name: "Loading Text",
      value: "Loading...",
      identifier: true
    }
  ]
}
```

**Use for:**
- Loading screens
- Progress indicators
- Processing states
- Transition states

**Customization needed:**
- Link loading animation
- Update loading text

## Using Templates

### Applying a Template

**Method 1: New State from Template**

1. Click "New State from Template" button
2. Browse available templates
3. Select desired template
4. Customize the created state

**Method 2: Programmatic Creation**

```typescript
// Conceptual template usage
function createStateFromTemplate(
  template: StateTemplate,
  customization: Partial<State>
): State {
  return {
    ...template,
    ...customization,
    id: generateUniqueId(),
    position: findEmptyPosition()
  };
}

// Example usage
const loginState = createStateFromTemplate(
  loginTemplate,
  {
    name: "Login-Production",
    strings: [
      { name: "Username", value: "admin@example.com", inputText: true },
      { name: "Password", value: "password123", inputText: true }
    ]
  }
);
```

### Customizing Template Instances

After creating a state from a template:

1. **Update Identification**
   - Change name to be specific
   - Update description
   - Set initial state flag if needed

2. **Link Images**
   - Connect StateImages to actual library images
   - Add pattern variations (hover, active, etc.)
   - Set appropriate similarity thresholds

3. **Adjust Coordinates**
   - Update region positions/sizes
   - Adjust location coordinates
   - Verify relative positioning

4. **Configure Strings**
   - Set actual input values
   - Update identifier text
   - Add validation patterns

5. **Add/Remove Components**
   - Add additional StateImages as needed
   - Remove unused regions
   - Add custom locations

## Creating Custom Templates

### When to Create a Template

Create a custom template when:
- You've created the same state structure 3+ times
- You have a standard screen pattern in your app
- You want to enforce a design pattern
- You're onboarding new team members

### Template Creation Process

**Step 1: Create a Model State**

Build a complete, well-structured state:

```typescript
const modelState: State = {
  id: "model-checkout-page",
  name: "Checkout Page (Model)",
  description: "Standard checkout screen structure",
  initial: false,
  stateImages: [
    {
      name: "Checkout Header",
      patterns: [/* configured patterns */],
      shared: false
    },
    {
      name: "Payment Section",
      patterns: [/* configured patterns */],
      shared: false
    },
    {
      name: "Place Order Button",
      patterns: [/* configured patterns */],
      shared: true
    }
  ],
  regions: [
    {
      name: "Cart Summary",
      x: 1200,
      y: 100,
      width: 400,
      height: 600,
      isSearchRegion: true
    },
    {
      name: "Payment Form",
      x: 100,
      y: 100,
      width: 1000,
      height: 800,
      isSearchRegion: true
    }
  ],
  locations: [
    {
      name: "Credit Card Number",
      x: 300,
      y: 200,
      fixed: false,
      anchor: false
    }
  ],
  strings: [
    {
      name: "Page Title",
      value: "Checkout",
      identifier: true
    },
    {
      name: "Card Number",
      value: "",
      inputText: true
    }
  ],
  position: { x: 0, y: 0 }
};
```

**Step 2: Extract Template Structure**

Remove instance-specific details:

```typescript
function createTemplate(modelState: State): StateTemplate {
  return {
    name: "Checkout Page Template",
    description: "Template for checkout screens",
    structure: {
      stateImages: modelState.stateImages.map(img => ({
        name: img.name,
        patterns: [],  // Empty - user will configure
        shared: img.shared
      })),
      regions: modelState.regions,
      locations: modelState.locations,
      strings: modelState.strings.map(str => ({
        ...str,
        value: ""  // Empty - user will fill in
      }))
    }
  };
}
```

**Step 3: Document Template Usage**

```typescript
const template = {
  name: "Checkout Page Template",
  description: "Standard checkout screen structure",
  usage: `
    Use this template for:
    - Checkout pages
    - Payment screens
    - Order summary pages

    Customization required:
    - Link StateImages to actual checkout images
    - Update string values (page title, etc.)
    - Adjust region positions for your layout
    - Configure payment form fields
  `,
  structure: {/* ... */}
};
```

**Step 4: Test Template**

1. Create a new state from template
2. Verify all components are correct
3. Customize and use in real scenario
4. Refine template based on feedback

**Step 5: Share Template**

Export template for reuse:

```typescript
// Export template to JSON
const templateExport = {
  name: template.name,
  description: template.description,
  version: "1.0.0",
  author: "Team Name",
  created: new Date().toISOString(),
  structure: template.structure
};

// Save to file
fs.writeFileSync(
  'templates/checkout-page.json',
  JSON.stringify(templateExport, null, 2)
);
```

## Template Best Practices

### Design Principles

1. **Generality**: Template should work for multiple use cases
2. **Completeness**: Include all common components
3. **Flexibility**: Easy to add/remove components
4. **Documentation**: Clear usage instructions

### Structural Guidelines

**Component Naming:**
```typescript
// Good - Generic, descriptive
{
  stateImages: [
    { name: "Page Header" },
    { name: "Primary Action Button" },
    { name: "Secondary Action Button" }
  ]
}

// Bad - Too specific
{
  stateImages: [
    { name: "Blue Login Header For Production" },
    { name: "Red Submit Button With Gradient" }
  ]
}
```

**Region Sizing:**
```typescript
// Good - Relative to common screen sizes
{
  regions: [
    { name: "Content Area", x: 0, y: 80, width: 1920, height: 1000 }
  ]
}

// Bad - Hardcoded to specific instance
{
  regions: [
    { name: "Content Area", x: 127, y: 93, width: 1847, height: 943 }
  ]
}
```

**Default Values:**
```typescript
// Good - Empty or placeholder values
{
  strings: [
    { name: "Page Title", value: "", identifier: true },
    { name: "Input Field", value: "", inputText: true }
  ]
}

// Bad - Instance-specific values
{
  strings: [
    { name: "Page Title", value: "Login to Production System", identifier: true }
  ]
}
```

### Maintenance

**Version Templates:**
```typescript
{
  name: "Login Template",
  version: "2.0.0",
  changelog: [
    "v2.0.0: Added forgot password link location",
    "v1.1.0: Added form container region",
    "v1.0.0: Initial version"
  ]
}
```

**Regular Review:**
- Quarterly: Review template usage
- Monthly: Update based on feedback
- On major changes: Update template to reflect new patterns

**Deprecation:**
```typescript
{
  name: "Old Login Template",
  deprecated: true,
  deprecationMessage: "Use 'Login Template v2.0' instead",
  replacedBy: "login-template-v2"
}
```

## Template Library

### Organizing Templates

**By Category:**
```
templates/
├── authentication/
│   ├── login.json
│   ├── signup.json
│   └── reset-password.json
├── forms/
│   ├── contact-form.json
│   ├── registration-form.json
│   └── settings-form.json
├── screens/
│   ├── dashboard.json
│   ├── list-view.json
│   └── detail-view.json
└── dialogs/
    ├── confirmation.json
    ├── error.json
    └── success.json
```

**By Feature:**
```
templates/
├── e-commerce/
│   ├── product-list.json
│   ├── product-detail.json
│   └── checkout.json
├── admin/
│   ├── user-management.json
│   └── settings.json
└── public/
    ├── homepage.json
    └── about.json
```

### Template Metadata

```typescript
interface TemplateMetadata {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  created: string;
  modified: string;
  usageCount: number;
  rating?: number;
}
```

## Examples

### Example 1: Checkout Flow Templates

**Cart Template:**
```typescript
{
  name: "Shopping Cart",
  stateImages: [
    { name: "Cart Icon" },
    { name: "Checkout Button" }
  ],
  regions: [
    { name: "Cart Items List", isSearchRegion: true },
    { name: "Cart Summary", isSearchRegion: false }
  ],
  strings: [
    { name: "Cart Title", value: "Shopping Cart", identifier: true },
    { name: "Total Price", value: "", expectedText: true }
  ]
}
```

**Shipping Template:**
```typescript
{
  name: "Shipping Information",
  stateImages: [
    { name: "Shipping Form Header" },
    { name: "Continue Button" }
  ],
  locations: [
    { name: "Address Line 1" },
    { name: "Address Line 2" },
    { name: "City" },
    { name: "State" },
    { name: "ZIP Code" }
  ],
  strings: [
    { name: "Form Title", value: "Shipping Address", identifier: true }
  ]
}
```

**Payment Template:**
```typescript
{
  name: "Payment Information",
  stateImages: [
    { name: "Payment Form Header" },
    { name: "Place Order Button" }
  ],
  locations: [
    { name: "Card Number" },
    { name: "CVV" },
    { name: "Expiry Date" }
  ],
  strings: [
    { name: "Form Title", value: "Payment", identifier: true },
    { name: "Card Number", value: "", inputText: true }
  ]
}
```

### Example 2: Settings Templates

**Profile Settings:**
```typescript
{
  name: "Profile Settings",
  regions: [
    { name: "Profile Picture Area" },
    { name: "Personal Info Form" },
    { name: "Save Button Area" }
  ],
  strings: [
    { name: "First Name", value: "", inputText: true },
    { name: "Last Name", value: "", inputText: true },
    { name: "Email", value: "", inputText: true }
  ]
}
```

**Security Settings:**
```typescript
{
  name: "Security Settings",
  regions: [
    { name: "Password Change Section" },
    { name: "Two-Factor Auth Section" }
  ],
  strings: [
    { name: "Current Password", value: "", inputText: true },
    { name: "New Password", value: "", inputText: true },
    { name: "Confirm Password", value: "", inputText: true }
  ]
}
```

## Related Documentation

- **[State Builder Overview](./README.md)** - Main state builder guide
- **[State Organization](./organization.md)** - Organizing states
- **[Best Practices](../best-practices/large-projects.md)** - Large project strategies

---

**Key Takeaways:**
- Templates accelerate state creation and ensure consistency
- Customize templates to fit your specific needs
- Create custom templates for repeated patterns
- Maintain templates as your application evolves
- Document templates clearly for team use
