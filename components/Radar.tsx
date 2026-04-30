'use client';

import { GROUP_COLORS, TIER_MAX, type GroupAverage } from '@/lib/scoring';

const RADAR = {
  pol: { stroke: '#C9A961', fill: 'rgba(201,169,97,0.18)' },
  pra: { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.18)' },
  gol: { stroke: '#22C55E', fill: 'rgba(34,197,94,0.18)' },
};

export default function Radar({ avgs }: { avgs: GroupAverage[] }) {
  // Slightly larger viewbox when there are many axes (categories = 22) so labels don't crowd.
  const N = avgs.length;
  const dense = N >= 12;
  const cx = 220, cy = 220, viewSize = 440;
  const maxR = dense ? 150 : 130;
  const pt = (i: number, value: number, max = TIER_MAX): [number, number] => {
    const angle = ((i * (360 / N)) - 90) * Math.PI / 180;
    const r = (value / max) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const polyPts = (key: 'pol' | 'pra' | 'gol') =>
    avgs.map((a, i) => pt(i, a[key])).map((p) => p.join(',')).join(' ');
  const ringPts = (level: number) =>
    avgs.map((_, i) => pt(i, level)).map((p) => p.join(',')).join(' ');

  // For dense radars (categories), shrink labels and skip per-axis value labels (would overlap).
  const labelFontSize = dense ? 10 : 13;
  const valueFontSize = dense ? 8 : 10;
  const showAxisValues = !dense;

  return (
    <svg className="radar-svg" viewBox={`0 0 ${viewSize} ${viewSize}`} xmlns="http://www.w3.org/2000/svg">
      {[1, 2, 3, 4, 5].map((level) => {
        const isTarget = level === 3;
        return (
          <polygon
            key={level}
            points={ringPts(level)}
            fill="none"
            stroke={isTarget ? 'rgba(201,169,97,0.25)' : 'rgba(255,255,255,0.07)'}
            strokeWidth={1}
            strokeDasharray={isTarget ? '3,3' : 'none'}
          />
        );
      })}
      {avgs.map((_, i) => {
        const [x, y] = pt(i, TIER_MAX);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />;
      })}
      {[1, 2, 3, 4, 5].map((level) => {
        const [x, y] = pt(0, level);
        return (
          <text key={level} x={x + 4} y={y + 3} fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="JetBrains Mono">
            {level}
          </text>
        );
      })}
      {avgs.map((a, i) => {
        const [x, y] = pt(i, TIER_MAX + (dense ? 0.45 : 0.7));
        const accent = (a.parent_id && GROUP_COLORS[a.parent_id]?.accent)
          ?? GROUP_COLORS[a.group_id]?.accent
          ?? '#C9A961';
        return (
          <text key={a.group_id} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill={accent} fontSize={labelFontSize} fontWeight={600} fontFamily="Oswald" letterSpacing="0.06em">
            {a.group_id}
          </text>
        );
      })}
      <polygon points={polyPts('gol')} fill={RADAR.gol.fill} stroke={RADAR.gol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pol')} fill={RADAR.pol.fill} stroke={RADAR.pol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pra')} fill={RADAR.pra.fill} stroke={RADAR.pra.stroke} strokeWidth={2} strokeLinejoin="round" />
      {avgs.map((a, i) => {
        const [x, y] = pt(i, a.pra);
        return <circle key={a.group_id} cx={x} cy={y} r={dense ? 2.5 : 3.5} fill={RADAR.pra.stroke} />;
      })}
      {showAxisValues && avgs.map((a, i) => {
        const [x, y] = pt(i, TIER_MAX + 0.1);
        const showPol = a.pol > 0;
        const showPra = a.pra > 0;
        if (!showPol && !showPra) return null;
        const haloStyle = { paintOrder: 'stroke', stroke: 'var(--bg-mid)', strokeWidth: 3, strokeLinejoin: 'round' } as React.CSSProperties;
        return (
          <g key={`val-${a.group_id}`}>
            {showPol && (
              <text x={x} y={y - (showPra ? 8 : 0)} textAnchor="middle" dominantBaseline="middle"
                fill={RADAR.pol.stroke} fontSize={valueFontSize} fontWeight={600} fontFamily="JetBrains Mono"
                style={haloStyle}>
                {a.pol.toFixed(2)}
              </text>
            )}
            {showPra && (
              <text x={x} y={y + (showPol ? 8 : 0)} textAnchor="middle" dominantBaseline="middle"
                fill={RADAR.pra.stroke} fontSize={valueFontSize} fontWeight={600} fontFamily="JetBrains Mono"
                style={haloStyle}>
                {a.pra.toFixed(2)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
