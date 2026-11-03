import clsx from "clsx";

type SparklineProps = { data: readonly number[]; className?: string; positive?: boolean };

export function Sparkline({ data, className, positive = true }: SparklineProps) {
  const width = 100;
  const height = 32;
  const min = Math.min(...data);
  const range = Math.max(...data) - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
      className={clsx("h-8 w-full", positive ? "text-success" : "text-danger", className)}
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
