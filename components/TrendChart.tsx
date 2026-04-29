'use client';

export interface TrendPoint {
  x: number;
  xLabel: string;
  y: number | null;
}

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
  points: TrendPoint[];
  thick?: boolean;
}

export default function TrendChart({ series }: { series: TrendSeries[] }) {
  const W = 980, H = 380;
  const PAD_L = 56, PAD_R = 24, PAD_T = 24, PAD_B = 60;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const allPoints = series.flatMap((s) => s.points);
  const xs = allPoints.map((p) => p.x);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const xRange = Math.max(1, xMax - xMin);
  const yMin = 0, yMax = 4;

  const xScale = (x: number) => PAD_L + ((x - xMin) / xRange) * innerW;
  const yScale = (y: number) => PAD_T + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  // Use the first series' x positions as the canonical x axis tick set
  const ticks = series[0]?.points ?? [];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxWidth: '100%' }}>
      {/* Y grid lines */}
      {[0, 1, 2, 3, 4].map((y) => (
        <g key={y}>
          <line
            x1={PAD_L} y1={yScale(y)} x2={W - PAD_R} y2={yScale(y)}
            stroke={y === 3 ? 'rgba(201,169,97,0.25)' : 'rgba(255,255,255,0.07)'}
            strokeDasharray={y === 3 ? '3,3' : 'none'}
          />
          <text x={PAD_L - 8} y={yScale(y) + 4} textAnchor="end" fontSize={10} fontFamily="JetBrains Mono" fill="rgba(255,255,255,0.5)">
            {y}
          </text>
        </g>
      ))}

      {/* X tick labels */}
      {ticks.map((p, i) => {
        const x = xScale(p.x);
        return (
          <g key={i}>
            <line x1={x} y1={PAD_T + innerH} x2={x} y2={PAD_T + innerH + 4} stroke="rgba(255,255,255,0.2)" />
            <text
              x={x} y={PAD_T + innerH + 18}
              textAnchor="end"
              fontSize={10} fontFamily="Inter" fill="rgba(255,255,255,0.55)"
              transform={`rotate(-30, ${x}, ${PAD_T + innerH + 18})`}
            >
              {p.xLabel}
            </text>
          </g>
        );
      })}

      {/* Series */}
      {series.map((s) => {
        const validPts = s.points.filter((p) => p.y != null) as { x: number; y: number }[];
        if (validPts.length === 0) return null;
        const path = validPts
          .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.x).toFixed(1)} ${yScale(p.y).toFixed(1)}`)
          .join(' ');
        return (
          <g key={s.key}>
            <path d={path} fill="none" stroke={s.color} strokeWidth={s.thick ? 3 : 1.6} strokeLinejoin="round" strokeLinecap="round" opacity={s.thick ? 1 : 0.85} />
            {validPts.map((p, i) => (
              <circle key={i} cx={xScale(p.x)} cy={yScale(p.y)} r={s.thick ? 4 : 3} fill={s.color} stroke="var(--bg-mid)" strokeWidth={1.5} />
            ))}
          </g>
        );
      })}

      {/* Legend */}
      <g transform={`translate(${PAD_L}, ${H - 22})`}>
        {series.map((s, i) => (
          <g key={s.key} transform={`translate(${i * 110}, 0)`}>
            <line x1={0} y1={6} x2={20} y2={6} stroke={s.color} strokeWidth={s.thick ? 3 : 1.6} />
            <text x={26} y={9} fontSize={10} fontFamily="Oswald" fill="rgba(255,255,255,0.7)" letterSpacing="0.06em">
              {s.key}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
