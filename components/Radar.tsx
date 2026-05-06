'use client';

import { GROUP_COLORS, TIER_MAX, type GroupAverage } from '@/lib/scoring';

// Stroke colors are darkened from the dark-theme variants so the polygons
// stay visible on white. Fills stay semi-transparent and tinted.
const RADAR = {
  pol: { stroke: '#A6873B', fill: 'rgba(166,135,59,0.16)' },
  pra: { stroke: '#B45309', fill: 'rgba(180,83,9,0.18)'   },
  gol: { stroke: '#15803D', fill: 'rgba(21,128,61,0.16)'  },
};

export default function Radar({ avgs }: { avgs: GroupAverage[] }) {
  // Slightly larger viewbox when there are many axes (categories = 22) so labels don't crowd.
  const N = avgs.length;
  const dense = N >= 12;
  const cx = 220, cy = 220, viewSize = 440;
  const maxR = dense ? 140 : 130;
  const pt = (i: number, value: number, max = TIER_MAX): [number, number] => {
    const angle = ((i * (360 / N)) - 90) * Math.PI / 180;
    const r = (value / max) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const ptAt = (angleDeg: number, r: number): [number, number] => {
    const a = (angleDeg - 90) * Math.PI / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };

  // Group consecutive same-parent_id categories so we can draw an outer ring with function names.
  // Each segment captures the angular sweep its categories cover, so a function label sits at
  // the midpoint of its categories and a thin arc spans the function's slice of the chart.
  type Seg = { parent_id: string; startIdx: number; endIdx: number };
  const segments: Seg[] = [];
  if (dense) {
    for (let i = 0; i < avgs.length; i++) {
      const p = avgs[i].parent_id ?? avgs[i].group_id;
      const last = segments[segments.length - 1];
      if (last && last.parent_id === p) last.endIdx = i;
      else segments.push({ parent_id: p, startIdx: i, endIdx: i });
    }
  }
  const stepDeg = 360 / N;
  const polyPts = (key: 'pol' | 'pra' | 'gol') =>
    avgs.map((a, i) => pt(i, a[key])).map((p) => p.join(',')).join(' ');
  const ringPts = (level: number) =>
    avgs.map((_, i) => pt(i, level)).map((p) => p.join(',')).join(' ');

  // For dense radars (categories), shrink labels and skip per-axis value labels (would overlap).
  const labelFontSize = dense ? 10 : 13;
  const valueFontSize = dense ? 8 : 10;
  const showAxisValues = !dense;

  // Outer ring showing the 6 NIST CSF functions when we're plotting categories (dense mode).
  // Each function gets an accent-colored arc spanning its categories plus a function-code label
  // (GV/ID/PR/DE/RS/RC) anchored at the angular midpoint. Helps the board read the radar at
  // both levels — the polygon vertices are categories, the outer ring is the parent function.
  const outerArcR = dense ? 168 : 0;
  const outerLabelR = dense ? 188 : 0;
  const arcPath = (startDeg: number, endDeg: number, r: number) => {
    const [x1, y1] = ptAt(startDeg, r);
    const [x2, y2] = ptAt(endDeg, r);
    const largeArc = endDeg - startDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  };

  return (
    <svg className="radar-svg" viewBox={`0 0 ${viewSize} ${viewSize}`} xmlns="http://www.w3.org/2000/svg">
      {dense && segments.map((s) => {
        const accent = GROUP_COLORS[s.parent_id]?.accent ?? '#C9A961';
        // Arc covers from the leading edge of the first category slice to the trailing edge of the last.
        const startDeg = s.startIdx * stepDeg - stepDeg / 2;
        const endDeg = s.endIdx * stepDeg + stepDeg / 2;
        const midDeg = (startDeg + endDeg) / 2;
        const [lx, ly] = ptAt(midDeg, outerLabelR);
        return (
          <g key={`fn-${s.parent_id}-${s.startIdx}`}>
            <path d={arcPath(startDeg, endDeg, outerArcR)} fill="none" stroke={accent} strokeOpacity={0.55} strokeWidth={3} strokeLinecap="round" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
              fill={accent} fontSize={14} fontWeight={700} fontFamily="Oswald" letterSpacing="0.1em">
              {s.parent_id}
            </text>
          </g>
        );
      })}
      {[1, 2, 3, 4, 5].map((level) => {
        const isTarget = level === 3;
        return (
          <polygon
            key={level}
            points={ringPts(level)}
            fill="none"
            stroke={isTarget ? 'rgba(166,135,59,0.55)' : 'rgba(0,0,0,0.10)'}
            strokeWidth={1}
            strokeDasharray={isTarget ? '3,3' : 'none'}
          />
        );
      })}
      {avgs.map((_, i) => {
        const [x, y] = pt(i, TIER_MAX);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(0,0,0,0.10)" strokeWidth={1} />;
      })}
      {[1, 2, 3, 4, 5].map((level) => {
        const [x, y] = pt(0, level);
        return (
          <text key={level} x={x + 4} y={y + 3} fill="rgba(0,0,0,0.35)" fontSize={9} fontFamily="JetBrains Mono">
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
