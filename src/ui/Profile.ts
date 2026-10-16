import { BuiltLevel } from '../levels/LevelBuilder';
import { hillProfile } from '../physics/Terrain';

/** Side-elevation schematic of a level: track (x,y), landing hill and design arc. */
export function profilePaths(lv: BuiltLevel, W: number, H: number, pad = 4) {
  const pts: [number, number][] = [];
  const tr = lv.track;
  for (let i = 0; i < tr.pos.length; i += 4) pts.push([tr.pos[i].x, tr.pos[i].y]);
  const hill = lv.hill;
  const hp: [number, number][] = [];
  const u1 = hill.u0 + hill.h.length * hill.du;
  for (let u = hill.u0; u <= u1; u += 2) {
    const x = hill.origin.x + hill.dir.x * u;
    hp.push([x, hillProfile(hill, u)]);
  }
  const traj = lv.designTraj[1].filter((_, i) => i % 3 === 0).map((p) => [p.x, Math.max(0, p.y - 0.55)] as [number, number]);
  const all = [...pts, ...hp, ...traj];
  let minX = Infinity, maxX = -Infinity, maxY = 0;
  for (const [x, y] of all) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const sx = (W - pad * 2) / (maxX - minX || 1);
  const sy = (H - pad * 2) / (maxY || 1);
  const s = Math.min(sx, sy * 1.0);
  const ox = pad + ((W - pad * 2) - (maxX - minX) * s) / 2;
  const map = ([x, y]: [number, number]) => `${(ox + (x - minX) * s).toFixed(1)} ${(H - pad - y * s).toFixed(1)}`;
  const d = (arr: [number, number][]) => arr.length ? 'M ' + arr.map(map).join(' L ') : '';
  const ground = `M ${pad} ${H - pad} L ${W - pad} ${H - pad}`;
  const hillFill = hp.length ? d(hp) + ' Z' : '';
  const tx = hill.origin.x + hill.dir.x * hill.targetU;
  const [txs, tys] = map([tx, hillProfile(hill, hill.targetU)]).split(' ').map(Number);
  const lip = map([tr.pos[tr.pos.length - 1].x, tr.pos[tr.pos.length - 1].y]).split(' ').map(Number);
  return { track: d(pts), hill: d(hp), hillFill, traj: d(traj), ground, target: { x: txs, y: tys }, lip: { x: lip[0], y: lip[1] } };
}
