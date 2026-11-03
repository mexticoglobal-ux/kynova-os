import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// No incremental cache yet: there is no ISR. Caching is decided in its own ADR (ADR-0002).
export default defineCloudflareConfig({});
