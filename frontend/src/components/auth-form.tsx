"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  loginFormSchema,
  registerFormSchema,
  type LoginFormData,
  type RegisterFormData,
} from "@/lib/schemas";
import type { User } from "@/types/auth-types";
import {
  startCognitoLogin,
  type CognitoProvider,
} from "@/services/auth/cognito-oauth";

export interface AuthFormProps {
  /** Initial tab to render. Both tabs are always available; this just selects the default. */
  mode?: "signin" | "signup";
  /**
   * Called after a successful sign-in or sign-up with the resulting user.
   * Use to close a dialog, redirect, or show a follow-up step.
   */
  onSuccess?: (user: User) => void;
  /** Hide the tab strip so only one form (matching `mode`) is shown. */
  hideTabs?: boolean;
  /** Where the "Forgot your password?" link points. Defaults to /forgot-password. */
  forgotPasswordHref?: string;
  /** Called when the forgot-password link is clicked (e.g. close a containing dialog). */
  onForgotPasswordClick?: () => void;
  /**
   * Same-origin post-login destination, carried through the Cognito OAuth
   * `state` so the `/auth/callback` route can land the user where they were
   * headed. Ignored if it isn't an absolute same-origin path.
   */
  next?: string;
}

/**
 * Reusable sign-in / sign-up form. Shared by the marketing-header AuthDialog
 * and the standalone `/login` route.
 *
 * Authentication is handled via `useAuth()`. After a successful login or
 * registration the form invokes `onSuccess(user)` so the caller can decide
 * whether to close a modal, redirect, or both.
 */
