'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { loginSchema, registerSchema, type LoginFormData, type RegisterFormData } from '@/lib/validations/auth';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultTab?: 'signin' | 'signup';
}

export function AuthDialog({ open, onOpenChange, defaultTab = 'signin' }: AuthDialogProps) {
  const { login, register: registerUser } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  // Login form with Zod validation
  const loginForm = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    }
  });

  // Register form with Zod validation
  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: '',
      password: '',
      confirmPassword: '',
      firstName: '',
      lastName: '',
    }
  });

  const handleLogin = async (data: LoginFormData) => {
    setLoading(true);
    try {
      const user = await login(data.email, data.password);
      toast.success('Logged in successfully');
      onOpenChange(false);
      loginForm.reset();
      // Redirect to admin page if superuser, otherwise dashboard
      if (user?.is_superuser) {
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (error: any) {
      toast.error(error.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (data: RegisterFormData) => {
    setLoading(true);
    try {
      // Combine firstName and lastName for fullName
      const fullName = `${data.firstName} ${data.lastName}`.trim();
      // Use email as username for now
      await registerUser(data.email, data.email, data.password, fullName);
      toast.success('Account created successfully');
      onOpenChange(false);
      registerForm.reset();
      // Redirect to dashboard
      router.push('/dashboard');
    } catch (error: any) {
      toast.error(error.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Account</DialogTitle>
          <DialogDescription>
            Sign in to save and manage your automation projects
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={defaultTab === 'signup' ? 'register' : 'login'} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Login</TabsTrigger>
            <TabsTrigger value="register">Register</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  {...loginForm.register('email')}
                  disabled={loading}
                />
                {loginForm.formState.errors.email && (
                  <p className="text-sm text-red-500">{loginForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  {...loginForm.register('password')}
                  disabled={loading}
                />
                {loginForm.formState.errors.password && (
                  <p className="text-sm text-red-500">{loginForm.formState.errors.password.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign In'}
              </Button>
              <div className="text-center mt-4">
                <Link
                  href="/forgot-password"
                  className="text-sm text-muted-foreground hover:text-primary"
                  onClick={() => onOpenChange(false)}
                >
                  Forgot your password?
                </Link>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="register">
            <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  {...registerForm.register('email')}
                  disabled={loading}
                />
                {registerForm.formState.errors.email && (
                  <p className="text-sm text-red-500">{registerForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="register-firstname">First Name</Label>
                  <Input
                    id="register-firstname"
                    type="text"
                    {...registerForm.register('firstName')}
                    disabled={loading}
                  />
                  {registerForm.formState.errors.firstName && (
                    <p className="text-sm text-red-500">{registerForm.formState.errors.firstName.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-lastname">Last Name</Label>
                  <Input
                    id="register-lastname"
                    type="text"
                    {...registerForm.register('lastName')}
                    disabled={loading}
                  />
                  {registerForm.formState.errors.lastName && (
                    <p className="text-sm text-red-500">{registerForm.formState.errors.lastName.message}</p>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  {...registerForm.register('password')}
                  disabled={loading}
                />
                {registerForm.formState.errors.password && (
                  <p className="text-sm text-red-500">{registerForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="register-confirm-password">Confirm Password</Label>
                <Input
                  id="register-confirm-password"
                  type="password"
                  {...registerForm.register('confirmPassword')}
                  disabled={loading}
                />
                {registerForm.formState.errors.confirmPassword && (
                  <p className="text-sm text-red-500">{registerForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating account...' : 'Create Account'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
