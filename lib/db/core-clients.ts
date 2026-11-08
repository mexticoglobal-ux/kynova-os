// The Supabase connection of the Backend Core, prepared and lazy: the configuration comes from the Environment Manager, the service key (when there is
// one) only through the Secrets Manager, and a client is created the first time it is asked for, never before. Nothing here connects on its own, and
// this file is the only place the platform builds a Supabase client for the core. Signed-in requests keep using the cookie client of the existing
// session code; this one is for what the core does itself.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BackendConfig } from "@/lib/backend/env";
import { Lazy } from "@/lib/backend/performance";
import type { SecretsManager } from "@/lib/backend/secrets";

export type ClientFactory = (url: string, key: string, options?: Record<string, unknown>) => SupabaseClient;
export type ClientLoader = () => Promise<ClientFactory>;

/** The real library is loaded only when a client is first needed, so it never weighs on a page that does not use it. */
export const defaultLoader: ClientLoader = async () => (await import("@supabase/supabase-js")).createClient as unknown as ClientFactory;

export class SupabaseClientError extends Error {}

// Auth is handled by the cookie client of the session code: these clients keep no session of their own.
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

export class SupabaseClients {
  private readonly publishable: Lazy<SupabaseClient>;
  private readonly service: Lazy<SupabaseClient>;

  constructor(private readonly config: BackendConfig, private readonly secrets: SecretsManager, private readonly loader: ClientLoader = defaultLoader, private readonly isServer: () => boolean = () => typeof window === "undefined") {
    this.publishable = new Lazy(async () => {
      if (!this.config.supabase) throw new SupabaseClientError("Supabase no está configurado en este entorno.");
      return (await this.loader())(this.config.supabase.url, this.config.supabase.publishableKey, NO_SESSION);
    });
    this.service = new Lazy(async () => {
      if (!this.isServer()) throw new SupabaseClientError("La llave de servicio nunca se usa en el navegador.");
      if (!this.config.supabase) throw new SupabaseClientError("Supabase no está configurado en este entorno.");
      const { url } = this.config.supabase;
      const factory = await this.loader();
      return this.secrets.use("SUPABASE_SERVICE_ROLE_KEY", "cliente de servicio del Backend Core", (key) => factory(url, key, NO_SESSION));
    });
  }

  isConfigured(): boolean {
    return this.config.supabase !== null;
  }

  /** The client that uses the publishable key. Row Level Security is what protects the data it reaches. */
  publishableClient(): Promise<SupabaseClient> {
    return this.publishable.get();
  }

  /** The client that uses the service key, which skips Row Level Security. Server only, and only when the key is configured. */
  serviceClient(): Promise<SupabaseClient> {
    return this.service.get();
  }

  /** A description that is safe to log: the host and what is configured, never a key. */
  describe(): { configured: boolean; host: string | null; serviceKeyConfigured: boolean; publishableClientCreated: boolean; serviceClientCreated: boolean } {
    return {
      configured: this.isConfigured(), host: this.config.supabase ? new URL(this.config.supabase.url).host : null, serviceKeyConfigured: this.config.serviceKeyConfigured,
      publishableClientCreated: this.publishable.initialized, serviceClientCreated: this.service.initialized,
    };
  }
}
