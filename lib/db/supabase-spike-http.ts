import { NextResponse, type NextRequest } from "next/server";

export function noStore<T extends Response>(response: T): T {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isWithinBodyLimit(request: Request, maxBytes = 4096): boolean {
  const contentLength = request.headers.get("content-length");
  return contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) <= maxBytes;
}

// request.formData() rejects on a missing or wrong Content-Type or a malformed body.
export async function readSpikeForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

export function spikeRedirect(request: NextRequest, path: string): NextResponse {
  return noStore(NextResponse.redirect(new URL(path, request.url), 303));
}
