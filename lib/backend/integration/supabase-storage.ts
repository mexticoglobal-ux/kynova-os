// Storage on Supabase, through the storage contract: the same four methods the in-memory adapter answers. Every path is `<company>/<folder>/<owner>/<name>`, and the
// Storage policies of migration 20261110000100 only let a member read, and a writer add to, the folder of their own company: the database refuses the rest even if
// this code were wrong. A file is retired (marked in public.storage_objects), never erased: there is no delete here. Only the buckets the migration provisions
// (`documents`) are accepted. It uses the signed-in user's client of the request, so RLS and the Storage policies apply to that person.

import { ENVIRONMENT_POLICIES, type Environment, type EnvironmentPolicy } from "../env";
import { parseStoragePath, signedUrlTtl, type StorageAdapter } from "../storage";

type Failure = { message: string } | null;
export interface StorageClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Failure }>;
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: Failure }>;
      download(path: string): Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> } | null; error: Failure }>;
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: Failure }>;
    };
  };
}

/** The buckets the migration creates and protects. The others are declared in the contract but have no bucket or policy yet. */
export const PROVISIONED_BUCKETS = ["documents"] as const;

export class StorageBlockedError extends Error {}

export class SupabaseStorage implements StorageAdapter {
  constructor(private readonly options: { environment: Environment; client: () => Promise<StorageClient>; policy?: Pick<EnvironmentPolicy, "realData" | "demoData"> }) {}

  private location(path: string) {
    const parsed = parseStoragePath(path);
    if (!parsed) throw new Error("ruta no válida");
    if (!(PROVISIONED_BUCKETS as readonly string[]).includes(parsed.bucket)) throw new StorageBlockedError(`el espacio ${parsed.bucket} aún no tiene bucket ni políticas`);
    const policy = this.options.policy ?? ENVIRONMENT_POLICIES[this.options.environment];
    if (!policy.demoData && !policy.realData) throw new StorageBlockedError("este entorno no admite archivos");
    return parsed;
  }

  async put(path: string, body: Uint8Array, options: { mime: string }): Promise<void> {
    const parsed = this.location(path);
    const { error } = await (await this.options.client()).storage.from(parsed.bucket).upload(path, body, { contentType: options.mime, upsert: false });
    if (error) throw new Error("no se pudo guardar el archivo");
  }

  async get(path: string): Promise<Uint8Array | null> {
    const parsed = this.location(path);
    const { data, error } = await (await this.options.client()).storage.from(parsed.bucket).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(path: string, ttlSeconds: number): Promise<string> {
    const parsed = this.location(path);
    const { data, error } = await (await this.options.client()).storage.from(parsed.bucket).createSignedUrl(path, signedUrlTtl(ttlSeconds));
    if (error || !data) throw new Error("no se pudo firmar la dirección");
    return data.signedUrl;
  }

  /** Marks the file retired in the registry. The object itself stays. */
  async retire(path: string): Promise<void> {
    const parsed = this.location(path);
    const { error } = await (await this.options.client()).rpc("retire_storage_object", { p_tenant: parsed.tenantId, p_path: path });
    if (error) throw new Error("no se pudo retirar el archivo");
  }
}
