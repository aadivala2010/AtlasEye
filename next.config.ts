import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // adsb.lol sends no CORS headers, so the browser reaches it through our own origin.
  async rewrites() {
    return [{ source: '/api/adsb/:path*', destination: 'https://api.adsb.lol/v2/:path*' }];
  },
};

export default nextConfig;
