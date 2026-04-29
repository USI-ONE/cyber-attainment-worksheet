'use client';

import { GROUP_COLORS, type GroupAverage } from '@/lib/scoring';

const RADAR = {
  pol: { stroke: '#C9A961', fill: 'rgba(201,169,97,0.18)' },
  pra: { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.18)' },
  gol: { stroke: '#22C55E', fill: 'rgba(34,197,94,0.18)' },
};

export default function Radar({ avgs }: { avgs: GroupAverage[] }) {
  const cx = 180, cy = 180, maxR = 130;
  const N = avgs.length;
  const pt = (i: number, value: number, max = 4): [number, number] => {
    const angle = ((i * (360 / N)) - 90) * Math.PI / 180;
    const r = (value / max) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const polyPts = (key: 'pol' | 'pra' | 'gol') =>
    avgs.map((a, i) => pt(i, a[key])).map((p) => p.join(',')).join(' ');
  const ringPts = (level: number) =>
    avgs.map((_, i) => pt(i, level)).map((p) => p.join(',')).join(' ');

  return (
    <svg className="radar-svg" viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg">
      {[1, 2, 3, 4].map((level) => {
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
        const [x, y] = pt(i, 4);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />;
      })}
      {[1, 2, 3, 4].map((level) => {
        const [x, y] = pt(0, level);
        return (
          <text key={level} x={x + 4} y={y + 3} fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="JetBrains Mono">
            {level}
          </text>
        );
      })}
      {avgs.map((a, i) => {
        const [x, y] = pt(i, 4.5);
        const c = GROUP_COLORS[a.group_id] ?? { accent: '#C9A961' };
        return (
          <text key={a.group_id} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill={c.accent} fontSize={13} fontWeight={600} fontFamily="Oswald" letterSpacing="0.06em">
            {a.group_id}
          </text>
        );
      })}
      <polygon points={polyPts('gol')} fill={RADAR.gol.fill} stroke={RADAR.gol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pol')} fill={RADAR.pol.fill} stroke={RADAR.pol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pra')} fill={RADAR.pra.fill} stroke={RADAR.pra.stroke} strokeWidth={2} strokeLinejoin="round" />
      {avgs.map((a, i) => {
        const [x, y] = pt(i, a.pra);
        return <circle key={a.group_id} cx={x} cy={y} r={3.5} fill={RADAR.pra.stroke} />;
      })}
    </svg>
  );
}
