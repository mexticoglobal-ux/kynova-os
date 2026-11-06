"use client";

import { useState } from "react";
import { Bot, Gem, TrendingUp } from "lucide-react";
import { THEMES, THEME_LABEL, DEFAULT_THEME, type Theme } from "@/lib/theme";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconBadge } from "@/components/ui/IconBadge";
import { choiceClass } from "@/components/ui/choice";
import { FIELD, LABEL } from "@/components/ui/form";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarList } from "@/components/charts/BarList";
import { Sparkline } from "@/components/charts/Sparkline";

const SURFACES = [
  ["canvas", "bg-canvas", "Fondo de página"],
  ["surface", "bg-surface", "Tarjetas"],
  ["raised", "bg-raised", "Controles y chips"],
  ["raised-strong", "bg-raised-strong", "Hover y pulsado"],
  ["shade", "bg-shade", "Campos y huecos"],
] as const;
const BRAND = [
  ["primary", "bg-primary", "Azul petróleo"],
  ["primary-soft", "bg-primary-soft", "Texto e iconos sobre oscuro"],
  ["accent", "bg-accent", "Dorado premium"],
  ["accent-soft", "bg-accent-soft", "Dorado para texto"],
] as const;
const STATUS = [
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
] as const;
const INK = [
  ["ink", "text-ink", "Texto principal"],
  ["ink-soft", "text-ink-soft", "Texto secundario"],
  ["ink-muted", "text-ink-muted", "Apoyo y etiquetas"],
] as const;
const TONES: BadgeTone[] = ["neutral", "primary", "accent", "success", "warning", "danger"];
const SPACING = [1, 2, 3, 4, 6, 8, 12];

function Swatch({ token, className, note }: { token: string; className: string; note?: string }) {
  return (
    <div className="min-w-0">
      <div className={`h-14 rounded-xl border border-line ${className}`} />
      <p className="mt-2 truncate text-sm font-medium">{token}</p>
      {note && <p className="truncate text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4" aria-labelledby={`ds-${title}`}>
      <h2 id={`ds-${title}`} className="text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

// Reference of the KYNOVA design system. The theme switcher only changes this tab's `data-theme`: nothing is stored.
export function DesignSystemView() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  function choose(next: Theme) {
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-12 px-4 py-10 sm:px-6">
      <header className="space-y-4">
        <Badge tone="accent">
          <Gem aria-hidden className="h-3.5 w-3.5" />
          Design System
        </Badge>
        <h1 className="text-4xl font-semibold tracking-tight">KYNOVA Premium UI</h1>
        <p className="max-w-2xl text-ink-muted">
          Azul petróleo, grafito y dorado. Cada pantalla se construye con estas piezas: los colores salen de variables por tema y nada se pinta a mano.
        </p>
        <div role="group" aria-label="Tema" className="inline-flex rounded-full border border-line bg-raised p-1 text-sm">
          {THEMES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={theme === option}
              onClick={() => choose(option)}
              className={`rounded-full px-4 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft ${theme === option ? "bg-primary text-on-primary" : "text-ink-soft hover:text-ink"}`}
            >
              {THEME_LABEL[option]}
            </button>
          ))}
        </div>
      </header>

      <Block title="Colores">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {SURFACES.map(([token, className, note]) => (
            <Swatch key={token} token={token} className={className} note={note} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {BRAND.map(([token, className, note]) => (
            <Swatch key={token} token={token} className={className} note={note} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-4">
          {STATUS.map(([token, className]) => (
            <Swatch key={token} token={token} className={className} />
          ))}
        </div>
        <Card className="space-y-1 p-5">
          {INK.map(([token, className, note]) => (
            <p key={token} className={className}>
              {token} · {note}
            </p>
          ))}
        </Card>
      </Block>

      <Block title="Botones">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary">Primario</Button>
          <Button variant="secondary">Secundario</Button>
          <Button variant="accent">Destacado</Button>
          <Button variant="ghost">Discreto</Button>
          <Button variant="primary" disabled>
            Desactivado
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm">Pequeño</Button>
          <Button size="md">Mediano</Button>
          <Button size="lg" variant="primary">
            Grande
          </Button>
        </div>
      </Block>

      <Block title="Tarjetas, badges e iconos">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-5">
            <IconBadge icon={Bot} />
            <h3 className="mt-4 font-medium">Tarjeta estándar</h3>
            <p className="mt-1 text-sm text-ink-muted">Superficie, borde y sombra del tema.</p>
          </Card>
          <Card className="p-5">
            <IconBadge icon={TrendingUp} tone="accent" />
            <h3 className="mt-4 font-medium">Icono dorado</h3>
            <p className="mt-1 text-sm text-ink-muted">Iconos de lucide-react: 16 px en línea, 20 px en navegación.</p>
          </Card>
          <Card className="space-y-3 p-5">
            <h3 className="font-medium">Badges</h3>
            <div className="flex flex-wrap gap-2">
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </div>
          </Card>
        </div>
      </Block>

      <Block title="Campos y opciones">
        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <label htmlFor="ds-field" className={LABEL}>
              Campo de texto
            </label>
            <input id="ds-field" className={FIELD} placeholder="Escribe aquí" />
          </div>
          <div className="grid gap-2">
            <button type="button" className={choiceClass(false)}>
              Opción sin seleccionar
            </button>
            <button type="button" className={choiceClass(true)} aria-pressed>
              Opción seleccionada
            </button>
          </div>
        </Card>
      </Block>

      <Block title="Gráficos">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <AreaChart data={[12, 18, 15, 24, 30, 28, 36, 42]} labels={["E", "F", "M", "A", "M", "J", "J", "A"]} label="Tendencia" />
          </Card>
          <Card className="space-y-4 p-5">
            <BarList
              items={[
                { label: "Web", value: 42, display: "42" },
                { label: "Redes", value: 28, display: "28" },
                { label: "Referidos", value: 15, display: "15" },
              ]}
            />
            <Sparkline data={[3, 5, 4, 8, 7, 11]} />
          </Card>
        </div>
      </Block>

      <Block title="Sombras y espaciados">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card p-6">shadow-card</div>
          <div className="rounded-card bg-raised p-6 shadow-raised">shadow-raised</div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          {SPACING.map((unit) => (
            <div key={unit} className="text-center text-xs text-ink-muted">
              <div className="rounded bg-accent/70" style={{ width: `${unit * 4}px`, height: `${unit * 4}px` }} />
              {unit * 4}px
            </div>
          ))}
        </div>
      </Block>
    </div>
  );
}
