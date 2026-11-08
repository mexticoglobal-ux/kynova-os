/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DevCenter } from "./DevCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const press = (scope: ReturnType<typeof within> | typeof screen, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const optionValue = (select: HTMLElement, text: string) => Array.from((select as unknown as HTMLSelectElement).options).find((item) => item.textContent?.startsWith(text))?.value ?? "";
const PROVIDERS = /\b(openai|anthropic|llama|gemini|mistral)\b|workers ai/i;
const FULL_SECRET = /kyn_sim_[a-z0-9]{21}/;
const proposal = (text: RegExp) => screen.getAllByLabelText(/^Propuesta /).find((item) => text.test(item.textContent ?? ""))!;
const card = (name: string) => within(screen.getByLabelText(name));

describe("DevCenter", () => {
  it("opens on the dashboard with keys, apps, webhooks, events, SDK, sandbox, versions, consumption, rate limits and logs", () => {
    render(<DevCenter />);
    expect(screen.getByText(/no hay API, OAuth, webhooks ni SDK reales/)).toBeTruthy();
    for (const name of ["API Keys", "Aplicaciones", "Webhooks", "Eventos", "SDK", "Sandbox", "Versiones", "Consumo", "Rate Limits", "Logs"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("API Keys").getByText("3")).toBeTruthy();
    expect(kpi("API Keys").getByText(/activas de 4 · 1 revocadas · 0 expiradas/)).toBeTruthy();
    expect(kpi("Aplicaciones").getByText(/2 activas · 1 borradores · 0 pausadas/)).toBeTruthy();
    expect(kpi("Webhooks").getByText(/activos de 2/)).toBeTruthy();
    expect(kpi("Eventos").getByText(/7 entregas simuladas · 3 fallidas/)).toBeTruthy();
    expect(kpi("SDK").getByText("7")).toBeTruthy();
    expect(kpi("Sandbox").getByText("Pruebas Nova")).toBeTruthy();
    expect(kpi("Sandbox").getByText(/latencia 120 ms · 5 % de errores simulados/)).toBeTruthy();
    expect(kpi("Versiones").getByText("v0, v1")).toBeTruthy();
    expect(kpi("Consumo").getByText(/peticiones/)).toBeTruthy();
    expect(kpi("Rate Limits").getByText(/300 por minuto/)).toBeTruthy();
    expect(kpi("Logs").getByText("nunca se borran")).toBeTruthy();
  });

  it("shows KOE's recommendations and the rate limits by company, app and key", () => {
    render(<DevCenter />);
    const list = within(screen.getByRole("list", { name: "Recomendaciones de KOE" }));
    expect(list.getByText(/«Reportes» expira en 10 días/)).toBeTruthy();
    expect(list.getByText(/«Prueba antigua» lleva 60 días sin usarse/)).toBeTruthy();
    expect(list.getByText(/webhook https:\/\/fail\.nova\.example\/hook falló 3 veces/)).toBeTruthy();
    expect(list.getByText(/«Reportes Nova» usa la versión v0, que se retirará/)).toBeTruthy();
    expect(list.getByText(/API Key «Sync CRM»: 85 de 100 peticiones por minuto/)).toBeTruthy();
    const table = within(screen.getByRole("table", { name: "Rate limits" }));
    const row = table.getByText("Sync CRM").closest("tr") as HTMLElement;
    expect(within(row).getByText("Cerca del límite")).toBeTruthy();
    expect(table.getAllByText("Empresa").length).toBe(2); // the level and the name
    expect(screen.getByText("Consumo por aplicación")).toBeTruthy();
    expect(screen.getByText("Consumo por endpoint")).toBeTruthy();
  });

  it("asks KOE for an analysis, recording the Worker and model, and keeps the history", () => {
    render(<DevCenter />);
    const before = within(screen.getByRole("list", { name: "Historial de análisis de KOE" })).getAllByRole("listitem").length;
    press(screen, "Pedir un análisis a KOE");
    const history = within(screen.getByRole("list", { name: "Historial de análisis de KOE" })).getAllByRole("listitem");
    expect(history.length).toBe(before + 1);
    expect(history[0]?.textContent).toMatch(/modelo .+[ ·]+[0-9]+ recomendaciones/);
  });

  it("shows a secret once when a person approves NEX's proposal, and never keeps it", () => {
    render(<DevCenter />);
    actAs("nova-carla");
    press(within(proposal(/Crear la API Key «Reportes v1»/)), "Aprobar");
    expect(alertText()).toMatch(/Solo el propietario o quien desarrolla/);
    actAs("nex");
    press(within(proposal(/Crear la API Key «Reportes v1»/)), "Aprobar");
    expect(alertText()).toMatch(/NEX solo puede preparar propuestas/);
    actAs("nova-pablo");
    press(within(proposal(/Crear la API Key «Reportes v1»/)), "Aprobar");
    expect(screen.queryByRole("alert")).toBeNull();
    const shown = screen.getByRole("status", { name: "Secreto creado" });
    const secret = (shown.textContent ?? "").match(FULL_SECRET)?.[0] ?? "";
    expect(secret).toMatch(/^kyn_sim_/);
    expect(shown.textContent).toMatch(/no se vuelve a mostrar/);
    tab("API Keys");
    expect(screen.queryByRole("status", { name: "Secreto creado" })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(secret);
    expect(card("API Key Reportes v1").getByText(/kyn_sim_[a-z0-9]{4}…[a-z0-9]{4}/)).toBeTruthy();
  });

  it("lists the keys masked and creates, edits, regenerates and revokes them", () => {
    render(<DevCenter />);
    tab("API Keys");
    const sync = card("API Key Sync CRM");
    expect(sync.getByText(/kyn_sim_[a-z0-9]{4}…[a-z0-9]{4}/)).toBeTruthy();
    expect(sync.getByText(/100 peticiones por minuto/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(FULL_SECRET);
    // create
    fireEvent.change(screen.getByLabelText("Nombre de la llave"), { target: { value: "Mi llave" } });
    fireEvent.click(within(screen.getByLabelText("Permisos de la llave")).getByLabelText("CRM · leer"));
    press(screen, "Crear API Key");
    expect(screen.queryByRole("alert")).toBeNull();
    const created = screen.getByRole("status", { name: "Secreto creado" }).textContent?.match(FULL_SECRET)?.[0] ?? "";
    expect(created).toMatch(/^kyn_sim_/);
    expect(card("API Key Mi llave").getByText("Activa")).toBeTruthy();
    // regenerate: the old one is revoked and the new secret is different, shown once
    press(card("API Key Mi llave"), "Regenerar");
    const regenerated = screen.getByRole("status", { name: "Secreto creado" }).textContent?.match(FULL_SECRET)?.[0] ?? "";
    expect(regenerated).not.toBe(created);
    const both = screen.getAllByLabelText("API Key Mi llave");
    expect(both.length).toBe(2);
    expect(both.some((item) => within(item).queryByText("Revocada"))).toBe(true);
    expect(document.body.textContent ?? "").not.toContain(created);
    // edit and revoke
    press(card("API Key Sync CRM"), "Editar");
    fireEvent.change(screen.getByLabelText("Nuevo nombre"), { target: { value: "Sync CRM 2" } });
    press(screen, "Guardar");
    press(card("API Key Sync CRM 2"), "Revocar");
    expect(card("API Key Sync CRM 2").getByText("Revocada")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lets NEX only prepare a key, which then waits for a person", () => {
    render(<DevCenter />);
    actAs("nex");
    tab("API Keys");
    fireEvent.change(screen.getByLabelText("Nombre de la llave"), { target: { value: "Llave de NEX" } });
    fireEvent.click(within(screen.getByLabelText("Permisos de la llave")).getByLabelText("CRM · leer"));
    press(screen, "Preparar propuesta");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status", { name: "Secreto creado" })).toBeNull();
    expect(screen.queryByLabelText("API Key Llave de NEX")).toBeNull();
    tab("Panel");
    expect(within(proposal(/Llave de NEX/)).getByText("Propuesta de NEX")).toBeTruthy();
  });

  it("works the webhooks: delivery history, retries, pausing, deleting and creating", () => {
    render(<DevCenter />);
    tab("Webhooks");
    expect(screen.getByLabelText("Webhook https://hooks.nova.example/kynova")).toBeTruthy();
    const failing = card("Webhook https://fail.nova.example/hook");
    const deliveries = () => within(screen.getByRole("list", { name: "Entregas" })).getAllByRole("listitem");
    const total = deliveries().length;
    expect(total).toBe(7);
    const failed = deliveries().find((item) => /Fallido/.test(item.textContent ?? "") && /intento 1: 500/.test(item.textContent ?? "") && !/intento 2/.test(item.textContent ?? ""))!;
    expect(failed.textContent).toMatch(/Firma v1=[0-9a-f]{16}/);
    press(within(failed), "Reintentar");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(deliveries().some((item) => /intento 2: 500/.test(item.textContent ?? ""))).toBe(true);
    expect(deliveries().length).toBe(total); // a retry adds an attempt, not a delivery
    press(failing, "Pausar");
    expect(failing.getByText("Pausado")).toBeTruthy();
    press(failing, "Eliminar");
    expect(failing.getByText("Eliminado")).toBeTruthy();
    expect(failing.queryByRole("button", { name: "Pausar" })).toBeNull();
    expect(deliveries().length).toBe(total); // deleting a webhook keeps its history
    // create
    fireEvent.change(screen.getByLabelText("Dirección del webhook"), { target: { value: "http://inseguro.example" } });
    fireEvent.click(within(screen.getByLabelText("Eventos del webhook")).getByLabelText("Mensaje recibido"));
    press(screen, "Crear webhook");
    expect(alertText()).toMatch(/No es válido/);
    fireEvent.change(screen.getByLabelText("Dirección del webhook"), { target: { value: "https://hooks.nova.example/nuevo" } });
    press(screen, "Crear webhook");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status", { name: "Secreto creado" }).textContent).toMatch(/whsec_sim_/);
    expect(screen.getByLabelText("Webhook https://hooks.nova.example/nuevo")).toBeTruthy();
  });

  it("simulates a webhook event and rotates its secret", () => {
    render(<DevCenter />);
    tab("Webhooks");
    const good = card("Webhook https://hooks.nova.example/kynova");
    press(good, "Rotar el secreto");
    expect(screen.getByRole("status", { name: "Secreto creado" }).textContent).toMatch(/whsec_sim_/);
    fireEvent.change(screen.getByLabelText("Evento a simular"), { target: { value: "crm.lead.created" } });
    press(good, "Simular un evento");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Entregas" })).getAllByRole("listitem").length).toBe(8);
  });

  it("shows the sandbox with its simulated data, emits events and creates one for a company that has none", () => {
    render(<DevCenter />);
    tab("Sandbox");
    expect(screen.getByLabelText("Configuración del sandbox")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Datos del sandbox" })).getAllByRole("row").length).toBe(6);
    const events = () => within(screen.getByRole("list", { name: "Eventos del sandbox" })).getAllByRole("listitem");
    const before = events().length;
    press(screen, "Emitir evento simulado");
    expect(events().length).toBe(before + 1);
    expect(events()[0]?.textContent).toMatch(/Prospecto creado · 1 entregas simuladas/);
    actAs("vida-lucia");
    expect(screen.getByLabelText("Crear el sandbox")).toBeTruthy();
    press(screen, "Crear sandbox");
    expect(screen.getByLabelText("Configuración del sandbox")).toBeTruthy();
  });

  it("keeps the logs, filtered by type, and offers no way to delete them", () => {
    render(<DevCenter />);
    tab("Logs");
    expect(screen.getByText(/Los logs nunca se borran: solo crecen/)).toBeTruthy();
    const all = within(screen.getByRole("list", { name: "Logs" })).getAllByRole("listitem").length;
    expect(all).toBeGreaterThan(20);
    fireEvent.change(screen.getByLabelText("Tipo de log"), { target: { value: "error" } });
    const errors = within(screen.getByRole("list", { name: "Logs" })).getAllByRole("listitem");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.length).toBeLessThan(all);
    for (const item of errors) expect(item.textContent).toMatch(/Errores/);
    expect(screen.queryByRole("button", { name: /borrar|eliminar|limpiar/i })).toBeNull();
  });

  it("models the marketplace apps, activates them as a person and only records a publication request", () => {
    render(<DevCenter />);
    tab("Marketplace Apps");
    for (const name of ["Nova CRM Sync", "Reportes Nova", "Prompt Pack Ventas"]) expect(screen.getByLabelText(`Aplicación ${name}`), name).toBeTruthy();
    const kinds = Array.from((screen.getByLabelText("Tipo de aplicación") as unknown as HTMLSelectElement).options).map((item) => item.textContent);
    expect(kinds).toEqual(["App", "Plugin", "Worker", "Prompt", "Template", "Automatización", "Conector"]);
    expect(screen.getByText(/no se publica nada/)).toBeTruthy();
    const prompt = card("Aplicación Prompt Pack Ventas");
    press(prompt, "Activar");
    expect(prompt.getByText("Activa")).toBeTruthy();
    press(prompt, "Solicitar publicación");
    expect(screen.queryByRole("alert")).toBeNull();
    const requests = within(screen.getByRole("list", { name: "Solicitudes de publicación" }));
    const mine = requests.getAllByRole("listitem").find((item) => /Prompt Pack Ventas/.test(item.textContent ?? ""))!;
    press(within(mine), "Aprobar");
    expect(within(mine).getByText("Aprobada (nada se publica hoy)")).toBeTruthy();
    // create an app
    fireEvent.change(screen.getByLabelText("Nombre de la aplicación"), { target: { value: "Plantilla nueva" } });
    fireEvent.change(screen.getByLabelText("Tipo de aplicación"), { target: { value: "template" } });
    fireEvent.click(within(screen.getByLabelText("Permisos de la aplicación")).getByLabelText("CRM · leer"));
    press(screen, "Crear aplicación");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(card("Aplicación Plantilla nueva").getByText("Borrador")).toBeTruthy();
  });

  it("lets NEX only ask for a publication with its authorization, and never activate an app", () => {
    render(<DevCenter />);
    actAs("nex");
    tab("Marketplace Apps");
    expect(screen.getAllByText("Solicitud autorizada").length).toBe(1);
    press(card("Aplicación Nova CRM Sync"), "Solicitar publicación");
    expect(alertText()).toMatch(/autorización vigente/); // the daily request is already used
    press(card("Aplicación Prompt Pack Ventas"), "Activar");
    expect(alertText()).toMatch(/NEX solo puede preparar propuestas/);
    fireEvent.change(screen.getByLabelText("Nombre de la aplicación"), { target: { value: "Idea de NEX" } });
    fireEvent.click(within(screen.getByLabelText("Permisos de la aplicación")).getByLabelText("CRM · leer"));
    press(screen, "Preparar propuesta");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByLabelText("Aplicación Idea de NEX")).toBeNull();
  });

  it("explores the API with simulated answers, never a real call", () => {
    render(<DevCenter />);
    tab("Sandbox");
    fireEvent.change(screen.getByLabelText("Errores simulados"), { target: { value: "0" } });
    press(screen, "Guardar");
    tab("API Explorer");
    expect(screen.getByText(/nunca se contacta una API real/)).toBeTruthy();
    expect(screen.getByText("Todavía no hay respuestas.")).toBeTruthy();
    const keySelect = screen.getByLabelText("API Key de la petición");
    fireEvent.change(keySelect, { target: { value: optionValue(keySelect, "Sync CRM") } });
    expect(within(screen.getByRole("list", { name: "Headers" })).getByText(/Authorization: Bearer kyn_sim_[a-z0-9]{4}…[a-z0-9]{4}/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Headers" })).getByText(/KYNOVA-Version: v1/)).toBeTruthy();
    press(screen, "Enviar petición simulada");
    const response = within(screen.getByLabelText("Respuesta simulada"));
    expect(response.getByText("200")).toBeTruthy();
    expect(response.getByText(/GET \/v1\/leads · \d+ ms · versión v1/)).toBeTruthy();
    expect(screen.getByText(/Prospecto de ejemplo/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "leads.create" } });
    expect((screen.getByLabelText("Body") as HTMLTextAreaElement).value).toContain("Prospecto nuevo");
    fireEvent.change(screen.getByLabelText("Endpoint"), { target: { value: "insights.summary" } });
    press(screen, "Enviar petición simulada");
    expect(within(screen.getByLabelText("Respuesta simulada")).getByText("403")).toBeTruthy();
    expect(screen.getByText(/insufficient_scope/)).toBeTruthy();
    tab("Logs");
    expect(within(screen.getByRole("list", { name: "Logs" })).getAllByRole("listitem")[0]?.textContent).toMatch(/api\.request · GET \/v1\/insights\/summary → 403/);
  });

  it("declares the SDKs, OAuth and the future surfaces without building any", () => {
    render(<DevCenter />);
    tab("SDK Center");
    const sdks = within(screen.getByRole("list", { name: "SDK" }));
    for (const name of ["JavaScript", "TypeScript", "Python", "PHP", "C#", "Java", "Go"]) expect(sdks.getByText(name), name).toBeTruthy();
    expect(sdks.getAllByText("Declarado · no implementado").length).toBe(7);
    const oauth = within(screen.getByRole("list", { name: "Flujos de OAuth" }));
    for (const name of ["Authorization Code", "PKCE", "Client Credentials", "Refresh Tokens", "Scopes"]) expect(oauth.getByText(name), name).toBeTruthy();
    expect(oauth.getAllByText("Sin implementar").length).toBe(5);
    const future = within(screen.getByRole("list", { name: "Superficies futuras" }));
    for (const name of ["GraphQL", "gRPC", "OpenAPI", "AsyncAPI", "CLI", "Terraform", "GitHub Apps", "Extensión de VS Code"]) expect(future.getByText(`${name} · no construido`), name).toBeTruthy();
  });

  it("keeps each company apart: Clínica Vida sees only its own", () => {
    render(<DevCenter />);
    actAs("vida-lucia");
    expect(kpi("API Keys").getByText("1")).toBeTruthy();
    expect(kpi("Aplicaciones").getByText(/0 activas · 1 borradores/)).toBeTruthy();
    expect(kpi("Rate Limits").getByText(/60 por minuto/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/Nova CRM Sync|Reportes Nova|fail\.nova/);
    tab("API Keys");
    expect(screen.getByLabelText("API Key Citas")).toBeTruthy();
    expect(screen.queryByLabelText("API Key Sync CRM")).toBeNull();
    tab("Webhooks");
    expect(screen.queryAllByLabelText(/^Webhook /).length).toBe(0);
    expect(screen.getByText("Todavía no hay entregas.")).toBeTruthy();
  });

  it("never shows a provider anywhere in the module", () => {
    render(<DevCenter />);
    for (const name of ["Panel", "API Keys", "Webhooks", "Sandbox", "Logs", "Marketplace Apps", "API Explorer", "SDK Center"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(PROVIDERS);
    }
  });
});
