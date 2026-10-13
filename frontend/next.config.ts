
import type { NextConfig } from "next";

const flaskUrl = process.env.FLASK_URL ?? "http://127.0.0.1:5001";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${flaskUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;

