/**
 * Zod schemas for API request and response validation
 *
 * These schemas provide runtime type safety and validation for API data.
 * They ensure that data from the backend matches expected types and formats.
 *
 * Note: TypeScript types are auto-generated from OpenAPI schema.
 * See: @/lib/api-client/generated-types for compile-time types
 * See: @/lib/api-client/types for convenient type aliases
 *
 * These Zod schemas provide RUNTIME validation, while generated types
 * provide COMPILE-TIME type safety. Use both together for full safety:
 *
 * Usage:
 *   import type { User } from '@/lib/api-client/types'
 *   import { UserSchema } from '@/lib/schemas/api-schemas'
 *
 *   // Validate API response at runtime AND get compile-time types
 *   const user: User = UserSchema.parse(apiResponse)
 *
 *   // Safely parse (returns { success: false } on error)
 *   const result = UserSchema.safeParse(apiResponse)
 *   if (result.success) {
 *     const user: User = result.data
 *   }
 */

import { z } from 'zod'

// ============================================================================
// User Schemas
// ============================================================================

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(1),
  full_name: z.string().nullable().optional(),
  is_active: z.boolean(),
  is_superuser: z.boolean(),
  is_beta: z.boolean().optional(),
  is_verified: z.boolean().optional(),
  created_at: z.string().datetime(), // ISO 8601 datetime string
  updated_at: z.string().datetime(), // ISO 8601 datetime string
  company: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
  subscription_tier: z.enum(['free', 'hobby', 'pro']).default('free'),
  last_login: z.string().datetime().nullable().optional(), // ISO 8601 datetime string
})

export type User = z.infer<typeof UserSchema>

// ============================================================================
// Project Schemas
// ============================================================================

export const ProjectConfigurationSchema = z.record(z.unknown()).default({})

export const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(255),
  description: z.string().nullable().optional(),
  configuration: ProjectConfigurationSchema,
  owner_id: z.string().uuid(),
  created_at: z.string().datetime(), // ISO 8601 datetime string
  updated_at: z.string().datetime(), // ISO 8601 datetime string
})

export type Project = z.infer<typeof ProjectSchema>

export const CreateProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(255, 'Project name is too long'),
  description: z.string().max(1000, 'Description is too long').optional(),
  configuration: ProjectConfigurationSchema,
})

export type CreateProject = z.infer<typeof CreateProjectSchema>

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  configuration: ProjectConfigurationSchema.optional(),
})

export type UpdateProject = z.infer<typeof UpdateProjectSchema>

// ============================================================================
// Admin Schemas
// ============================================================================

export const AdminStatsSchema = z.object({
  total_users: z.number().int().nonnegative(),
  new_users_week: z.number().int().nonnegative(),
  new_users_month: z.number().int().nonnegative(),
  total_projects: z.number().int().nonnegative(),
  projects_week: z.number().int().nonnegative(),
  active_users: z.number().int().nonnegative(),
})

export type AdminStats = z.infer<typeof AdminStatsSchema>

export const AdminUserDataSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  username: z.string().min(1),
  full_name: z.string().nullable(),
  is_active: z.boolean(),
  is_verified: z.boolean(),
  created_at: z.string(), // Accept any string, will be validated as datetime
  project_count: z.number().int().nonnegative(),
  subscription_tier: z.enum(['free', 'hobby', 'pro']),
  last_login: z.string().nullable().optional(), // Optional, nullable datetime string
})

export type AdminUserData = z.infer<typeof AdminUserDataSchema>

export const AdminProjectDataSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  owner_id: z.string().uuid(),
  owner_username: z.string().min(1),
  owner_email: z.string().email(),
  created_at: z.string(), // Accept any string, will be validated as datetime
  updated_at: z.string(), // Accept any string, will be validated as datetime
  state_count: z.number().int().nonnegative(),
  transition_count: z.number().int().nonnegative(),
})

export type AdminProjectData = z.infer<typeof AdminProjectDataSchema>

// ============================================================================
// Authentication Schemas
// ============================================================================

export const LoginRequestSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
})

export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const LoginResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
})

export type LoginResponse = z.infer<typeof LoginResponseSchema>

export const RegisterRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be less than 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Username can only contain letters, numbers, underscores, and hyphens'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  full_name: z.string().max(255).optional(),
})

export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email('Invalid email address'),
})

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
})

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>

// ============================================================================
// API Error Schemas
// ============================================================================

export const ApiErrorSchema = z.object({
  detail: z.string().or(
    z.array(
      z.object({
        loc: z.array(z.string().or(z.number())),
        msg: z.string(),
        type: z.string(),
      })
    )
  ),
})

export type ApiError = z.infer<typeof ApiErrorSchema>

// ============================================================================
// Array Schemas (for lists)
// ============================================================================

export const ProjectsArraySchema = z.array(ProjectSchema)
export const AdminUsersArraySchema = z.array(AdminUserDataSchema)
export const AdminProjectsArraySchema = z.array(AdminProjectDataSchema)

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Safely parse API response with error logging
 */
export function safeParseApi<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): { success: true; data: T } | { success: false; error: z.ZodError } {
  const result = schema.safeParse(data)

  if (!result.success) {
    console.error(`API validation error${context ? ` in ${context}` : ''}:`, {
      errors: result.error.errors,
      data,
    })
  }

  return result
}

/**
 * Parse API response or throw error
 */
export function parseApi<T>(
  schema: z.ZodSchema<T>,
  data: unknown,
  context?: string
): T {
  console.log(`[parseApi] Parsing${context ? ` ${context}` : ''}...`)
  console.log('[parseApi] Raw data:', data)

  try {
    const result = schema.parse(data)
    console.log('[parseApi] ✅ Validation successful, parsed data:', result)
    return result
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`❌ [parseApi] Validation error${context ? ` in ${context}` : ''}:`)
      console.error('Validation errors:', error.errors)
      console.error('Detailed errors:', JSON.stringify(error.errors, null, 2))
      console.error('Data received:', data)

      // Log each validation error with more detail
      error.errors.forEach((err, index) => {
        console.error(`Error ${index + 1}:`, {
          path: err.path.join('.'),
          message: err.message,
          received: err.received,
          expected: err.expected,
        })
      })
    }
    throw error
  }
}
