import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { BRAND_KEYS, BRANDS } from "@/config/brand";
import { Dialog } from "./Dialog";
import { ProductMark } from "./ProductMark";
import { Skeleton, SkeletonPage } from "./Skeleton";
import { Stat } from "./Stat";
import { Table } from "./Table";
import { Tabs } from "./Tabs";

const ITEMS = [{ key: "uno", label: "Uno" }, { key: "dos", label: "Dos" }, { key: "tres", label: "Tres" }] as const;

function TabsHarness({ idPrefix }: { idPrefix?: string }) {
  const [value, setValue] = useState<"uno" | "dos" | "tres">("uno");
  return <Tabs label="Ejemplo" items={ITEMS} value={value} onChange={setValue} idPrefix={idPrefix} />;
}

describe("Tabs", () => {
  it("is one tablist whose selected tab is the only one in the tab order", () => {
    render(<TabsHarness />);
    const list = screen.getByRole("tablist", { name: "Ejemplo" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs.map((item) => item.textContent)).toEqual(["Uno", "Dos", "Tres"]);
    expect(tabs.map((item) => item.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((item) => item.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(tabs[2] as HTMLElement);
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveAttribute("aria-selected", "true");
  });

  it("moves with the arrows, Home and End, wraps around and moves the focus too", () => {
    render(<TabsHarness />);
    const key = (name: string, press: string) => fireEvent.keyDown(screen.getByRole("tab", { name }), { key: press });
    key("Uno", "ArrowRight");
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveFocus();
    key("Dos", "End");
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveFocus();
    key("Tres", "ArrowRight");
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveFocus(); // wraps
    key("Uno", "ArrowLeft");
    expect(screen.getByRole("tab", { name: "Tres" })).toHaveFocus();
    key("Tres", "Home");
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveFocus();
    key("Uno", "a"); // another key does nothing
    expect(screen.getByRole("tab", { name: "Uno" })).toHaveAttribute("aria-selected", "true");
  });

  it("names its tabs and panels when it is given an id prefix", () => {
    render(<TabsHarness idPrefix="demo" />);
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveAttribute("id", "demo-tab-dos");
    expect(screen.getByRole("tab", { name: "Dos" })).toHaveAttribute("aria-controls", "demo-panel-dos");
  });
});

function DialogHarness({ onClose = () => undefined }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Abrir</button>
      <Dialog open={open} onClose={() => { setOpen(false); onClose(); }} label="Ejemplo de diálogo">
        <button type="button" data-autofocus>Primero</button>
        <button type="button">Último</button>
      </Dialog>
    </div>
  );
}

describe("Dialog", () => {
  it("is a named modal that takes the focus, traps it and holds the page still", () => {
    render(<DialogHarness />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Ejemplo de diálogo" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Primero" })).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    const last = screen.getByRole("button", { name: "Último" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(screen.getByRole("button", { name: "Primero" })).toHaveFocus(); // forward from the last goes to the first
    fireEvent.keyDown(screen.getByRole("button", { name: "Primero" }), { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus(); // backward from the first goes to the last
  });

  it("closes with Escape or a click on the scrim, and gives the focus back to what opened it", () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByRole("button", { name: "Primero" }), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Table, Stat, Skeleton and ProductMark", () => {
  it("keeps a table named and scrolling inside its own box", () => {
    const { container } = render(<Table label="Facturas" minWidth={600}><tbody><tr><td>x</td></tr></tbody></Table>);
    expect(screen.getByRole("table", { name: "Facturas" })).toHaveStyle({ minWidth: "600px" });
    expect(container.firstElementChild).toHaveClass("table-wrap");
  });

  it("shows a figure with its label, value, hint and tone", () => {
    render(<Stat label="Clientes" value="12" hint="este mes" tone="good" />);
    const stat = within(screen.getByLabelText("Clientes"));
    expect(stat.getByText("12")).toHaveClass("stat-value", "text-success");
    expect(stat.getByText("este mes")).toHaveClass("stat-hint");
    expect(stat.getByText("Clientes")).toHaveClass("stat-label");
  });

  it("hides placeholders from screen readers and announces that a screen is loading", () => {
    const { container } = render(<Skeleton className="h-4" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    render(<SkeletonPage />);
    expect(screen.getByRole("status", { name: "Cargando" })).toHaveAttribute("aria-busy", "true");
  });

  it("draws every product the same way: a tinted icon and its name", () => {
    for (const brand of BRAND_KEYS) {
      const { container, unmount } = render(<ProductMark brand={brand} showTagline />);
      expect(screen.getByText(BRANDS[brand].name)).toBeInTheDocument();
      expect(screen.getByText(BRANDS[brand].tagline)).toBeInTheDocument();
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });
});
