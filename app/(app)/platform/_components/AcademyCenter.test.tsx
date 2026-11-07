import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AcademyCenter } from "./AcademyCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const row = (text: RegExp | string) => screen.getByText(text).closest("li") as HTMLElement;
const courseCard = (title: string) => screen.getByRole("heading", { name: title }).closest("li") as HTMLElement;
const learning = (title: string) => screen.getByLabelText(`Curso ${title}`);
const KYNOVA = "KYNOVA 101: primeros pasos";

describe("AcademyCenter", () => {
  it("starts empty and says there is no real video or model", () => {
    render(<AcademyCenter />);
    expect(screen.getByText(/sin video real y sin modelo de IA/)).toBeTruthy();
    expect(screen.getByText("Sin cursos")).toBeTruthy();
  });

  it("shows each company its own, the official and the purchased courses, and sells the rest", () => {
    render(<AcademyCenter />);
    loadSample();
    expect(screen.getByRole("heading", { name: KYNOVA })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Atención al cliente con NEX" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Protocolos internos de la clínica" })).toBeNull(); // Vida's internal course
    expect(screen.queryByRole("heading", { name: "Taller en video privado" })).toBeNull(); // a draft

    actAs("vida-lucia");
    expect(within(courseCard("Atención al cliente con NEX")).getByText("Comprado")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Protocolos internos de la clínica" })).toBeTruthy();

    actAs("admin-ana"); // KYNOVA has not bought Nova's course
    expect(within(courseCard("Atención al cliente con NEX")).getByText("A la venta")).toBeTruthy();
    fireEvent.click(within(courseCard("Atención al cliente con NEX")).getByRole("button", { name: "Simular compra en el Marketplace" }));
    expect(within(courseCard("Atención al cliente con NEX")).getByText("Comprado")).toBeTruthy();
    expect(within(courseCard("Atención al cliente con NEX")).getByRole("button", { name: "Inscribirme" })).toBeTruthy();
  });

  it("filters the catalog by text, ignoring accents, and by language", () => {
    render(<AcademyCenter />);
    loadSample();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "ATENCION" } });
    expect(screen.getByRole("heading", { name: "Atención al cliente con NEX" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: KYNOVA })).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Idioma"), { target: { value: "en" } });
    expect(screen.getByText("Sin cursos")).toBeTruthy();
  });

  it("answers a question only from the course material, and sends the rest to the instructor", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("nova-pablo");
    tab("Mi aprendizaje");
    const course = within(learning(KYNOVA));
    fireEvent.change(course.getByLabelText("Pregunta para el tutor"), { target: { value: "¿Quién puede aprobar un pago solicitado?" } });
    fireEvent.click(course.getByRole("button", { name: "Preguntar a NEX" }));
    fireEvent.click(course.getByRole("button", { name: "Dejar que NEX responda (simulado)" }));
    expect(course.getByText(/^Según la lección «Guía de aprobaciones»: Quien solicita un pago no puede aprobarlo/)).toBeTruthy();
    expect(course.getByText("Fuente: Guía de aprobaciones")).toBeTruthy();

    fireEvent.change(course.getByLabelText("Pregunta para el tutor"), { target: { value: "¿Cuál es la capital de Francia?" } });
    fireEvent.click(course.getByRole("button", { name: "Preguntar a NEX" }));
    fireEvent.click(course.getByRole("button", { name: "Dejar que NEX responda (simulado)" }));
    expect(course.getByText("Enviada al instructor")).toBeTruthy();
  });

  it("does not help during an exam, and helps again once it is submitted", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("nova-pablo");
    tab("Mi aprendizaje");
    const course = within(learning(KYNOVA));
    fireEvent.click(course.getByRole("button", { name: "Empezar examen" }));
    fireEvent.change(course.getByLabelText("Pregunta para el tutor"), { target: { value: "¿Quién aprueba?" } });
    fireEvent.click(course.getByRole("button", { name: "Preguntar a NEX" }));
    expect(alertText()).toContain("mientras hay un examen en curso");
    expect((course.getByLabelText("Pregunta para el tutor") as HTMLInputElement).value).toBe("¿Quién aprueba?"); // a refused question is not lost
    fireEvent.click(course.getByRole("button", { name: "Enviar examen" }));
    fireEvent.click(course.getByRole("button", { name: "Preguntar a NEX" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("grades an exam by code and then lets the learner claim a certificate", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("vida-lucia");
    tab("Mi aprendizaje");
    const course = within(learning(KYNOVA));
    expect(course.getByText(/Para el certificado faltan: aprobar «Examen de KYNOVA 101»/)).toBeTruthy();
    fireEvent.click(course.getByRole("button", { name: "Empezar examen" }));
    fireEvent.click(course.getByLabelText("Una persona"));
    fireEvent.click(course.getByLabelText("Falso"));
    for (const option of ["Enviar un mensaje a un cliente", "Mover dinero", "Publicar en el Marketplace"]) fireEvent.click(course.getByLabelText(option));
    fireEvent.click(course.getByRole("button", { name: "Enviar examen" }));
    expect(course.getByText(/Último intento: Calificado · 100 % · aprobado/)).toBeTruthy();
    fireEvent.click(course.getByRole("button", { name: "Reclamar certificado" }));
    expect(course.getByText(/Certificado vigente:/)).toBeTruthy();
  });

  it("locks the next lesson of a sequential course until the previous one is done", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("vida-lucia");
    tab("Mi aprendizaje");
    const course = within(learning("Atención al cliente con NEX"));
    // Lucía finished the first lesson: the second is open, the third stays locked
    expect(course.getAllByRole("button", { name: "Bloqueada" })).toHaveLength(1);
    expect(course.getAllByRole("button", { name: "Marcar completada" })).toHaveLength(1);
  });

  it("keeps NEX from publishing its own draft, and a course with an unconnected source from being published", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("nex");
    tab("Enseñar");
    fireEvent.click(within(row(/Seguimiento de ventas \(borrador de NEX\)/)).getByRole("button", { name: "Publicar" }));
    expect(alertText()).toContain("NEX no puede");

    actAs("nova-ana");
    fireEvent.click(within(row(/Taller en video privado/)).getByRole("button", { name: "Publicar" }));
    expect(alertText()).toContain("todavía no está conectado");
    fireEvent.click(within(row(/Seguimiento de ventas \(borrador de NEX\)/)).getByRole("button", { name: "Publicar" }));
    expect(within(row(/Seguimiento de ventas \(borrador de NEX\)/)).getByText("Publicado")).toBeTruthy();
  });

  it("needs a second administrator to approve an official course", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("nova-ana");
    tab("Oficiales");
    expect(screen.getByText("Solo administración")).toBeTruthy();

    actAs("admin-bruno"); // Bruno submitted KYNOVA 201
    expect(screen.getByText("Cola de revisión (1)")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Aprobar curso" }));
    expect(alertText()).toContain("no puede aprobarlo");

    actAs("admin-ana");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar curso" }));
    expect(screen.getByText("Cola de revisión (0)")).toBeTruthy();
  });

  it("builds a course, and refuses to publish a file type that could be harmful", () => {
    render(<AcademyCenter />);
    tab("Enseñar");
    fireEvent.change(screen.getByLabelText("Título del curso"), { target: { value: "Mi curso" } });
    fireEvent.change(screen.getByLabelText("Resumen del curso"), { target: { value: "Un resumen" } });
    fireEvent.change(screen.getByLabelText("Título de la lección"), { target: { value: "Clase 1" } });
    fireEvent.change(screen.getByLabelText("Tipo de lección"), { target: { value: "video" } });
    fireEvent.change(screen.getByLabelText("Nombre del archivo"), { target: { value: "clase.exe" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar lección" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(screen.getByText(/Mi curso · De la empresa/)).toBeTruthy();
    fireEvent.click(within(row(/Mi curso · De la empresa/)).getByRole("button", { name: "Publicar" }));
    expect(alertText()).toContain("tipo de archivo");
  });

  it("shows a learner's certificate and verifies it by code, revealing nothing else", () => {
    render(<AcademyCenter />);
    loadSample();
    actAs("nova-pablo");
    tab("Certificados");
    const code = (screen.getByText(/KYN-[A-Z0-9]{4}-/).textContent ?? "").match(/KYN-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? "";
    expect(code).not.toBe("");
    actAs("vida-lucia"); // anyone can verify
    fireEvent.change(screen.getByLabelText("Código del certificado"), { target: { value: code } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(screen.getByRole("status").textContent).toContain("Certificado válido: Pablo Mora");
    fireEvent.change(screen.getByLabelText("Código del certificado"), { target: { value: "KYN-0000-0000-0000" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar" }));
    expect(screen.getByRole("status").textContent).toContain("No existe");
  });
});
