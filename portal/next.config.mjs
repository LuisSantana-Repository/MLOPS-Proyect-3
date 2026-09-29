/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Los drivers nativos (mysql2, ioredis) se dejan como externos del server bundle.
  serverExternalPackages: ["mysql2", "ioredis"],
};

export default nextConfig;
