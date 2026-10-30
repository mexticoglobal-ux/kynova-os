type BarListProps = { items: ReadonlyArray<{ label: string; value: number; display: string }> };

export function BarList({ items }: BarListProps) {
  const max = Math.max(...items.map((item) => item.value)) || 1;

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label} className="text-sm">
          <div className="flex justify-between gap-4">
            <span className="truncate text-zinc-300">{item.label}</span>
            <span className="tabular-nums text-zinc-400">{item.display}</span>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-primary to-accent"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
