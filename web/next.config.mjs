/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
      {
        protocol: "http",
        hostname: "**",
      },
    ],
  },
  async rewrites() {
    const apiUrl = process.env.INTERNAL_API_URL || "http://api:8080";
    return [
      {
        source: "/b/:path*",
        destination: `${apiUrl}/b/:path*`,
      },
    ];
  },
};

export default nextConfig;
