import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OrgCenter } from "./OrgCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const row = (name: string) => within(screen.getByLabelText(`Usuario ${name}`));
const press = (scope: ReturnType<typeof within>, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const optionValue = (select: HTMLElement, text: string) => Array.from((select as unknown as HTMLSelectElement).options).find((item) => item.textContent?.startsWith(text))?.value ?? "";

describe("OrgCenter", () => {
  it("opens on the dashboard with companies, branches, departments, teams, users, Workers, roles, invitations and the general state", () => {
    render(<OrgCenter />);
    expect(screen.getByText(/no se conecta ningún directorio ni proveedor de identidad/)).toBeTruthy();
    for (const name of ["Empresas", "Sucursales", "Departamentos", "Equipos", "Usuarios", "Workers IA", "Roles", "Invitaciones", "Estado general"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("Empresas").getByText(/Nova Marketing Studio/)).toBeTruthy();
    expect(kpi("Sucursales").getByText("2")).toBeTruthy();
    expect(kpi("Usuarios").getByText("13")).toBeTruthy();
    expect(kpi("Usuarios").getByText(/10 activos · 1 pendientes · 1 suspendidos · 1 deshabilitados/)).toBeTruthy();
    expect(kpi("Workers IA").getByText(/4 en equipos · 1 sin equipo/)).toBeTruthy();
    expect(kpi("Roles").getByText(/9 base · 1 personalizados/)).toBeTruthy();
    expect(kpi("Estado general").getByText("Requiere atención")).toBeTruthy();
  });

  it("shows KOE's recommendations with their reasons: overloaded team, underused Worker, Worker without a team, user without activity", () => {
    render(<OrgCenter />);
    const list = within(screen.getByRole("list", { name: "Recomendaciones de KOE" }));
    expect(list.getByText(/El equipo «Ventas Corporativas» está sobrecargado/)).toBeTruthy();
    expect(list.getByText(/El Worker «Analista de reportes» está infrautilizado/)).toBeTruthy();
    expect(list.getByText(/El Worker «Coordinador» está instalado pero no pertenece a ningún equipo/)).toBeTruthy();
    expect(list.getByText(/María Quesada no tiene actividad/)).toBeTruthy();
    expect(list.getByText(/125 % de lo que puede atender/)).toBeTruthy();
    expect(screen.getByText(/Todas salen del mismo motor/)).toBeTruthy();
  });

  it("asks KOE for an analysis, recording the Worker and model, and keeps the history", () => {
    render(<OrgCenter />);
    const items = () => within(screen.getByRole("list", { name: "Historial de análisis de KOE" })).getAllByRole("listitem");
    expect(items()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Pedir un análisis a KOE" }));
    expect(items()).toHaveLength(2);
    expect(items()[0].textContent).toContain("Analista de reportes");
  });

  it("lets a recommendation become a proposal, and a manager (not NEX) approve it", () => {
    render(<OrgCenter />);
    const proposals = () => within(screen.getByRole("list", { name: "Propuestas" })).getAllByLabelText(/^Propuesta /);
    const before = proposals().length;
    fireEvent.click(screen.getByRole("button", { name: /Preparar propuesta: mover a/ }));
    expect(proposals()).toHaveLength(before + 1);
    actAs("nex");
    const move = proposals().find((item) => item.textContent?.includes("Mover a Nora Campos"));
    press(within(move as HTMLElement), "Aprobar");
    expect(alertText()).toContain("NEX solo puede preparar");
    actAs("nova-pablo");
    press(within(proposals().find((item) => item.textContent?.includes("Mover a Nora Campos")) as HTMLElement), "Aprobar");
    expect(within(proposals().find((item) => item.textContent?.includes("Mover a Nora Campos")) as HTMLElement).getByText("Aprobada")).toBeTruthy();
    actAs("nova-carla");
    press(within(proposals().find((item) => item.textContent?.includes("Rosa Mena")) as HTMLElement), "Aprobar");
    expect(alertText()).toContain("Su rol no le permite");
  });

  it("shows the audit with categories, and never deletes anything", () => {
    render(<OrgCenter />);
    const entries = () => within(screen.getByRole("list", { name: "Registro de auditoría" })).getAllByRole("listitem");
    const all = entries().length;
    fireEvent.change(screen.getByLabelText("Categoría de auditoría"), { target: { value: "permissions" } });
    expect(entries().length).toBeLessThan(all);
    expect(entries()[0].textContent).toContain("Permisos");
    fireEvent.change(screen.getByLabelText("Categoría de auditoría"), { target: { value: "" } });
    expect(entries().length).toBe(all);
    expect(screen.queryByRole("button", { name: /eliminar|borrar/i })).toBeNull();
  });

  it("draws the organization tree: company, branches, departments, teams, people and AI Workers in the same team", () => {
    render(<OrgCenter />);
    tab("Organigrama");
    const company = within(screen.getByLabelText("Empresa Nova Marketing Studio"));
    expect(company.getByText(/propietario ana/)).toBeTruthy();
    const central = within(screen.getByLabelText("Sucursal Sede Central"));
    expect(central.getByLabelText("Departamento Comercial")).toBeTruthy();
    const sales = within(screen.getByLabelText("Equipo Ventas Corporativas"));
    expect(sales.getByText(/Pablo Mora · Gerente/)).toBeTruthy();
    expect(sales.getByText(/Carla Jiménez · Ventas/)).toBeTruthy();
    expect(sales.getByText("IA · Asistente comercial")).toBeTruthy(); // a Worker belongs to the team like a person
    expect(within(screen.getByLabelText("Sucursal Sucursal Norte")).getByLabelText("Equipo Ventas Norte")).toBeTruthy();
    const none = within(screen.getByLabelText("Sin equipo"));
    expect(none.getByText("IA · Coordinador")).toBeTruthy();
    expect(none.getByText("Jorge Ureña")).toBeTruthy();
  });

  it("lists users with state, last access, language and time zone, and invites a new person who stays pending", () => {
    render(<OrgCenter />);
    tab("Usuarios");
    expect(within(screen.getByRole("table", { name: "Usuarios" })).getAllByRole("row")).toHaveLength(14);
    const carla = row("Carla Jiménez");
    expect(carla.getByText("Activo")).toBeTruthy();
    expect(carla.getByText("America/Costa_Rica")).toBeTruthy();
    expect(row("Kira Matamoros").getByText("Suspendido")).toBeTruthy();
    expect(row("Leo Salas").getByText("Deshabilitado")).toBeTruthy();
    expect(row("Jorge Ureña").getByText("Pendiente")).toBeTruthy();
    expect(row("Jorge Ureña").getByText("nunca")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nombre de la persona invitada"), { target: { value: "Paula Rivas" } });
    fireEvent.change(screen.getByLabelText("Correo de la persona invitada"), { target: { value: "paula@nova.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    expect(row("Paula Rivas").getByText("Pendiente")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nombre de la persona invitada"), { target: { value: "Otra Paula" } });
    fireEvent.change(screen.getByLabelText("Correo de la persona invitada"), { target: { value: "paula@nova.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    expect(alertText()).toContain("Ya existe");
    press(within(screen.getByRole("list", { name: "Invitaciones" })), "Simular aceptación de Paula Rivas (plataforma)");
    expect(row("Paula Rivas").getByText("Activo")).toBeTruthy();
  });

  it("suspends and reactivates with the right authority, never deletes, and refuses NEX and the unauthorized", () => {
    render(<OrgCenter />);
    tab("Usuarios");
    press(row("Carla Jiménez"), "Suspender Carla Jiménez");
    expect(row("Carla Jiménez").getByText("Suspendido")).toBeTruthy();
    press(row("Carla Jiménez"), "Reactivar Carla Jiménez");
    expect(row("Carla Jiménez").getByText("Activo")).toBeTruthy();
    actAs("nex");
    press(row("Diego Solano"), "Deshabilitar Diego Solano");
    expect(alertText()).toContain("NEX solo puede preparar");
    actAs("nova-carla");
    press(row("Diego Solano"), "Suspender Diego Solano");
    expect(alertText()).toContain("Su rol no le permite");
    expect(screen.getByText(/Nadie se elimina/)).toBeTruthy();
  });

  it("keeps an administrator's role for an administrator only: a manager is refused", () => {
    render(<OrgCenter />);
    tab("Usuarios");
    actAs("nova-pablo");
    fireEvent.change(screen.getByLabelText("Rol de Carla Jiménez"), { target: { value: optionValue(screen.getByLabelText("Rol de Carla Jiménez"), "Administrador") } });
    expect(alertText()).toContain("solo lo hace un administrador");
    fireEvent.change(screen.getByLabelText("Rol de Carla Jiménez"), { target: { value: optionValue(screen.getByLabelText("Rol de Carla Jiménez"), "Marketing") } });
    expect((screen.getByLabelText("Rol de Carla Jiménez") as unknown as HTMLSelectElement).selectedOptions[0].textContent).toBe("Marketing");
  });

  it("shows the teams with specialty, goals, lead, people and Workers, and creates one", () => {
    render(<OrgCenter />);
    tab("Equipos");
    const sales = within(screen.getByLabelText("Equipo Ventas Corporativas"));
    expect(sales.getByText("sales")).toBeTruthy();
    expect(sales.getByText(/Cerrar 8 cuentas este trimestre/)).toBeTruthy();
    expect(sales.getByText(/Responsable: Pablo Mora/)).toBeTruthy();
    expect(sales.getByText("IA · Asistente comercial")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Nombre del equipo"), { target: { value: "Cuentas Clave" } });
    fireEvent.change(screen.getByLabelText("Objetivos del equipo"), { target: { value: "Retener cuentas; Crecer 10 %" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear equipo" }));
    expect(within(screen.getByLabelText("Equipo Cuentas Clave")).getByText(/Crecer 10 %/)).toBeTruthy();
  });

  it("moves a person and a Worker to a team with history, and refuses NEX for Workers", () => {
    render(<OrgCenter />);
    tab("Equipos");
    const subject = screen.getByLabelText("Integrante");
    const target = screen.getByLabelText("Equipo de destino");
    fireEvent.change(subject, { target: { value: "user:hector" } });
    fireEvent.change(target, { target: { value: optionValue(target, "Ventas Norte") } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar al equipo" }));
    expect(within(screen.getByLabelText("Equipo Ventas Norte")).getByText("Héctor Pérez")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Historial de equipos" })).getAllByRole("listitem")[0].textContent).toContain("Héctor Pérez → Ventas Norte");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Integrante"), { target: { value: "worker:coordinator" } });
    fireEvent.change(screen.getByLabelText("Equipo de destino"), { target: { value: optionValue(screen.getByLabelText("Equipo de destino"), "Analítica") } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar al equipo" }));
    expect(alertText()).toContain("NEX solo puede preparar");
  });

  it("moves a person as NEX only with a vigente authorization, and says so when it is revoked", () => {
    render(<OrgCenter />);
    tab("Equipos");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Integrante"), { target: { value: "user:hector" } });
    fireEvent.change(screen.getByLabelText("Equipo de destino"), { target: { value: optionValue(screen.getByLabelText("Equipo de destino"), "Ventas Norte") } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar al equipo" }));
    expect(within(screen.getByLabelText("Equipo Ventas Norte")).getByText("Héctor Pérez")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Historial de equipos" })).getAllByRole("listitem")[0].textContent).toContain("automático, con autorización");
    tab("Panel");
    actAs("nova-ana");
    fireEvent.click(screen.getByRole("button", { name: "Revocar autorización" }));
    tab("Equipos");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Integrante"), { target: { value: "user:diego" } });
    fireEvent.change(screen.getByLabelText("Equipo de destino"), { target: { value: optionValue(screen.getByLabelText("Equipo de destino"), "Ventas Norte") } });
    fireEvent.click(screen.getByRole("button", { name: "Asignar al equipo" }));
    expect(alertText()).toContain("necesita una autorización vigente");
  });

  it("lists the roles (own copy per company, critical ones flagged) and lets only an administrator create one", () => {
    render(<OrgCenter />);
    tab("Roles");
    const list = within(screen.getByRole("list", { name: "Roles" }));
    for (const name of ["Administrador", "Gerente", "Supervisor", "Ventas", "Marketing", "Finanzas", "RRHH", "Soporte", "Solo lectura", "Analista"]) expect(list.getByText(name), name).toBeTruthy();
    expect(within(screen.getByLabelText("Rol Administrador")).getByText("Crítico")).toBeTruthy();
    expect(within(screen.getByLabelText("Rol Analista")).getByText("Personalizado")).toBeTruthy();
    actAs("nova-pablo");
    fireEvent.change(screen.getByLabelText("Nombre del rol"), { target: { value: "Auditor" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear rol" }));
    expect(alertText()).toContain("solo lo hace un administrador");
    actAs("nova-ana");
    fireEvent.click(screen.getByRole("button", { name: "Crear rol" }));
    expect(within(screen.getByRole("list", { name: "Roles" })).getByText("Auditor")).toBeTruthy();
  });

  it("shows the permission matrix for the eleven modules, changes one with an administrator, and flags the critical ones", () => {
    render(<OrgCenter />);
    tab("Permisos");
    const matrix = within(screen.getByRole("table", { name: "Matriz de permisos" }));
    for (const moduleName of ["CRM", "Academy", "Marketplace", "Workers", "Insights", "Pagos", "Comunicaciones", "AI Studio", "Automatizaciones", "Integraciones", "Developer Center"]) expect(matrix.getByText(moduleName), moduleName).toBeTruthy();
    expect((screen.getByLabelText("Permiso Administrador CRM") as unknown as HTMLSelectElement).disabled).toBe(true);
    actAs("nova-pablo");
    fireEvent.change(screen.getByLabelText("Permiso Ventas Pagos"), { target: { value: "manage" } });
    expect(alertText()).toContain("solo lo hace un administrador");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Permiso Ventas Pagos"), { target: { value: "manage" } });
    expect(alertText()).toContain("NEX solo puede preparar");
    actAs("nova-ana");
    fireEvent.change(screen.getByLabelText("Permiso Ventas Pagos"), { target: { value: "manage" } });
    expect((screen.getByLabelText("Permiso Ventas Pagos") as unknown as HTMLSelectElement).value).toBe("manage");
    expect(within(screen.getByLabelText("Permisos de Ventas")).getByText(/Ventas ⚠/)).toBeTruthy(); // now a critical role
  });

  it("shows the branches with their teams, people, Workers and settings, and deactivates instead of deleting", () => {
    render(<OrgCenter />);
    tab("Sucursales");
    const central = within(screen.getByLabelText("Sucursal Sede Central"));
    expect(central.getByText(/3 departamentos · 5 equipos/)).toBeTruthy();
    expect(central.getByText(/Moneda USD · Horario 08:00-17:00/)).toBeTruthy();
    expect(within(screen.getByLabelText("Sucursal Sucursal Norte")).getByText(/Horario 07:00-16:00/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Idioma de Sucursal Norte"), { target: { value: "en" } });
    expect((screen.getByLabelText("Idioma de Sucursal Norte") as unknown as HTMLSelectElement).value).toBe("en");
    press(within(screen.getByLabelText("Sucursal Sucursal Norte")), "Desactivar Sucursal Norte");
    expect(within(screen.getByLabelText("Sucursal Sucursal Norte")).getByText("Inactiva")).toBeTruthy();
    actAs("nova-pablo");
    fireEvent.change(screen.getByLabelText("Nombre de la sucursal"), { target: { value: "Oeste" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear sucursal" }));
    expect(alertText()).toContain("solo lo hace un administrador");
  });

  it("shows people and AI Workers in one workforce view with status, specialty, team, workload, availability and estimated cost", () => {
    render(<OrgCenter />);
    tab("Fuerza de trabajo");
    const table = within(screen.getByRole("table", { name: "Fuerza de trabajo" }));
    expect(table.getAllByRole("row")).toHaveLength(20); // header + 13 people + 6 Workers
    const carla = within(screen.getByLabelText("Fila Carla Jiménez"));
    expect(carla.getByText("Persona")).toBeTruthy();
    expect(carla.getByText("Ventas Corporativas")).toBeTruthy();
    expect(carla.getByText("24 abiertos · 200.0 %")).toBeTruthy();
    expect(carla.getByText("Ocupado")).toBeTruthy();
    expect(carla.getByText("US$ 2 500.00 al mes")).toBeTruthy();
    const worker = within(screen.getByLabelText("Fila Asistente comercial"));
    expect(worker.getByText("Worker IA")).toBeTruthy();
    expect(worker.getByText("Ventas Corporativas")).toBeTruthy();
    expect(worker.getByText("Disponible")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "worker" } });
    expect(within(screen.getByRole("table", { name: "Fuerza de trabajo" })).getAllByRole("row")).toHaveLength(7);
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Disponibilidad"), { target: { value: "busy" } });
    expect(within(screen.getByRole("table", { name: "Fuerza de trabajo" })).getAllByRole("row")).toHaveLength(2);
    expect(screen.getByText(/no una nómina ni una factura/)).toBeTruthy();
  });

  it("opens the Identity Center: profile, language, time zone, notifications, security, sessions and devices; each person changes their own", () => {
    render(<OrgCenter />);
    tab("Identidad");
    expect(screen.getByText(/Todo es arquitectura/)).toBeTruthy();
    expect((screen.getByLabelText("Nombre del perfil") as unknown as HTMLInputElement).value).toBe("Ana Rojas");
    fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "en" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Sesiones" })).getAllByRole("listitem")).toHaveLength(2);
    expect(within(screen.getByRole("list", { name: "Dispositivos" })).getByText("De confianza")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Solicitar verificación en dos pasos"));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Persona"), { target: { value: "carla" } });
    fireEvent.click(screen.getByLabelText("Solicitar verificación en dos pasos"));
    expect(alertText()).toContain("solo lo cambia la propia persona"); // not even the owner changes another person's security
    fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "pt" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar perfil" }));
    expect(screen.queryByRole("alert")).toBeNull(); // an administrator may edit another person's profile, never their preferences or security
  });

  it("records a simulated sign-in through the platform, and revokes a session", () => {
    render(<OrgCenter />);
    tab("Identidad");
    fireEvent.click(screen.getByRole("button", { name: "Simular un inicio de sesión (plataforma)" }));
    const sessions = within(screen.getByRole("list", { name: "Sesiones" }));
    expect(sessions.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(sessions.getAllByRole("button", { name: "Cerrar sesión" })[0]);
    expect(within(screen.getByRole("list", { name: "Sesiones" })).getAllByText(/Revocada por ana/)).toHaveLength(1);
  });

  it("declares SSO, Azure AD, Google Workspace, Entra, LDAP, SCIM, Okta and Auth0 without building them", () => {
    render(<OrgCenter />);
    tab("Identidad");
    const future = within(screen.getByRole("list", { name: "Conectores de identidad futuros" }));
    for (const name of ["SSO", "Azure AD", "Google Workspace", "Microsoft Entra", "LDAP", "SCIM", "Okta", "Auth0"]) expect(future.getByText(name)).toBeTruthy();
    expect(future.getAllByText("No construido")).toHaveLength(8);
    expect(screen.getByText(/nunca directo a un proveedor/)).toBeTruthy();
  });

  it("keeps each company apart and never names a provider", () => {
    render(<OrgCenter />);
    actAs("vida-lucia");
    expect(kpi("Usuarios").getByText("2")).toBeTruthy();
    tab("Usuarios");
    expect(within(screen.getByRole("table", { name: "Usuarios" })).getAllByRole("row")).toHaveLength(3);
    expect(screen.queryByLabelText("Usuario Carla Jiménez")).toBeNull();
    for (const name of ["Panel", "Organigrama", "Usuarios", "Equipos", "Roles", "Permisos", "Sucursales", "Identidad", "Fuerza de trabajo"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(/proveedor-|openai|anthropic|gemini|mistral/i);
    }
  });
});
