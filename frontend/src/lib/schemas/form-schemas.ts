/**
 * Zod schemas for form validation
 *
 * These schemas are used with React Hook Form for client-side validation.
 * They provide immediate feedback to users before submitting forms.
 *
 * Usage with React Hook Form:
 *   import { useForm } from 'react-hook-form'
 *   import { zodResolver } from '@hookform/resolvers/zod'
 *   import { loginFormSchema } from '@/lib/schemas/form-schemas'
 *
 *   const form = useForm({
 *     resolver: zodResolver(loginFormSchema)
 *   })
 */

import { z } from 'zod'

// ============================================================================
// Authentication Forms
// ============================================================================

export const loginFormSchema = z.object({
  username: z
    .string()
    .min(1, 'Username is required')
    .max(50, 'Username must be less than 50 characters'),
  password: z
    .string()
    .min(1, 'Password is required'),
})

export type LoginFormData = z.infer<typeof loginFormSchema>

export const registerFormSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be less than 50 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain letters, numbers, underscores, and hyphens'
    ),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
  full_name: z
    .string()
    .max(255, 'Full name must be less than 255 characters')
    .optional()
    .or(z.literal('')),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

export type RegisterFormData = z.infer<typeof registerFormSchema>

export const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
})

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordFormSchema>

export const resetPasswordFormSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})

export type ResetPasswordFormData = z.infer<typeof resetPasswordFormSchema>

// ============================================================================
// Project Forms
// ============================================================================

export const createProjectFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be less than 255 characters'),
  description: z
    .string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .or(z.literal('')),
})

export type CreateProjectFormData = z.infer<typeof createProjectFormSchema>

export const updateProjectFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be less than 255 characters')
    .optional(),
  description: z
    .string()
    .max(1000, 'Description must be less than 1000 characters')
    .optional()
    .or(z.literal('')),
})

export type UpdateProjectFormData = z.infer<typeof updateProjectFormSchema>

// ============================================================================
// Profile Forms
// ============================================================================

export const updateProfileFormSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(50, 'Username must be less than 50 characters')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Username can only contain letters, numbers, underscores, and hyphens'
    ),
  full_name: z
    .string()
    .max(255, 'Full name must be less than 255 characters')
    .optional()
    .or(z.literal('')),
  company: z
    .string()
    .max(255, 'Company name must be less than 255 characters')
    .optional()
    .or(z.literal('')),
  phone: z
    .string()
    .max(20, 'Phone number must be less than 20 characters')
    .optional()
    .or(z.literal('')),
})

export type UpdateProfileFormData = z.infer<typeof updateProfileFormSchema>

export const changePasswordFormSchema = z.object({
  currentPassword: z
    .string()
    .min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^a-zA-Z0-9]/, 'Password must contain at least one special character'),
  confirmPassword: z
    .string()
    .min(1, 'Please confirm your password'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
}).refine((data) => data.currentPassword !== data.newPassword, {
  message: "New password must be different from current password",
  path: ['newPassword'],
})

export type ChangePasswordFormData = z.infer<typeof changePasswordFormSchema>

// ============================================================================
// State and Transition Forms (for automation builder)
// ============================================================================

export const stateFormSchema = z.object({
  name: z
    .string()
    .min(1, 'State name is required')
    .max(100, 'State name must be less than 100 characters'),
  description: z
    .string()
    .max(500, 'Description must be less than 500 characters')
    .optional()
    .or(z.literal('')),
})

export type StateFormData = z.infer<typeof stateFormSchema>

export const transitionFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Transition name is required')
    .max(100, 'Transition name must be less than 100 characters'),
  fromState: z
    .string()
    .min(1, 'From state is required'),
  toState: z
    .string()
    .min(1, 'To state is required'),
  condition: z
    .string()
    .max(500, 'Condition must be less than 500 characters')
    .optional()
    .or(z.literal('')),
})

export type TransitionFormData = z.infer<typeof transitionFormSchema>

// ============================================================================
// Contact and Feedback Forms
// ============================================================================

export const contactFormSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be less than 100 characters'),
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  subject: z
    .string()
    .min(1, 'Subject is required')
    .max(200, 'Subject must be less than 200 characters'),
  message: z
    .string()
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message must be less than 2000 characters'),
})

export type ContactFormData = z.infer<typeof contactFormSchema>

export const feedbackFormSchema = z.object({
  rating: z
    .number()
    .int()
    .min(1, 'Please select a rating')
    .max(5, 'Rating must be between 1 and 5'),
  category: z
    .enum(['bug', 'feature', 'improvement', 'other'])
    .default('other'),
  title: z
    .string()
    .min(1, 'Title is required')
    .max(200, 'Title must be less than 200 characters'),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(2000, 'Description must be less than 2000 characters'),
})

export type FeedbackFormData = z.infer<typeof feedbackFormSchema>

// ============================================================================
// Search and Filter Forms
// ============================================================================

export const searchFormSchema = z.object({
  query: z
    .string()
    .max(200, 'Search query must be less than 200 characters')
    .optional()
    .or(z.literal('')),
  filters: z
    .record(z.string(), z.any())
    .optional(),
})

export type SearchFormData = z.infer<typeof searchFormSchema>
