/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "media.temptguide.com" },
      { protocol: "https", hostname: "*.cdninstagram.com" },
      { protocol: "https", hostname: "*.fbcdn.net" },
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
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
