import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

// Exposes Cloudflare bindings to `next dev` (ADR-0002).
initOpenNextCloudflareForDev();
