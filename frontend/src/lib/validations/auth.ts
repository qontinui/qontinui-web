/**
 * Authentication form validation schemas using Zod.
 *
 * These schemas provide type-safe validation for authentication forms.
 * Use with react-hook-form's zodResolver.
 *
 * Example usage:
 *
 *   import { useForm } from 'react-hook-form'
 *   import { zodResolver } from '@hookform/resolvers/zod'
 *   import { loginSchema, type LoginFormData } from '@/lib/validations/auth'
 *
 *   function LoginForm() {
 *     const form = useForm<LoginFormData>({
 *       resolver: zodResolver(loginSchema),
 *       defaultValues: {
 *         email: '',
 *         password: '',
 *       }
 *     })
 *
 *     const onSubmit = (data: LoginFormData) => {
 *       // data is fully typed and validated
 *     }
 *
 *     return <form onSubmit={form.handleSubmit(onSubmit)}>...</form>
 *   }
 */

import { z } from "zod";

/**
 * Login form validation schema - supports both username and email
 */
export const loginSchema = z.object({
  identifier: z.string().min(1, "Username or email is required"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
  useEmail: z.boolean().optional(),
});

export type LoginFormData = z.infer<typeof loginSchema>;

/**
 * Login form validation schema - email mode
 */
export const loginWithEmailSchema = z.object({
  identifier: z
    .string()
    .min(1, "Email is required")
    .email("Invalid email address"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
  useEmail: z.boolean().optional(),
});

/**
 * Login form validation schema - username mode
 */
export const loginWithUsernameSchema = z.object({
  identifier: z
    .string()
    .min(1, "Username is required")
    .min(3, "Username must be at least 3 characters"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters"),
  useEmail: z.boolean().optional(),
});

/**
 * Registration form validation schema
 */
export const registerSchema = z
  .object({
    email: z
      .string()
      .min(1, "Email is required")
      .email("Invalid email address"),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least one special character"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
    firstName: z
      .string()
      .min(1, "First name is required")
      .min(2, "First name must be at least 2 characters")
      .max(50, "First name must be less than 50 characters"),
    lastName: z
      .string()
      .min(1, "Last name is required")
      .min(2, "Last name must be at least 2 characters")
      .max(50, "Last name must be less than 50 characters"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type RegisterFormData = z.infer<typeof registerSchema>;

/**
 * Password reset request schema
 */
export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Email is required").email("Invalid email address"),
});

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>;

/**
 * Password reset schema
 */
export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least one special character"
      ),
    confirmPassword: z.string().min(1, "Please confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>;

/**
 * Profile update schema
 */
export const updateProfileSchema = z.object({
  firstName: z
    .string()
    .min(2, "First name must be at least 2 characters")
    .max(50, "First name must be less than 50 characters")
    .optional(),
  lastName: z
    .string()
    .min(2, "Last name must be at least 2 characters")
    .max(50, "Last name must be less than 50 characters")
    .optional(),
  email: z.string().email("Invalid email address").optional(),
});

export type UpdateProfileFormData = z.infer<typeof updateProfileSchema>;

/**
 * Change password schema (for authenticated users)
 */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter")
      .regex(/[0-9]/, "Password must contain at least one number")
      .regex(
        /[^A-Za-z0-9]/,
        "Password must contain at least one special character"
      ),
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "Passwords don't match",
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must be different from current password",
    path: ["newPassword"],
  });

export type ChangePasswordFormData = z.infer<typeof changePasswordSchema>;
