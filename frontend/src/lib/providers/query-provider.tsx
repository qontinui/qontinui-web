/**
 * TanStack Query Provider
 *
 * Wraps the application with React Query for server state management.
 * Provides automatic caching, refetching, and optimistic updates.
 *
 * Usage:
 *   Wrap your app in layout.tsx:
 *
 *   export default function RootLayout({ children }) {
 *     return (
 *       <html>
 *         <body>
 *           <QueryProvider>{children}</QueryProvider>
 *         </body>
 *       </html>
 *     )
 *   }
 */

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

interface QueryProviderProps {
  children: ReactNode;
}

export function QueryProvider({ children }: QueryProviderProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is considered fresh for 1 minute
            staleTime: 60 * 1000,

            // Don't refetch on window focus in development
            refetchOnWindowFocus: process.env.NODE_ENV === "production",

            // Retry failed requests 3 times
            retry: 3,

            // Exponential backoff
            retryDelay: (attemptIndex) =>
              Math.min(1000 * 2 ** attemptIndex, 30000),
          },
          mutations: {
            // Retry failed mutations once
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && (
        <ReactQueryDevtools initialIsOpen={false} position={"bottom-right" as any} />
      )}
    </QueryClientProvider>
  );
}

/**
 * Example usage in a component:
 *
 * import { useQuery, useMutation } from '@tanstack/react-query'
 *
 * function UserList() {
 *   // Fetch data
 *   const { data, isLoading, error } = useQuery({
 *     queryKey: ['users'],
 *     queryFn: () => fetch('/api/users').then(res => res.json())
 *   })
 *
 *   // Mutation
 *   const createUser = useMutation({
 *     mutationFn: (newUser) =>
 *       fetch('/api/users', {
 *         method: 'POST',
 *         body: JSON.stringify(newUser)
 *       }),
 *     onSuccess: () => {
 *       // Invalidate and refetch
 *       queryClient.invalidateQueries({ queryKey: ['users'] })
 *     }
 *   })
 *
 *   if (isLoading) return <div>Loading...</div>
 *   if (error) return <div>Error: {error.message}</div>
 *
 *   return (
 *     <div>
 *       {data.map(user => <div key={user.id}>{user.name}</div>)}
 *       <button onClick={() => createUser.mutate({ name: 'New User' })}>
 *         Add User
 *       </button>
 *     </div>
 *   )
 * }
 */
