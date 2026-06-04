import type { NavPointHF } from "@/lib/types";

interface SparklineProps {
  data: NavPointHF[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

export function Sparkline({
  data,
  width = 80,
  height = 28,
  color = "oklch(0.53 0.135 45)",
  className = "",
}: SparklineProps) {
  if (!data || data.length < 2) {
    return (
      <svg width={width} height={height} className={className}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="oklch(0.72 0.012 60)" strokeWidth={1} strokeDasharray="2 2" />
      </svg>
    );
  }

  const values = data.map((d) => d.nav);
  const min    = Math.min(...values);
  const max    = Math.max(...values);
  const range  = max - min || 1;
  const pad    = 2;

  const points = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / range) * (height - pad * 2);
    return `${x},${y}`;
  });

  const areaPoints = [
    `${pad},${height}`,
    ...points,
    `${width - pad},${height}`,
  ].join(" ");

  return (
    <svg width={width} height={height} className={className} aria-hidden>
      <polygon points={areaPoints} fill={color} opacity={0.07} />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
