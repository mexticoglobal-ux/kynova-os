import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { es } from "@/lib/i18n/messages/es";
import { NexChat } from "./NexChat";

const { askNex } = vi.hoisted(() => ({ askNex: vi.fn() }));
vi.mock("@/lib/nex", () => ({ askNex }));

const scrollIntoView = vi.fn();

function renderChat() {
  return render(
    <Providers>
      <NexChat />
    </Providers>,
  );
}

function sendPrompt(prompt: string) {
  fireEvent.change(screen.getByLabelText(es.nex.placeholder), { target: { value: prompt } });
  fireEvent.click(screen.getByRole("button", { name: es.nex.send }));
}

beforeEach(() => {
  askNex.mockReset();
  scrollIntoView.mockReset();
  window.localStorage.clear();
  // jsdom implements neither scrollIntoView nor matchMedia.
  Element.prototype.scrollIntoView = scrollIntoView;
  window.matchMedia ??= vi.fn().mockReturnValue({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("NexChat", () => {
  it("D27: opening a conversation from the history scrolls to its latest message", async () => {
    const conversation = (id: string, title: string) => ({
      id,
      title,
      updatedAt: 1,
      messages: [
        { role: "user", text: `${title} pregunta` },
        { role: "nex", text: `${title} respuesta` },
      ],
    });
    window.localStorage.setItem("kynova.nex.conversations", JSON.stringify([conversation("a", "Conversación A"), conversation("b", "Conversación B")]));

    renderChat();
    const first = await screen.findByRole("button", { name: "Conversación A" });
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(first);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    // Same message count as A: before the fix, switching did not trigger a scroll.
    scrollIntoView.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Conversación B" }));
    await screen.findByText("Conversación B respuesta");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });

  it("D28: a failed reply shows an error, invents no answer and lets the user retry", async () => {
    askNex.mockRejectedValueOnce(new Error("network"));
    renderChat();

    sendPrompt("¿Qué leads necesitan seguimiento?");

    expect(await screen.findByRole("alert")).toHaveTextContent(es.nex.error);
    expect(screen.queryByText(es.nex.simulatedReply)).not.toBeInTheDocument();
    // The thinking indicator leaves through an exit animation.
    await waitFor(() => expect(screen.queryByText(es.nex.thinking)).not.toBeInTheDocument());
    expect(screen.getByLabelText(es.nex.placeholder)).toHaveValue("¿Qué leads necesitan seguimiento?");
    expect(screen.getByRole("button", { name: es.nex.send })).toBeEnabled();

    askNex.mockResolvedValueOnce("Respuesta de reintento");
    fireEvent.click(screen.getByRole("button", { name: es.nex.send }));

    expect(await screen.findByText("Respuesta de reintento")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
