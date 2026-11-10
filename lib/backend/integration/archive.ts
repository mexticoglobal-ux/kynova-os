// Storage and secrets, joined by contracts: the archive of one company's audit trail. The records are sealed with the company's encryption key (read only through the
// Secrets Manager, by name and purpose, bound to the company id so another company can never open them), checked against the bucket's rules, put under the
// company's own folder through the storage contract, and registered in the storage_objects table. The content is never returned or logged: only the path.
// Everything runs on an in-memory storage adapter; a real service only has to answer the same four methods.

import type { AuditRecord } from "../audit";
import { decrypt, encrypt } from "../crypto";
import { SecretMissingError } from "../secrets";
import { canAccessPath, parseStoragePath, signedUrlTtl, storagePath, validateUpload, type StorageAdapter } from "../storage";
import type { BackendCore } from "../index";
import { storageRow, type PersistencePort } from "./persistence";

export const ARCHIVE_KEY = "KYNOVA_ENCRYPTION_KEY";
export const ARCHIVE_PURPOSE = "audit-archive";

/** Files in memory. A retired file is hidden, never erased (the storage contract has no delete). */
export class MemoryStorage implements StorageAdapter {
  private readonly objects = new Map<string, { body: Uint8Array; mime: string }>();
  private readonly retired = new Set<string>();

  async put(path: string, body: Uint8Array, options: { mime: string }): Promise<void> {
    if (!parseStoragePath(path)) throw new Error("ruta no válida");
    this.objects.set(path, { body: Uint8Array.from(body), mime: options.mime });
    this.retired.delete(path);
  }
  async get(path: string): Promise<Uint8Array | null> {
    if (this.retired.has(path)) return null;
    const found = this.objects.get(path);
    return found ? Uint8Array.from(found.body) : null;
  }
  async signedUrl(path: string, ttlSeconds: number): Promise<string> {
    return `simulated://storage/${path}?ttl=${signedUrlTtl(ttlSeconds)}`;
  }
  async retire(path: string): Promise<void> {
    this.retired.add(path);
  }
  paths(): string[] {
    return [...this.objects.keys()];
  }
}

export type ArchiveResult = { ok: true; path: string; records: number; bytes: number } | { ok: false; reason: string };

const day = (iso: string) => iso.slice(0, 10);

/** Seals the audit trail of ONE company and stores it. A company without the key, or without records, archives nothing. */
export async function archiveAudit(core: BackendCore, storage: StorageAdapter, database: PersistencePort, tenantId: string): Promise<ArchiveResult> {
  const records: AuditRecord[] = (await core.audit()).list(tenantId);
  if (records.length === 0) return { ok: false, reason: "la empresa no tiene registros de auditoría" };
  const at = core.clock();
  const name = `audit-${day(at)}.txt`;
  const path = storagePath({ bucket: "documents", tenantId, owner: "system", name });
  if (!path) return { ok: false, reason: "no se pudo armar la ruta del archivo" };
  let envelope: string;
  try {
    envelope = await core.secrets.use(ARCHIVE_KEY, ARCHIVE_PURPOSE, (key) => encrypt(JSON.stringify(records), key, tenantId));
  } catch (error) {
    if (error instanceof SecretMissingError) return { ok: false, reason: "falta la llave de cifrado (se configura como secreto, nunca en el código)" };
    return { ok: false, reason: "no se pudo cifrar el archivo" };
  }
  const body = new TextEncoder().encode(envelope);
  const check = validateUpload({ bucket: "documents", mime: "text/plain", bytes: body.byteLength, name });
  if (!check.ok) return { ok: false, reason: check.reason };
  await storage.put(path, body, { mime: "text/plain" });
  await database.insert("storage_objects", [storageRow({ id: `obj_${tenantId}_${name}`.slice(0, 64), tenantId, bucket: "documents", path, mime: "text/plain", bytes: body.byteLength, at })]);
  return { ok: true, path, records: records.length, bytes: body.byteLength };
}

export type ReadResult = { ok: true; records: AuditRecord[] } | { ok: false; reason: string };

/** Opens an archive. A company can only reach a path under its own folder, and only its own key context opens the seal. */
export async function readArchive(core: BackendCore, storage: StorageAdapter, tenantId: string, path: string): Promise<ReadResult> {
  if (!canAccessPath(tenantId, path)) return { ok: false, reason: "ese archivo no es de esta empresa" };
  const body = await storage.get(path);
  if (!body) return { ok: false, reason: "el archivo no existe" };
  try {
    const text = await core.secrets.use(ARCHIVE_KEY, ARCHIVE_PURPOSE, (key) => decrypt(new TextDecoder().decode(body), key, tenantId));
    return { ok: true, records: JSON.parse(text) as AuditRecord[] };
  } catch {
    return { ok: false, reason: "no se pudo abrir el archivo con la llave de esta empresa" };
  }
}
