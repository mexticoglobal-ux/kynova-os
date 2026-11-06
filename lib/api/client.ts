// Browser-side access to /api/v1. One place for headers, JSON and error shape.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function apiFetch<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string } & T;
    if (!response.ok) return { ok: false, error: data.error ?? "unavailable", status: response.status };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "unavailable", status: 0 };
  }
}

const MESSAGES: Record<string, string> = {
  forbidden: "Tu rol no permite hacer esto.",
  unauthorized: "Tu sesión terminó. Inicia sesión de nuevo.",
  not_found: "Ya no existe o no tienes acceso.",
  conflict: "Eso ya existe.",
  invalid: "Revisa los datos e inténtalo de nuevo.",
  invalid_request: "Revisa los datos e inténtalo de nuevo.",
  limit: "Llegaste a un límite. Inténtalo más tarde.",
  unavailable: "No pudimos conectar con el servidor. Inténtalo de nuevo.",
};

/** A sentence a person can read for an API error code. */
export const errorMessage = (code: string): string => MESSAGES[code] ?? MESSAGES.unavailable;
