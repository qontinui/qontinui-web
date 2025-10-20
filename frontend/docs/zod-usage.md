# Zod Usage Guide

This guide explains how to use Zod for runtime type validation in the Qontinui frontend.

## Table of Contents

- [What is Zod?](#what-is-zod)
- [Why Use Zod?](#why-use-zod)
- [Schema Organization](#schema-organization)
- [API Validation](#api-validation)
- [Form Validation](#form-validation)
- [Best Practices](#best-practices)

## What is Zod?

Zod is a TypeScript-first schema declaration and validation library. It allows you to:

- Define schemas that describe your data
- Validate data at runtime
- Infer TypeScript types from schemas
- Get detailed error messages

## Why Use Zod?

1. **Runtime Safety**: Catch data inconsistencies before they cause bugs
2. **Type Safety**: Automatic TypeScript type inference from schemas
3. **DRY Principle**: Single source of truth for types and validation
4. **Better Errors**: Detailed, actionable error messages
5. **API Protection**: Validate backend responses match expected format

## Schema Organization

Schemas are organized in `src/lib/schemas/`:

```
src/lib/schemas/
├── index.ts              # Re-exports all schemas
├── api-schemas.ts        # Backend API response schemas
└── form-schemas.ts       # Client-side form validation schemas
```

### Importing Schemas

```typescript
// Import everything from one place
import { UserSchema, loginFormSchema, parseApi } from '@/lib/schemas'

// Or import from specific files
import { UserSchema } from '@/lib/schemas/api-schemas'
import { loginFormSchema } from '@/lib/schemas/form-schemas'
```

## API Validation

### Using Zod with TanStack Query

All TanStack Query hooks automatically validate API responses:

```typescript
// hooks/use-projects.ts
import { ProjectsArraySchema, parseApi } from '@/lib/schemas'

export function useProjects() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: async () => {
      const data = await projectService.getProjects()
      // Validates response and throws if invalid
      return parseApi(ProjectsArraySchema, data, 'projects list')
    },
  })
}
```

### Validation Helpers

**parseApi** - Parse and validate, throw on error:
```typescript
import { UserSchema, parseApi } from '@/lib/schemas'

const user = parseApi(UserSchema, apiResponse, 'user profile')
// Throws ZodError if validation fails
```

**safeParseApi** - Parse and validate, return result object:
```typescript
import { UserSchema, safeParseApi } from '@/lib/schemas'

const result = safeParseApi(UserSchema, apiResponse, 'user profile')

if (result.success) {
  console.log('Valid user:', result.data)
} else {
  console.error('Validation errors:', result.error.errors)
}
```

### Manual Validation

```typescript
import { z } from 'zod'
import { UserSchema } from '@/lib/schemas'

// Parse (throws on error)
const user = UserSchema.parse(apiResponse)

// Safe parse (returns result object)
const result = UserSchema.safeParse(apiResponse)

if (result.success) {
  const user = result.data // Typed!
} else {
  const errors = result.error.errors
}
```

## Form Validation

### Using Zod with React Hook Form

Forms use `zodResolver` to integrate Zod schemas with React Hook Form:

```typescript
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginFormSchema, type LoginFormData } from '@/lib/schemas'

function LoginForm() {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    mode: 'onBlur', // Validate on blur
  })

  const onSubmit = (data: LoginFormData) => {
    // data is fully validated and typed!
    console.log(data.username, data.password)
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register('username')} />
      {errors.username && <span>{errors.username.message}</span>}

      <input type="password" {...register('password')} />
      {errors.password && <span>{errors.password.message}</span>}

      <button type="submit">Login</button>
    </form>
  )
}
```

### Example Forms

Pre-built example forms are available in `src/components/forms/`:

- **LoginForm** - Basic authentication form
- **CreateProjectForm** - Complex form with TanStack Query integration

```typescript
import { LoginForm, CreateProjectForm } from '@/components/forms'

// Use in your components
<LoginForm
  onSuccess={() => router.push('/dashboard')}
  onError={(error) => console.error(error)}
/>
```

## Creating New Schemas

### API Response Schema

```typescript
// src/lib/schemas/api-schemas.ts
import { z } from 'zod'

export const TaskSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().nullable(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export type Task = z.infer<typeof TaskSchema>

// Array schema
export const TasksArraySchema = z.array(TaskSchema)
```

### Form Validation Schema

```typescript
// src/lib/schemas/form-schemas.ts
import { z } from 'zod'

export const createTaskFormSchema = z.object({
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  description: z
    .string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .or(z.literal('')), // Allow empty string
  status: z
    .enum(['pending', 'in_progress', 'completed'])
    .default('pending'),
})

export type CreateTaskFormData = z.infer<typeof createTaskFormSchema>
```

## Common Validation Patterns

### Email Validation
```typescript
email: z.string().email('Invalid email address')
```

### Password Validation
```typescript
password: z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain uppercase letter')
  .regex(/[a-z]/, 'Must contain lowercase letter')
  .regex(/[0-9]/, 'Must contain number')
  .regex(/[^a-zA-Z0-9]/, 'Must contain special character')
```

### Confirm Password
```typescript
const schema = z.object({
  password: z.string().min(8),
  confirmPassword: z.string(),
}).refine(data => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})
```

### Optional Fields
```typescript
// Nullable (can be null)
description: z.string().nullable()

// Optional (can be undefined)
phone: z.string().optional()

// Both nullable and optional
notes: z.string().nullable().optional()

// Allow empty string
bio: z.string().optional().or(z.literal(''))
```

### UUID Validation
```typescript
id: z.string().uuid()
```

### Date Validation
```typescript
// ISO datetime string
created_at: z.string().datetime()

// Custom date format
date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format')
```

### Number Validation
```typescript
age: z.number().int().positive().min(18).max(120)
price: z.number().positive().multipleOf(0.01) // Two decimal places
```

### Enum Validation
```typescript
status: z.enum(['active', 'inactive', 'pending'])
tier: z.enum(['free', 'pro', 'premium']).default('free')
```

## Best Practices

### 1. Single Source of Truth

Define schemas once and derive types from them:

```typescript
// ✅ Good - Schema is source of truth
export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
})

export type User = z.infer<typeof UserSchema>

// ❌ Bad - Duplicated definitions
export interface User {
  id: string
  email: string
}
```

### 2. Validate at Boundaries

Always validate data coming from external sources:

```typescript
// ✅ Good - Validate API responses
const data = await response.json()
return parseApi(UserSchema, data, 'user profile')

// ❌ Bad - Trust external data
const data = await response.json()
return data as User // No runtime validation!
```

### 3. Use Descriptive Error Messages

```typescript
// ✅ Good - Clear, actionable messages
username: z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(50, 'Username must be less than 50 characters')

// ❌ Bad - Generic or missing messages
username: z.string().min(3).max(50)
```

### 4. Separate API and Form Schemas

```typescript
// API schema - Matches backend response exactly
export const UserSchema = z.object({
  id: z.string().uuid(),
  created_at: z.string().datetime(),
  // ... all fields from API
})

// Form schema - Only fields user can input
export const updateProfileFormSchema = z.object({
  email: z.string().email(),
  full_name: z.string().max(255),
  // No id, no created_at
})
```

### 5. Transform Data When Needed

```typescript
// Convert API snake_case to camelCase
const UserSchema = z.object({
  full_name: z.string(),
}).transform(data => ({
  fullName: data.full_name,
}))

// Parse dates
const EventSchema = z.object({
  date: z.string().datetime().transform(str => new Date(str)),
})
```

### 6. Provide Context in Validation

```typescript
// ✅ Good - Context helps debugging
parseApi(UserSchema, data, 'user profile endpoint')

// ❌ Bad - No context
parseApi(UserSchema, data)
```

## Troubleshooting

### Validation Error in Console

When you see validation errors in the console, it means the API response doesn't match the expected schema:

```
API validation error in user profile:
{
  errors: [
    {
      path: ['email'],
      message: 'Invalid email',
    }
  ],
  data: { ... }
}
```

**Solution**: Check if the backend response format changed or if the schema needs updating.

### Type Mismatch

If TypeScript complains about types, make sure you're using the inferred type:

```typescript
// ✅ Good
import { type User } from '@/lib/schemas'

// ❌ Bad
import { User } from '@/services/api-client' // Old manual type
```

### Form Validation Not Working

Make sure you're using `zodResolver`:

```typescript
useForm({
  resolver: zodResolver(loginFormSchema), // Required!
})
```

## Resources

- [Zod Documentation](https://zod.dev)
- [React Hook Form + Zod](https://react-hook-form.com/get-started#SchemaValidation)
- [TanStack Query Error Handling](https://tanstack.com/query/latest/docs/guides/query-functions#handling-and-throwing-errors)
