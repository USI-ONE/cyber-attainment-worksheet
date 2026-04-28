/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  // Vercel sets these automatically per project; the app reads TENANT_SLUG to pin a deployment to a tenant.
};

export default nextConfig;
