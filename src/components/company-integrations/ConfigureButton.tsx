"use client";
import { useState } from "react";
import { wfCall } from "@/components/workforce/api";

const field = "w-full rounded-lg border border-line bg-transparent px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-ac2";
const btn = "rounded-lg border border-line px-2.5 py-1 text-xs hover:bg-ac/10 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-ac2";
/** "Configurar". A connector without an adapter shows a disabled button that says so; nothing can be saved for it. */
export function ConfigureButton({ connector, fields, init, available, L }: { connector: string; fields: string[]; init: Record<string, string>; available: boolean; L: Record<string, string> }) {
  const [open, setOpen] = useState(false), [v, setV] = useState(init), [busy, setBusy] = useState(false), [msg, setMsg] = useState<string | null>(null);
  if (!available) return <button type="button" className={btn} disabled aria-disabled="true" title={L["configure.soon"]}>{L.configure}</button>;
  async function save() {
    setBusy(true); setMsg(null); const r = await wfCall("PUT", `/company-integrations/${connector}`, { config: v }); setBusy(false);
    setMsg(r.ok ? (L.saved ?? "") : (r.fields?.map((f) => `${f.field}: ${f.message}`).join(" · ") || r.message || L.error || ""));
  }
  if (!open) return <button type="button" className={btn} onClick={() => setOpen(true)}>{L.configure}</button>;
  return (
    <form className="grid gap-1" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {fields.map((f) => <input key={f} aria-label={f} placeholder={f} className={field} value={v[f] ?? ""} onChange={(e) => setV({ ...v, [f]: e.target.value })} />)}
      <button type="submit" className={btn} disabled={busy}>{busy ? L.saving : L.save}</button><p role="status" aria-live="polite" className="text-[11px] text-muted">{msg}</p>
    </form>
  );
}
