import path from 'path';
import { fileURLToPath } from 'url';
import bundleAnalyzer from '@next/bundle-analyzer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

// Backend URL: Use environment variable in production, localhost in development
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    config.resolve.alias['@qontinui/schemas'] = path.resolve(__dirname, '../../qontinui-schemas/generated/typescript');
    return config;
  },
  // Prevent Next.js from stripping trailing slashes on API routes
  // FastAPI requires trailing slashes on some endpoints
  skipTrailingSlashRedirect: true,
  eslint: {
    // Warning: This allows production builds to successfully complete even if
    // your project has ESLint errors.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Warning: This allows production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Credentials', value: 'true' },
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
          { key: 'Access-Control-Allow-Headers', value: 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization' },
        ],
      },
    ]
  },
  async rewrites() {
    return {
      // beforeFiles rewrites are checked before pages/public files
      // allowing them to override page routes
      beforeFiles: [],
      // afterFiles rewrites are checked after pages/public files
      // but before dynamic routes - this is the default behavior
      afterFiles: [
        // Exclude paths that have custom API route handlers
        // These routes read cookies and forward to backend with Bearer token
        {
          source: '/api/v1/users/me/automation-streaming/:path*',
          destination: '/api/v1/users/me/automation-streaming/:path*',
          has: [{ type: 'header', key: 'x-skip-rewrite' }], // Never matches, effectively skips
        },
      ],
      // fallback rewrites are checked after both pages/public files
      // and dynamic routes
      fallback: [
        // Exclude paths that have custom API route handlers requiring cookie auth
        // These routes read HttpOnly cookies and forward to backend with Bearer token
        // Without exclusion, the fallback rewrite would proxy without auth headers
        {
          source: '/api/v1/ai-tasks',
          destination: '/api/v1/ai-tasks', // No rewrite - use API route handler
        },
        {
          source: '/api/v1/ai-tasks/:path*',
          destination: '/api/v1/ai-tasks/:path*', // No rewrite - use API route handlers
        },
        {
          source: '/api/:path*',
          destination: `${BACKEND_URL}/api/:path*`, // Proxy to Backend (uses env var in production)
        },
      ],
    }
  },
}

export default withBundleAnalyzer(nextConfig);
