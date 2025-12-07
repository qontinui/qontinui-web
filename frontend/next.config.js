const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
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
        {
          source: '/api/:path*',
          destination: 'http://localhost:8000/api/:path*', // Proxy to Backend
        },
      ],
    }
  },
}

module.exports = withBundleAnalyzer(nextConfig)
