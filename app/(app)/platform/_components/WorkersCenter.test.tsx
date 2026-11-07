import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkersCenter } from "./WorkersCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const worker = (name: string) => screen.getByLabelText(`Worker ${name}`);
// closed <details> hide their content in a browser: open the one whose summary starts with this text
const openDetails = (summary: RegExp) => {
  const element = screen.getByText(summary).closest("details");
  if (!element) throw new Error("no details");
  element.setAttribute("open", "");
  return within(element);
};

describe("WorkersCenter", () => {
  it("starts with KYNOVA's Workers as data, each showing its autonomy, tools and collaboration", () => {
    render(<WorkersCenter />);
    expect(screen.getByText(/sin modelos ni herramientas reales/)).toBeTruthy();
    const collections = within(worker("Cobranza"));
    expect(collections.getByText("Nivel 3 · siempre confirma")).toBeTruthy();
    expect(collections.getByText(/Crear enlace de cobro · N3 · externo · dinero/)).toBeTruthy();
    expect(within(worker("Analista de reportes")).getByText("Nivel 1 · observa y prepara")).toBeTruthy();
    expect(within(worker("Tutor de cursos")).getByText("Nivel 2 · autorizado")).toBeTruthy();
    expect(within(worker("Coordinador")).getByText(/Delega en: Asistente comercial, Seguimiento, Analista de reportes, Cobranza/)).toBeTruthy();
    expect(within(worker("Asistente comercial")).getByText(/Recibe de: Coordinador/)).toBeTruthy();
  });

  it("enables Workers per company and shows the collaboration graph only between enabled, agreeing Workers", () => {
    render(<WorkersCenter />);
    expect(screen.getByText(/Todavía no hay colaboración posible/)).toBeTruthy();
    fireEvent.click(within(worker("Coordinador")).getByRole("button", { name: "Activar en mi empresa" }));
    fireEvent.click(within(worker("Asistente comercial")).getByRole("button", { name: "Activar en mi empresa" }));
    expect(screen.getByText("Coordinador → Asistente comercial")).toBeTruthy();
    expect(screen.queryByText("Asistente comercial → Coordinador")).toBeNull();
  });

  it("loads the sample: a coordinator delegated, personal data stayed behind, and one action waits for a person", () => {
    render(<WorkersCenter />);
    loadSample();
    tab("Ejecuciones");
    expect(screen.getByText("Pendientes de una persona (1)")).toBeTruthy();
    expect(screen.getByText(/contenido retenido por privacidad/)).toBeTruthy();
    expect(screen.getAllByText(/Consulta a Rápido A/).length).toBeGreaterThan(0);
    expect(screen.getByText("Enviar seguimiento")).toBeTruthy();
  });

  it("lets the person who started the work approve a message, but a money move needs somebody else", () => {
    render(<WorkersCenter />);
    loadSample();
    tab("Ejecuciones");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar acción" })); // the follow-up message, started by Ana
    expect(screen.getByText("Pendientes de una persona (0)")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Worker a ejecutar"), { target: { value: screen.getByRole("option", { name: "Cobranza" }).getAttribute("value") } });
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "Cobrar a Café Aurora" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar ejecución" }));
    const controls = openDetails(/^Mover como Cobranza/);
    fireEvent.change(controls.getByLabelText(/^Herramienta de rn_/), { target: { value: "payment.createLink" } });
    fireEvent.change(controls.getByPlaceholderText("cliente"), { target: { value: "Café Aurora" } });
    fireEvent.change(controls.getByPlaceholderText("monto"), { target: { value: "50.00 USD" } });
    fireEvent.click(controls.getByRole("button", { name: "Usar herramienta" }));
    expect(screen.getByText("Mueve dinero: lo aprueba otra persona")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Aprobar acción" }));
    expect(alertText()).toContain("distinta de quien inició");
    actAs("nova-pablo");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar acción" }));
    expect(screen.getByText("Pendientes de una persona (0)")).toBeTruthy();
  });

  it("takes a step only as the run's own Worker, and refuses a tool it was not given", () => {
    render(<WorkersCenter />);
    fireEvent.click(within(worker("Analista de reportes")).getByRole("button", { name: "Activar en mi empresa" }));
    tab("Ejecuciones");
    fireEvent.change(screen.getByLabelText("Worker a ejecutar"), { target: { value: screen.getByRole("option", { name: "Analista de reportes" }).getAttribute("value") } });
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "Resumen semanal" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar ejecución" }));
    const controls = openDetails(/^Mover como Analista de reportes/);
    fireEvent.change(controls.getByLabelText(/^Herramienta de rn_/), { target: { value: "summary.prepare" } });
    fireEvent.click(controls.getByRole("button", { name: "Usar herramienta" }));
    expect(alertText()).toContain("Faltan datos");
    fireEvent.change(controls.getByPlaceholderText("tema"), { target: { value: "Prospectos" } });
    fireEvent.click(controls.getByRole("button", { name: "Usar herramienta" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText(/\[allowed · Nivel 1\]/)).toBeTruthy();
  });

  it("does not let NEX start work, approve a Worker or approve an action", () => {
    render(<WorkersCenter />);
    loadSample();
    actAs("nex");
    tab("Ejecuciones");
    fireEvent.change(screen.getByLabelText("Worker a ejecutar"), { target: { value: screen.getByRole("option", { name: "Seguimiento" }).getAttribute("value") } });
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "Quiero empezar solo" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar ejecución" }));
    expect(alertText()).toContain("un Worker no puede");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar acción" }));
    expect(alertText()).toContain("un Worker no puede");
    tab("Workers");
    fireEvent.click(within(worker("Atención de reclamos")).getByRole("button", { name: "Aprobar Worker" }));
    expect(alertText()).toContain("un Worker no puede");
  });

  it("needs a second person of the company to approve a new Worker", () => {
    render(<WorkersCenter />);
    loadSample();
    const card = () => within(worker("Atención de reclamos"));
    expect(card().getByText(/Borrador preparado por worker:nex/)).toBeTruthy();
    fireEvent.click(card().getByRole("button", { name: "Aprobar Worker" })); // Ana submitted it
    expect(alertText()).toContain("no puede aprobarlo");
    actAs("nova-pablo");
    fireEvent.click(card().getByRole("button", { name: "Aprobar Worker" }));
    expect(card().getByText("Activo")).toBeTruthy();
    fireEvent.click(card().getByRole("button", { name: "Activar en mi empresa" }));
    expect(card().getByText(/Activo en su empresa/)).toBeTruthy();
  });

  it("shows and revokes the Level 2 authorization a person gave", () => {
    render(<WorkersCenter />);
    loadSample();
    const sales = within(worker("Asistente comercial"));
    expect(sales.getByText(/Autorizado: faq.answer · 0 de 5 hoy · por ana/)).toBeTruthy();
    fireEvent.click(sales.getByRole("button", { name: "Revocar" }));
    expect(sales.queryByText(/Autorizado: faq.answer/)).toBeNull();
    fireEvent.change(sales.getByLabelText("Máximo por día de faq.answer"), { target: { value: "0" } });
    fireEvent.click(sales.getByRole("button", { name: "Autorizar faq.answer" }));
    expect(alertText()).toContain("de 1 a 1 000");
  });

  it("routes models by capability and data, and lets only administrators change their health", () => {
    render(<WorkersCenter />);
    tab("Modelos (KOE)");
    expect(screen.getByRole("status").textContent).toContain("Elegido: Rápido A");
    fireEvent.click(screen.getByLabelText("Rápido")); // stop asking for "fast"
    fireEvent.click(screen.getByLabelText("Razonamiento"));
    fireEvent.change(screen.getByLabelText("Datos de la tarea"), { target: { value: "personal" } });
    expect(screen.getByRole("status").textContent).toContain("Elegido: Razonamiento B"); // personal data: only a model that does not train on it
    expect(screen.queryByLabelText("Salud de m-reason-b")).toBeNull();

    actAs("admin-ana");
    fireEvent.change(screen.getByLabelText("Salud de m-reason-b"), { target: { value: "down" } });
    expect(screen.getByRole("status").textContent).toContain("Ningún modelo");
  });

  it("keeps a model from a new provider as plain data and refuses an invalid one", () => {
    render(<WorkersCenter />);
    actAs("admin-ana");
    tab("Modelos (KOE)");
    for (const [key, value] of [["id", "m-fast-e"], ["provider", "proveedor-e"], ["label", "Rápido E"], ["classes", "fast"], ["context", "32000"], ["cost", "50"], ["region", ""]] as const) fireEvent.change(screen.getByLabelText(`Nuevo modelo: ${key}`), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar modelo" }));
    expect(screen.getByRole("alert").textContent).toContain("regiones");
    fireEvent.change(screen.getByLabelText("Nuevo modelo: region"), { target: { value: "us" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar modelo" }));
    expect(screen.getByRole("status").textContent).toContain("Elegido: Rápido E"); // now the cheapest "fast" model
  });

  it("shows working memory erased at the end of a run, and lets a person forget what was kept", () => {
    render(<WorkersCenter />);
    loadSample();
    tab("Memoria");
    expect(screen.getByText("Clínica Vida, score 82")).toBeTruthy();
    expect(screen.getByText("(el valor fue borrado)")).toBeTruthy(); // the run's own copy
    fireEvent.click(screen.getByRole("button", { name: "Olvidar" }));
    expect(screen.getAllByText("(el valor fue borrado)")).toHaveLength(2);
  });

  it("builds a Worker from a form, shows its autonomy before it exists, and lists what is missing", () => {
    render(<WorkersCenter />);
    tab("Crear");
    const review = within(screen.getByLabelText("Revisión del Worker"));
    expect(review.getByText(/Falta: al menos una herramienta/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Identificador del Worker"), { target: { value: "atencion" } });
    fireEvent.change(screen.getByLabelText("Nombre del Worker"), { target: { value: "Atención al cliente" } });
    fireEvent.change(screen.getByLabelText("Resumen del Worker"), { target: { value: "Responde dudas básicas." } });
    fireEvent.click(screen.getByLabelText("Herramienta followup.send"));
    expect(review.getByText("Nivel 3 · siempre confirma")).toBeTruthy();
    expect(review.getByText(/Actúa fuera: followup.send/)).toBeTruthy();
    expect(review.getByText(/solo está habilitado para/)).toBeTruthy(); // the tool handles personal data and the Worker is cleared for business only
    fireEvent.change(screen.getByLabelText("Nivel de datos"), { target: { value: "personal" } });
    expect(review.getByText("Cumple los requisitos")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    tab("Workers");
    expect(within(worker("Atención al cliente")).getByText("Borrador")).toBeTruthy();
  });

  it("stops every Worker of the company at once, and keeps another company unaffected", () => {
    render(<WorkersCenter />);
    fireEvent.click(within(worker("Analista de reportes")).getByRole("button", { name: "Activar en mi empresa" }));
    fireEvent.click(screen.getByRole("button", { name: "Detener todos los Workers de mi empresa" }));
    expect(screen.getByRole("status").textContent).toContain("Los Workers de su empresa están detenidos");
    tab("Ejecuciones");
    fireEvent.change(screen.getByLabelText("Worker a ejecutar"), { target: { value: screen.getByRole("option", { name: "Analista de reportes" }).getAttribute("value") } });
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar ejecución" }));
    expect(alertText()).toContain("en pausa");
    expect(screen.queryByRole("button", { name: "Detener toda la plataforma" })).toBeNull(); // only administrators have the platform-wide stop
    actAs("admin-ana");
    expect(screen.getByRole("button", { name: "Detener toda la plataforma" })).toBeTruthy();
  });

  it("shows each company only its own Workers and runs", () => {
    render(<WorkersCenter />);
    loadSample();
    actAs("vida-lucia");
    expect(screen.getAllByText(/Activo en su empresa/)).toHaveLength(1); // only the reporter
    expect(screen.queryByLabelText("Worker Atención de reclamos")).toBeNull(); // Nova's own Worker
    tab("Ejecuciones");
    expect(screen.getByText("Sin ejecuciones")).toBeTruthy();
    expect(screen.getByText("Pendientes de una persona (0)")).toBeTruthy();
  });
});
