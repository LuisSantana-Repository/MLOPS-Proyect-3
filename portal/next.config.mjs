// Backend del portal de anotación (Proyectos 1 y 2): servicio `annotation-api` del compose.
const annotationApiUrl = (process.env.P2_BACKEND_URL ?? "http://127.0.0.1:3100").replace(
  /\/+$/,
  "",
);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Los drivers nativos (mysql2, ioredis) se dejan como externos del server bundle.
  serverExternalPackages: ["mysql2", "ioredis"],
  // Las pantallas de anotación y calidad llaman a /api/p2/*; Next lo reenvía a su backend,
  // así el navegador solo habla con el portal (mismo origen, sin CORS).
  async rewrites() {
    return [{ source: "/api/p2/:path*", destination: `${annotationApiUrl}/:path*` }];
  },
};

export default nextConfig;
