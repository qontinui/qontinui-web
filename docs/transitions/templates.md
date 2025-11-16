# Transition Templates

Guide for using transition templates to quickly create common transition patterns.

## Table of Contents

- [Overview](#overview)
- [Built-in Templates](#built-in-templates)
- [Creating Custom Templates](#creating-custom-templates)
- [Template Best Practices](#template-best-practices)
- [Examples](#examples)

## Overview

Transition templates provide pre-configured transition patterns for common navigation scenarios, reducing setup time and ensuring consistency.

### Benefits

- **Speed**: Create transitions 5x faster
- **Consistency**: Standardized patterns across project
- **Best Practices**: Built-in timeout and retry defaults
- **Reduce Errors**: Pre-validated configurations

## Built-in Templates

### Simple Navigation Template

Basic page-to-page navigation:

```typescript
{
  name: "Simple Navigation",
  type: "OutgoingTransition",
  fromState: "<source>",
  toState: "<target>",
  activateStates: ["<target>"],
  staysVisible: false,
  deactivateStates: ["<source>"],
  workflows: [],
  timeout: 10000,
  retryCount: 2
}
```

**Use for**: Standard page navigation

### Modal Dialog Template

Opening modal overlay:

```typescript
{
  name: "Open Modal",
  type: "OutgoingTransition",
  fromState: "<base-page>",
  toState: "<modal>",
  activateStates: ["<modal>"],
  staysVisible: true,  // Base page stays visible
  deactivateStates: [],
  workflows: [],
  timeout: 5000,
  retryCount: 2
}
```

**Use for**: Dialogs, modals, overlays

### Form Submission Template

Submit form and navigate:

```typescript
{
  name: "Form Submit",
  type: "OutgoingTransition",
  fromState: "<form-page>",
  toState: "<success-page>",
  activateStates: ["<success-page>"],
  staysVisible: false,
  deactivateStates: ["<form-page>"],
  workflows: ["submit-form", "wait-for-response", "verify-success"],
  timeout: 30000,
  retryCount: 3
}
```

**Use for**: Form submissions, data entry

### Login Flow Template

Authentication transition:

```typescript
{
  name: "Login",
  type: "OutgoingTransition",
  fromState: "login-page",
  toState: "dashboard",
  activateStates: ["dashboard"],
  staysVisible: false,
  deactivateStates: ["login-page"],
  workflows: [
    "fill-credentials",
    "click-login-button",
    "wait-for-dashboard"
  ],
  timeout: 15000,
  retryCount: 3
}
```

**Use for**: Authentication flows

### Data Load Template (Incoming)

Load data on state entry:

```typescript
{
  name: "Load Data",
  type: "IncomingTransition",
  toState: "<target-state>",
  workflows: ["load-data", "verify-loaded"],
  timeout: 20000,
  retryCount: 3
}
```

**Use for**: Data initialization

## Creating Custom Templates

```typescript
// 1. Create model transition
const modelTransition = {
  type: "OutgoingTransition",
  fromState: "checkout-cart",
  toState: "checkout-payment",
  activateStates: ["checkout-payment"],
  staysVisible: false,
  deactivateStates: ["checkout-cart"],
  workflows: ["click-continue-button", "wait-for-payment-page"],
  timeout: 15000,
  retryCount: 3
};

// 2. Extract template
const template = {
  name: "Checkout Step",
  pattern: {
    ...modelTransition,
    fromState: "<current-step>",
    toState: "<next-step>",
    activateStates: ["<next-step>"],
    deactivateStates: ["<current-step>"]
  }
};
```

## Template Best Practices

1. **Use generic placeholders**: `<state>` for customization
2. **Set reasonable defaults**: Timeouts and retry counts
3. **Document usage**: When to use each template
4. **Version templates**: Track changes

## Examples

See [Transition Management](./README.md) for complete examples.

---

**Related Documentation:**
- [Transition Management](./README.md)
- [Validation](./validation.md)
