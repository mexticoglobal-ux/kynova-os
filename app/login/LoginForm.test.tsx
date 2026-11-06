import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

import { LoginForm } from "./LoginForm";

const respond = (ok: boolean, body: unknown = {}) => ({ ok, status: ok ? 200 : 401, json: async () => body }) as Response;

beforeEach(() => router.replace.mockReset());
afterEach(() => vi.unstubAllGlobals());

describe("login", () => {
  it("explains demonstration mode when there is no database", () => {
    render(<LoginForm configured={false} next={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("modo demostración");
    expect(screen.getByRole("link", { name: /Abrir la demostración/ })).toHaveAttribute("href", "/dashboard");
  });

  it("asks for the email, then the code, then goes to the page the user wanted", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(true)).mockResolvedValueOnce(respond(true));
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginForm configured next="/sales" />);

    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }));
    expect(await screen.findByLabelText("Código")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/request");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ email: "ana@example.com" });

    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/sales"));
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/verify");
  });

  it("never follows a next value that points off-site", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(true)));
    render(<LoginForm configured next="https://evil.test" />);
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows a readable error for a wrong code and stays on the code step", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respond(true)).mockResolvedValueOnce(respond(false, { error: "invalid_code" })));
    render(<LoginForm configured next={null} />);
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el código" }));
    fireEvent.change(await screen.findByLabelText("Código"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no es correcto");
    expect(router.replace).not.toHaveBeenCalled();
  });
});
