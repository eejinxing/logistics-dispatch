const NODES = {
  AOR: [6.1248, 100.3678], PEN: [5.4141, 100.3288], IPH: [4.5975, 101.0901],
  KUL: [3.139, 101.6869], SRB: [2.7259, 101.9424], MKZ: [2.1896, 102.2501],
  JHB: [1.4927, 103.7414], KUA: [3.8077, 103.326], TGG: [5.3296, 103.137],
  KBR: [6.1254, 102.2381], KCH: [1.5535, 110.3593], BKI: [5.9804, 116.0735]
};

export const CORRIDORS = [
  { from: 'AOR', to: 'PEN', via: [[5.85, 100.47], [5.55, 100.47]] },
  { from: 'PEN', to: 'IPH', via: [[5.38, 100.48], [5.12, 100.57], [4.83, 100.75]] },
  { from: 'IPH', to: 'KUL', via: [[4.39, 101.17], [4.06, 101.27], [3.69, 101.50], [3.37, 101.57]] },
  { from: 'KUL', to: 'SRB', via: [[2.98, 101.75], [2.82, 101.84]] },
  { from: 'SRB', to: 'MKZ', via: [[2.54, 102.05], [2.37, 102.20]] },
  { from: 'MKZ', to: 'JHB', via: [[2.30, 102.44], [2.12, 102.76], [1.92, 103.06], [1.68, 103.47]] },
  { from: 'KUL', to: 'KUA', via: [[3.33, 101.76], [3.39, 101.91], [3.32, 102.15], [3.48, 102.43], [3.62, 102.83]] },
  { from: 'KUA', to: 'TGG', via: [[4.05, 103.32], [4.40, 103.39], [4.72, 103.25], [5.02, 103.12]] },
  { from: 'TGG', to: 'KBR', via: [[5.56, 102.94], [5.77, 102.63], [5.98, 102.36]] },
  { from: 'AOR', to: 'KBR', via: [[5.80, 100.60], [5.55, 100.89], [5.55, 101.33], [5.69, 101.74], [5.88, 102.04]] },
  { from: 'KCH', to: 'BKI', via: [[1.52, 110.77], [1.93, 111.30], [2.32, 111.75], [2.80, 112.12], [3.17, 113.03], [3.62, 113.43], [4.15, 113.99], [4.49, 114.25], [4.79, 114.89], [5.06, 115.40], [5.51, 115.60]] }
].map((edge) => ({ ...edge, key: `${edge.from}-${edge.to}`, points: [NODES[edge.from], ...edge.via, NODES[edge.to]] }));

function distance(a, b) {
  return Math.hypot((b[1] - a[1]) * Math.cos((a[0] + b[0]) * Math.PI / 360), b[0] - a[0]);
}

export function airRoute(a, b) {
  const dx = b[1] - a[1], dy = b[0] - a[0];
  const c = [(a[0] + b[0]) / 2 - dx * .14, (a[1] + b[1]) / 2 + dy * .14];
  return Array.from({ length: 65 }, (_, i) => {
    const t = i / 64, u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]];
  });
}

export function freightRoute(origin, destination, air = origin.landmass !== destination.landmass) {
  const a = [origin.lat, origin.lng], b = [destination.lat, destination.lng];
  if (air) return { air: true, points: airRoute(a, b), edges: [] };
  if (origin.code === destination.code) return { air: false, points: [a, b], edges: [] };
  const queue = [{ code: origin.code, cost: 0, steps: [] }], visited = new Set();
  while (queue.length) {
    queue.sort((x, y) => x.cost - y.cost);
    const item = queue.shift();
    if (visited.has(item.code)) continue;
    visited.add(item.code);
    if (item.code === destination.code) {
      const points = [];
      for (const step of item.steps) points.push(...(step.reverse ? [...step.edge.points].reverse() : step.edge.points).slice(points.length ? 1 : 0));
      points[0] = a;
      points[points.length - 1] = b;
      return { air: false, points, edges: item.steps.map((step) => step.edge.key) };
    }
    for (const edge of CORRIDORS) {
      const reverse = edge.to === item.code;
      if (edge.from !== item.code && !reverse) continue;
      const code = reverse ? edge.from : edge.to;
      if (visited.has(code)) continue;
      const length = edge.points.slice(1).reduce((sum, p, i) => sum + distance(edge.points[i], p), 0);
      queue.push({ code, cost: item.cost + length, steps: [...item.steps, { edge, reverse }] });
    }
  }
  return { air: false, points: [a, b], edges: [] };
}

export function pointOnRoute(points, progress) {
  if (progress <= 0) return points[0];
  if (progress >= 1) return points[points.length - 1];
  const lengths = points.slice(1).map((p, i) => distance(points[i], p));
  let remaining = Math.max(0, Math.min(1, progress)) * lengths.reduce((sum, n) => sum + n, 0);
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? Math.min(1, remaining / lengths[i]) : 0;
      return [points[i][0] + (points[i + 1][0] - points[i][0]) * t, points[i][1] + (points[i + 1][1] - points[i][1]) * t];
    }
    remaining -= lengths[i];
  }
  return points[0];
}
