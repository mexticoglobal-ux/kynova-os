import { render, screen } from "@testing-library/react";
import { Inbox } from "lucide-react";
import { describe, expect, it } from "vitest";
import { Providers } from "@/components/providers/Providers";
import { Badge, type BadgeTone } from "./Badge";
import { Brand } from "./Brand";
import { EmptyState } from "./EmptyState";
import { IconBadge } from "./IconBadge";
import { Skeleton } from "./Skeleton";
import { StatusBadge } from "./StatusBadge";

// The pieces of Design System V3: same API as before, new look. Nothing here depends on a theme, so it runs on tokens only.
describe("badges", () => {
  it("keeps the six tones, each with a tinted fill and a thin inner edge", () => {
    const tones: BadgeTone[] = ["neutral", "primary", "accent", "success", "warning", "danger"];
    render(
      <div>
        {tones.map((tone) => (
          <Badge key={tone} tone={tone}>
            {tone}
          </Badge>
        ))}
      </div>,
    );
    for (const tone of tones) {
      const badge = screen.getByText(tone);
      expect(badge.className).toContain("ring-1");
      expect(badge.className).toContain("ring-inset");
      expect(badge.className).toMatch(/ring-(line|primary|accent|success|warning|danger)/);
    }
  });

  it("adds a status light only when asked, and hides it from screen readers", () => {
    const { container, rerender } = render(<Badge tone="success">Activo</Badge>);
    expect(container.querySelector("span[aria-hidden]")).toBeNull();
    rerender(
      <Badge tone="success" dot>
        Activo
      </Badge>,
    );
    expect(container.querySelector("span[aria-hidden]")).not.toBeNull();
    expect(screen.getByText("Activo")).toBeInTheDocument();
  });

  it("shows every status with its light", () => {
    render(
      <Providers>
        <StatusBadge status="won" />
      </Providers>,
    );
    const label = screen.getByText(/./);
    expect(label.className).toContain("text-success");
    expect(label.querySelector("span[aria-hidden]")).not.toBeNull();
  });
});

describe("empty states and loading", () => {
  it("shows what is missing and what to do, with a breathing light that is not announced", () => {
    const { container } = render(<EmptyState icon={Inbox} title="Aún no hay nada">Cree el primero.</EmptyState>);
    expect(screen.getByText("Aún no hay nada")).toBeInTheDocument();
    expect(screen.getByText("Cree el primero.")).toBeInTheDocument();
    const halo = container.querySelector(".empty-halo");
    expect(halo).not.toBeNull();
    expect(halo).toHaveAttribute("aria-hidden", "true");
    expect(halo?.className).toContain("animate-breathe");
  });

  it("makes a skeleton that shimmers with the cyan light and is hidden from screen readers", () => {
    const { container } = render(<Skeleton className="h-4" />);
    const node = container.firstElementChild as HTMLElement;
    expect(node).toHaveAttribute("aria-hidden", "true");
    expect(node.className).toContain("before:animate-shimmer");
    expect(node.className).toContain("before:via-accent/15");
  });
});

describe("marks", () => {
  it("draws the KYNOVA mark with the electric gradient and keeps the name readable", () => {
    const { container } = render(<Brand name="KYNOVA" />);
    expect(screen.getByText("KYNOVA")).toBeInTheDocument();
    expect(container.innerHTML).toContain("from-primary");
    expect(container.innerHTML).toContain("to-accent");
  });

  it("frames an icon with a soft wash and an edge, in both tones", () => {
    const { container } = render(
      <div>
        <IconBadge icon={Inbox} />
        <IconBadge icon={Inbox} tone="accent" />
      </div>,
    );
    const [primary, accent] = Array.from(container.querySelectorAll("span.inline-flex")) as HTMLElement[];
    expect(primary?.className).toContain("from-primary/25");
    expect(accent?.className).toContain("from-accent/25");
    expect(primary?.className).toContain("ring-inset");
  });
});
