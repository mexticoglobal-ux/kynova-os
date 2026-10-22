/** Company Integrations texts. One entry = [key, Spanish, English]. */
const E = [
  ["title", "Integraciones de tu empresa", "Your company's integrations"], ["sub", "Un solo lugar para ver el estado de cada plataforma. Todavía no se conecta ninguna: no hay OAuth ni sincronización.", "One place to see the state of every platform. None is connected yet: there is no OAuth and no sync."],
  ["col.name", "Nombre", "Name"], ["col.status", "Estado", "Status"], ["col.sync", "Última sincronización", "Last sync"], ["col.health", "Health", "Health"], ["col.kind", "Tipo", "Type"], ["col.action", "Acción", "Action"],
  ["status.not_configured", "Sin configurar", "Not configured"], ["status.pending", "Pendiente", "Pending"], ["status.connected", "Conectada", "Connected"], ["status.error", "Error", "Error"], ["status.coming_soon", "Disponible próximamente", "Coming soon"],
  ["health.ok", "Saludable", "Healthy"], ["health.error", "Con error", "Failing"], ["health.unknown", "Sin datos", "No data"], ["sync.never", "Nunca", "Never"],
  ["kind.analytics", "Analítica", "Analytics"], ["kind.search", "Búsqueda", "Search"], ["kind.social", "Redes sociales", "Social"], ["kind.productivity", "Productividad", "Productivity"], ["kind.commerce", "Comercio", "Commerce"], ["kind.infrastructure", "Infraestructura", "Infrastructure"], ["kind.payments", "Pagos", "Payments"],
  ["configure", "Configurar", "Configure"], ["configure.soon", "Disponible próximamente", "Coming soon"], ["save", "Guardar", "Save"], ["saving", "Guardando…", "Saving…"], ["saved", "Guardado", "Saved"], ["error", "Algo salió mal. Inténtalo de nuevo.", "Something went wrong. Try again."],
  ["mc.title", "Estado de integraciones", "Integration status"], ["mc.none", "Ninguna integración está conectada todavía.", "No integration is connected yet."], ["mc.open", "Ver integraciones", "View integrations"],
  ["hl.title", "Company Health", "Company Health"], ["hl.explain", "Cómo se calculó", "How it was calculated"], ["hl.rules", "Solo reglas, sin IA: promedio ponderado de cinco áreas.", "Rules only, no AI: a weighted average of five areas."],
  ["level.excellent", "Excelente", "Excellent"], ["level.healthy", "Saludable", "Healthy"], ["level.attention", "Requiere atención", "Needs attention"], ["level.risk", "Riesgo", "At risk"], ["level.critical", "Crítico", "Critical"],
  ["part.profile", "Perfil", "Profile"], ["part.dna", "DNA", "DNA"], ["part.integrations", "Integraciones", "Integrations"], ["part.team", "Equipo IA", "AI team"], ["part.blueprint", "Blueprint", "Blueprint"],
  ["hl.part", "{name}: {pct}% × peso {weight}% = {points} puntos", "{name}: {pct}% × weight {weight}% = {points} points"],
  ["hl.na", "{name}: no aplica todavía (no existe ninguna integración disponible); su peso se reparte entre las demás áreas.", "{name}: does not apply yet (no integration is available); its weight is shared among the other areas."],
  ["hl.gap", "Pierde {lost} puntos por {name} ({pct}%).", "Loses {lost} points on {name} ({pct}%)."], ["hl.noGaps", "No pierde puntos en ninguna área.", "It loses no points in any area."],
  ["emp.title", "Equipo IA e integraciones", "AI team and integrations"], ["emp.ready", "Puede trabajar con datos reales.", "Can work with real data."],
  ["emp.cant", "No puedo trabajar con datos reales: {list}.", "I cannot work with real data: {list}."],
  ["need.line", "{name}: {status}", "{name}: {status}"], ["need.cant", "No puedo trabajar con {name} porque su estado es: {status}.", "I cannot work with {name} because its status is: {status}."],
] as const;
type Entry = (typeof E)[number];
export type CompanyIntegrationsKey = Entry[0];
export type CompanyIntegrationsLocale = "en" | "es";
const build = (i: 1 | 2): Record<CompanyIntegrationsKey, string> => Object.fromEntries(E.map((e) => [e[0], e[i]])) as Record<CompanyIntegrationsKey, string>;
export const COMPANY_INTEGRATIONS_DICTIONARIES: Record<CompanyIntegrationsLocale, Record<CompanyIntegrationsKey, string>> = { es: build(1), en: build(2) };
export const companyIntegrationsLocale = (l: string | null | undefined): CompanyIntegrationsLocale => (l?.toLowerCase().startsWith("es") ? "es" : "en");
export const tr = (locale: CompanyIntegrationsLocale, key: CompanyIntegrationsKey, vars: Record<string, string | number> = {}): string => (COMPANY_INTEGRATIONS_DICTIONARIES[locale][key] ?? String(key)).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
