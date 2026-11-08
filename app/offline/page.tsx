import type { Metadata } from "next";
import { ProductMark } from "@/components/ui/ProductMark";

// What the installed app shows when there is no connection. It is public and static, so the service worker can keep it.
export const metadata: Metadata = { title: "Sin conexión", robots: { index: false, follow: false } };

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <ProductMark brand="kynova" size="lg" showTagline />
      <h1 className="text-2xl font-semibold tracking-tight">Sin conexión</h1>
      <p className="text-ink-muted">No se pudo llegar a KYNOVA. Revise su conexión: en cuanto vuelva, podrá seguir donde lo dejó. Nada de lo que ya guardó se perdió.</p>
      <a href="/dashboard" className="btn btn-primary btn-md">
        Reintentar
      </a>
    </main>
  );
}
