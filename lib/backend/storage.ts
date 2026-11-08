// Storage architecture: where files live, who may reach them and what may be uploaded. Every object lives under its company's folder, so a path
// alone says whose it is and a company can never reach another's file. Nothing here talks to a storage service: an adapter is only an interface.
import type { ModuleId } from "./events";

export const BUCKET_IDS = ["documents", "images", "videos", "avatars", "academy", "marketplace"] as const;
export type BucketId = (typeof BUCKET_IDS)[number];

export type BucketSpec = {
  id: BucketId;
  module: ModuleId;
  description: string;
  /** A public bucket may be read without signing in (marketplace listings and avatars); every private object needs a short-lived signed address. */
  visibility: "private" | "public";
  maxBytes: number;
  mime: readonly string[];
  /** The subfolder under the company folder where each kind of file goes. */
  folder: string;
  /** Files are scanned before they are available. */
  scan: boolean;
};

const MB = 1024 * 1024;
export const BUCKETS: Record<BucketId, BucketSpec> = {
  documents: { id: "documents", module: "organizations", description: "Documentos de la empresa: contratos, facturas, reportes.", visibility: "private", maxBytes: 25 * MB, mime: ["application/pdf", "text/plain", "text/csv", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], folder: "documents", scan: true },
  images: { id: "images", module: "organizations", description: "Imágenes de la empresa.", visibility: "private", maxBytes: 10 * MB, mime: ["image/png", "image/jpeg", "image/webp"], folder: "images", scan: true },
  videos: { id: "videos", module: "academy", description: "Videos de trabajo y de cursos.", visibility: "private", maxBytes: 512 * MB, mime: ["video/mp4", "video/webm"], folder: "videos", scan: true },
  avatars: { id: "avatars", module: "users", description: "Fotos de perfil de las personas.", visibility: "public", maxBytes: 2 * MB, mime: ["image/png", "image/jpeg", "image/webp"], folder: "avatars", scan: true },
  academy: { id: "academy", module: "academy", description: "Archivos de los cursos: materiales y certificados.", visibility: "private", maxBytes: 100 * MB, mime: ["application/pdf", "image/png", "image/jpeg", "video/mp4", "text/plain"], folder: "academy", scan: true },
  marketplace: { id: "marketplace", module: "marketplace", description: "Archivos de lo que se ofrece en el Marketplace.", visibility: "public", maxBytes: 50 * MB, mime: ["image/png", "image/jpeg", "image/webp", "application/pdf", "application/zip"], folder: "marketplace", scan: true },
};

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const TENANT = /^[A-Za-z0-9_.:-]{1,64}$/;

/** The object path of a file: `<company>/<folder>/<owner>/<name>`. Any segment that could climb out of the folder is refused. */
export function storagePath(input: { bucket: BucketId; tenantId: string; owner: string; name: string }): string | null {
  const spec = BUCKETS[input.bucket];
  if (!spec || !TENANT.test(input.tenantId) || !SEGMENT.test(input.owner) || !SEGMENT.test(input.name) || input.name.includes("..")) return null;
  return `${input.tenantId}/${spec.folder}/${input.owner}/${input.name}`;
}

export type ParsedPath = { tenantId: string; bucket: BucketId; owner: string; name: string };
export function parseStoragePath(path: string): ParsedPath | null {
  const parts = path.split("/");
  if (parts.length !== 4) return null;
  const [tenantId, folder, owner, name] = parts as [string, string, string, string];
  const bucket = BUCKET_IDS.find((id) => BUCKETS[id].folder === folder);
  if (!bucket || !TENANT.test(tenantId) || !SEGMENT.test(owner) || !SEGMENT.test(name) || name.includes("..")) return null;
  return { tenantId, bucket, owner, name };
}

/** A company may reach an object only when the first folder of its path is that company. */
export const canAccessPath = (tenantId: string, path: string): boolean => parseStoragePath(path)?.tenantId === tenantId;

export type UploadCheck = { ok: true } | { ok: false; reason: string };
export function validateUpload(input: { bucket: BucketId; mime: string; bytes: number; name: string }): UploadCheck {
  const spec = BUCKETS[input.bucket];
  if (!spec) return { ok: false, reason: "No existe ese espacio de archivos." };
  if (!Number.isInteger(input.bytes) || input.bytes < 1) return { ok: false, reason: "El archivo está vacío." };
  if (input.bytes > spec.maxBytes) return { ok: false, reason: `El archivo supera el máximo de ${Math.floor(spec.maxBytes / MB)} MB de ${spec.id}.` };
  if (!spec.mime.includes(input.mime)) return { ok: false, reason: `El tipo ${input.mime} no se acepta en ${spec.id}.` };
  if (!SEGMENT.test(input.name) || input.name.includes("..")) return { ok: false, reason: "El nombre del archivo no es válido." };
  return { ok: true };
}

/** How long a signed address of a private object lasts. */
export const SIGNED_URL_TTL_SECONDS = { default: 300, max: 3_600 } as const;
export const signedUrlTtl = (requested?: number): number => (requested === undefined ? SIGNED_URL_TTL_SECONDS.default : Math.min(Math.max(Math.floor(requested), 30), SIGNED_URL_TTL_SECONDS.max));

/** What a real storage service must offer. Declared only: nothing implements it yet. Deleting is not part of it: a file is retired, not erased, until a retention rule says so. */
export interface StorageAdapter {
  put(path: string, body: Uint8Array, options: { mime: string }): Promise<void>;
  get(path: string): Promise<Uint8Array | null>;
  signedUrl(path: string, ttlSeconds: number): Promise<string>;
  retire(path: string): Promise<void>;
}
