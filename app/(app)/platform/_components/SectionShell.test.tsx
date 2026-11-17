import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SectionShell } from "./SectionShell";

afterEach(cleanup);

describe("SectionShell eyebrow", () => {
  it("keeps the sample-data label by default (previews and the demo)", () => {
    render(<SectionShell section="dashboard">x</SectionShell>);
    expect(screen.getByText("Vista previa · datos de ejemplo")).toBeTruthy();
  });

  it("shows the given label instead of the sample-data one (the signed-in dashboard)", () => {
    render(<SectionShell section="dashboard" eyebrow="Beta · datos de su empresa">x</SectionShell>);
    expect(screen.getByText("Beta · datos de su empresa")).toBeTruthy();
    expect(screen.queryByText(/datos de ejemplo/)).toBeNull();
  });
});
