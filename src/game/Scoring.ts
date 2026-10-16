import { CarSim } from '../physics/CarSim';
import { BuiltLevel } from '../levels/LevelBuilder';

export interface ScoreLine { label: string; detail: string; points: number; quality?: number }

export interface RunResult {
  crashed: boolean;
  reason: string;
  total: number;
  grade: string;
  verdict: string;
  quality: number;
  lines: ScoreLine[];
  exitKmh: number;
  time: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function scoreRun(sim: CarSim, level: BuiltLevel, runTime: number): RunResult {
  const exitKmh = sim.exitSpeed * 3.6;
  const td = sim.touchdown;
  const speedRatio = sim.exitSpeed / level.maxExitSpeed;
  const speedPts = Math.round(exitKmh * 10);
  const airPts = Math.round(sim.airTime * 60 + (sim.rotation * 180) / Math.PI * 0.6);
  const lines: ScoreLine[] = [];
  lines.push({ label: 'Launch speed', detail: `${exitKmh.toFixed(0)} km/h · ${(speedRatio * 100).toFixed(0)}% of max`, points: speedPts, quality: clamp01((speedRatio - 0.7) / 0.3) });
  lines.push({ label: 'Air time', detail: `${sim.airTime.toFixed(2)} s · ${((sim.rotation * 180) / Math.PI).toFixed(0)}° rotation`, points: airPts });

  if (sim.phase === 'crashed' || !td) {
    return {
      crashed: true, reason: sim.crashReason || 'CRASHED', total: 0, grade: '-', verdict: 'WRECKED', quality: 0,
      lines: [...lines, { label: 'Landing', detail: sim.crashReason || 'crashed', points: 0, quality: 0 }], exitKmh, time: runTime,
    };
  }
  const hill = level.hill;
  const u = (td.point.x - hill.origin.x) * hill.dir.x + (td.point.z - hill.origin.z) * hill.dir.y;
  const v = -(td.point.x - hill.origin.x) * hill.dir.y + (td.point.z - hill.origin.z) * hill.dir.x;
  const onHill = td.point.y > 0.3 && Math.abs(v) < hill.halfWidth + 1;
  const zoneDist = Math.abs(u - hill.targetU);
  const tilt = clamp01(1 - td.tiltDeg / 30);
  const impact = clamp01(1 - (td.impact - 2.5) / 14);
  const slip = clamp01(1 - td.slipDeg / 35);
  const spin = clamp01(1 - td.spinDeg / 140);
  const zone = onHill ? clamp01(1 - Math.max(0, zoneDist - hill.zoneHalf * 0.5) / (hill.zoneHalf * 2)) : 0;
  const Q = 0.3 * tilt + 0.26 * impact + 0.14 * slip + 0.1 * spin + 0.2 * zone;
  const landPts = Math.round(Q * 4000);
  lines.push({ label: 'Attitude', detail: `${td.tiltDeg.toFixed(1)}° off the surface`, points: Math.round(tilt * 1200), quality: tilt });
  lines.push({ label: 'Impact', detail: `${td.impact.toFixed(1)} m/s into the surface`, points: Math.round(impact * 1040), quality: impact });
  lines.push({ label: 'Heading', detail: `${td.slipDeg.toFixed(1)}° slip${td.reverse ? ' · REVERSE' : ''}`, points: Math.round(slip * 560), quality: slip });
  lines.push({ label: 'Spin', detail: `${td.spinDeg.toFixed(0)}°/s at contact`, points: Math.round(spin * 400), quality: spin });
  lines.push({ label: 'Target zone', detail: onHill ? `${zoneDist.toFixed(1)} m from the line` : 'missed the landing hill', points: Math.round(zone * 800), quality: zone });
  const airLeft = sim.airFrac;
  const airBonus = Math.round(airLeft * 600);
  lines.push({ label: 'Air reserve', detail: `${(airLeft * 100).toFixed(0)}% tank left`, points: airBonus, quality: airLeft });
  const reverseBonus = td.reverse && Q > 0.6 ? 500 : 0;
  if (reverseBonus) lines.push({ label: 'Switch landing', detail: 'landed in reverse', points: reverseBonus });
  const total = speedPts + airPts + landPts + airBonus + reverseBonus;
  const verdict = Q >= 0.9 ? 'PERFECT' : Q >= 0.78 ? 'CLEAN' : Q >= 0.6 ? 'SOLID' : Q >= 0.4 ? 'ROUGH' : 'SKETCHY';
  const comb = Q * 0.7 + clamp01((speedRatio - 0.7) / 0.3) * 0.3;
  const grade = comb >= 0.92 ? 'S' : comb >= 0.82 ? 'A' : comb >= 0.68 ? 'B' : comb >= 0.5 ? 'C' : 'D';
  return { crashed: false, reason: '', total, grade, verdict, quality: Q, lines, exitKmh, time: runTime };
}

const KEY = 'redshift.best.v1';
export function loadBest(): Record<number, { total: number; grade: string }> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export function saveBest(id: number, r: RunResult) {
  try {
    const b = loadBest();
    if (!b[id] || r.total > b[id].total) { b[id] = { total: r.total, grade: r.grade }; localStorage.setItem(KEY, JSON.stringify(b)); return true; }
  } catch { /* storage unavailable */ }
  return false;
}
