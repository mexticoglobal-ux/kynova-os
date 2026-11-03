type AreaChartProps = { data: readonly number[]; labels: readonly string[]; label: string };

export function AreaChart({ data, labels, label }: AreaChartProps) {
  const width = 600;
  const height = 200;
  const max = Math.max(...data) * 1.1;
  const step = width / (data.length - 1);
  const coords = data.map((value, index) => [index * step, height - (value / max) * height] as const);
  const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="h-48 w-full overflow-visible">
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1={0}
            x2={width}
            y1={height * fraction}
            y2={height * fraction}
            stroke="rgba(255,255,255,0.06)"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill="url(#area-fill)" />
        <path d={line} fill="none" stroke="#3B82F6" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="mt-2 flex justify-between text-[11px] text-zinc-400">
        {labels.map((month, index) => (
          <span key={month} className={index % 2 === 1 ? "hidden sm:inline" : undefined}>
            {month}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