export function AuthForm({
  mode = "signin",
  onSuccess,
  hideTabs = false,
  forgotPasswordHref = "/forgot-password",
  onForgotPasswordClick,
  next,
}: AuthFormProps) {
  const { login, register: registerUser } = useAuth();
  const [loading, setLoading] = useState(false);
  // Provider whose redirect is in flight (disables the social buttons + shows
  // which one is navigating away). Cleared only if the navigation fails.
  const [socialPending, setSocialPending] = useState<CognitoProvider | null>(
    null
  );

  const handleSocialLogin = async (provider: CognitoProvider) => {
    setSocialPending(provider);
    try {
      // Navigates the browser to the Cognito hosted UI; control does not
      // return here on success. Any thrown error is a pre-redirect failure
      // (e.g. crypto unavailable), so re-enable the buttons.
      await startCognitoLogin(
        provider,
        next && next.startsWith("/") ? next : undefined
      );
    } catch (error: unknown) {
      setSocialPending(null);
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not start social sign-in. Please try again."
      );
    }
  };

  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      username: "",
      password: "",
      remember_me: false,
    },
  });

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      email: "",
      username: "",
      password: "",
      confirmPassword: "",
      full_name: "",
    },
  });

  const handleLogin = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const user = await login(data.username, data.password, data.remember_me);
      toast.success("Logged in successfully");
      loginForm.reset();
      if (user) {
        onSuccess?.(user);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterFormData) => {
    setLoading(true);
    try {
      await registerUser(
        data.email,
        data.username,
        data.password,
        data.full_name
      );
      toast.success("Account created successfully");
      registerForm.reset();
      // The auth context auto-logs the user in after registration; the
      // refreshed user lands in context via state. We re-pull from a
      // subsequent render via onSuccess — pass a minimal stub here so the
      // caller can react. Most callers just need "we're done".
      onSuccess?.({
        id: "",
        email: data.email,
        username: data.username,
        is_active: true,
        is_superuser: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (error: unknown) {
      toast.error(
        error instanceof Error ? error.message : "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  };

  const socialButtons = (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading || socialPending !== null}
        onClick={() => handleSocialLogin("Google")}
      >
        <GoogleIcon className="mr-2 h-4 w-4" />
        {socialPending === "Google"
          ? "Redirecting to Google..."
          : "Continue with Google"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading || socialPending !== null}
        onClick={() => handleSocialLogin("MicrosoftEntra")}
      >
        <MicrosoftIcon className="mr-2 h-4 w-4" />
        {socialPending === "MicrosoftEntra"
          ? "Redirecting to Microsoft..."
          : "Continue with Microsoft"}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        disabled={loading || socialPending !== null}
        onClick={() => handleSocialLogin("GitHub")}
      >
        <GitHubIcon className="mr-2 h-4 w-4" />
        {socialPending === "GitHub"
          ? "Redirecting to GitHub..."
          : "Continue with GitHub"}
      </Button>
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">
            Or continue with email
          </span>
        </div>
      </div>
    </div>
  );

  const signinPanel = (
    <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
      {socialButtons}
      <div className="space-y-2">
        <Label htmlFor="login-username">Email or username</Label>
        <Input
          id="login-username"
          type="text"
          placeholder="you@example.com or your_username"
          {...loginForm.register("username")}
          disabled={loading}
        />
        {loginForm.formState.errors.username && (
          <p className="text-sm text-red-500">
            {loginForm.formState.errors.username.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          type="password"
          {...loginForm.register("password")}
          disabled={loading}
        />
        {loginForm.formState.errors.password && (
          <p className="text-sm text-red-500">
            {loginForm.formState.errors.password.message}
          </p>
        )}
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox
          id="remember-me"
          checked={loginForm.watch("remember_me")}
          onCheckedChange={(checked) => {
            loginForm.setValue("remember_me", checked as boolean);
          }}
          disabled={loading}
        />
        <Label
          htmlFor="remember-me"
          className="text-sm font-normal cursor-pointer"
        >
          Remember me for 90 days
        </Label>
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Signing in..." : "Sign In"}
      </Button>
      <div className="text-center mt-4">
        <Link
          href={forgotPasswordHref}
          className="text-sm text-muted-foreground hover:text-primary"
          onClick={onForgotPasswordClick}
        >
          Forgot your password?
        </Link>
      </div>
    </form>
  );

  const signupPanel = (
    <form
      onSubmit={registerForm.handleSubmit(handleRegister)}
      className="space-y-4"
    >
      {socialButtons}
      <div className="space-y-2">
        <Label htmlFor="register-email">Email</Label>
        <Input
          id="register-email"
          type="email"
          placeholder="you@example.com"
          {...registerForm.register("email")}
          disabled={loading}
        />
        {registerForm.formState.errors.email && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.email.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-username">Username</Label>
        <Input
          id="register-username"
          type="text"
          placeholder="your_username"
          {...registerForm.register("username")}
          disabled={loading}
        />
        {registerForm.formState.errors.username && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.username.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-fullname">Full Name (optional)</Label>
        <Input
          id="register-fullname"
          type="text"
          placeholder="John Doe"
          {...registerForm.register("full_name")}
          disabled={loading}
        />
        {registerForm.formState.errors.full_name && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.full_name.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-password">Password</Label>
        <Input
          id="register-password"
          type="password"
          {...registerForm.register("password")}
          disabled={loading}
        />
        {registerForm.formState.errors.password && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.password.message}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="register-confirm-password">Confirm Password</Label>
        <Input
          id="register-confirm-password"
          type="password"
          {...registerForm.register("confirmPassword")}
          disabled={loading}
        />
        {registerForm.formState.errors.confirmPassword && (
          <p className="text-sm text-red-500">
            {registerForm.formState.errors.confirmPassword.message}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? "Creating account..." : "Create Account"}
      </Button>
    </form>
  );

  if (hideTabs) {
    return mode === "signup" ? signupPanel : signinPanel;
  }

  return (
    <Tabs
      defaultValue={mode === "signup" ? "register" : "login"}
      className="w-full"
    >
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="login">Login</TabsTrigger>
        <TabsTrigger value="register">Register</TabsTrigger>
      </TabsList>
      <TabsContent value="login">{signinPanel}</TabsContent>
      <TabsContent value="register">{signupPanel}</TabsContent>
    </Tabs>
  );
}

/** Google "G" brand mark (multi-color), used on the social sign-in button. */
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

/** Microsoft four-square brand mark, used on the social sign-in button. */
function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

/** GitHub octocat brand mark, used on the social sign-in button. */
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.39c.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.09 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.31-.54-1.53.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.24 2.87.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.81 5.65-5.49 5.95.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
