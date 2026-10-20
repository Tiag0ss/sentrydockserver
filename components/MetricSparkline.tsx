'use client';

type Point = { ts: number; value: number | null };

export function MetricSparkline({
  points,
  color = 'var(--sd-accent)',
  height = 36,
  width = 140,
  fill = true,
}: {
  points: Point[];
  color?: string;
  height?: number;
  width?: number;
  fill?: boolean;
}) {
  const values = points.map((p) => p.value).filter((v): v is number => v != null && Number.isFinite(v));
  if (values.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--sd-border)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = max === min ? (max === 0 ? 1 : Math.abs(max) * 0.1) : 0;
  const lo = min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;

  const coords = points
    .map((p, i) => {
      if (p.value == null || !Number.isFinite(p.value)) return null;
      const x = (i / Math.max(1, points.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((p.value - lo) / span) * (height - 4);
      return { x, y };
    })
    .filter((c): c is { x: number; y: number } => Boolean(c));

  if (coords.length < 2) {
    return (
      <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--sd-border)" strokeWidth={1} />
      </svg>
    );
  }

  const line = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height - 1} L${coords[0].x.toFixed(1)},${height - 1} Z`;

  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      {fill ? <path d={area} fill={color} opacity={0.12} /> : null}
      <path d={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
