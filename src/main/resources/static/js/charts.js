import { DIRS, DIR_ANGLE, cssVar, dirColor, esc, fmtKg, fmtNum, hideTip, showTip } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(rad), cy - r * Math.cos(rad)];
}

export function renderRose(el, directions, { onPick, unit = 'shipments' } = {}) {
  const size = 320;
  const c = size / 2;
  const rMax = 108;
  const max = Math.max(1, ...directions.map((d) => d.count));
  const total = directions.reduce((s, d) => s + d.count, 0);
  const surface = cssVar('--surface');
  const grid = cssVar('--border');
  const textMuted = cssVar('--muted');
  const text = cssVar('--text');
  const text2 = cssVar('--text-2');

  let svg = `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Shipments by direction">`;
  for (const f of [0.25, 0.5, 0.75, 1]) {
    svg += `<circle cx="${c}" cy="${c}" r="${rMax * Math.sqrt(f)}" fill="none" stroke="${grid}" stroke-width="1"/>`;
  }
  for (const d of DIRS) {
    const [x, y] = polar(c, c, rMax, DIR_ANGLE[d]);
    svg += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="${grid}" stroke-width="1"/>`;
  }
  for (const d of directions) {
    if (!d.count) continue;
    const r = Math.max(6, rMax * Math.sqrt(d.count / max));
    const a = DIR_ANGLE[d.direction];
    const [x1, y1] = polar(c, c, r, a - 17);
    const [x2, y2] = polar(c, c, r, a + 17);
    svg += `<path class="petal" data-dir="${d.direction}" d="M${c},${c} L${x1},${y1} A${r},${r} 0 0 1 ${x2},${y2} Z" `
      + `fill="${dirColor(d.direction)}" stroke="${surface}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  for (const d of directions) {
    const [x, y] = polar(c, c, rMax + 26, DIR_ANGLE[d.direction]);
    svg += `<text x="${x}" y="${y - 3}" text-anchor="middle" font-size="13" font-weight="600" fill="${text}">${esc(d.label)}</text>`;
    svg += `<text x="${x}" y="${y + 12}" text-anchor="middle" font-size="11.5" fill="${text2}">${fmtNum(d.count)}</text>`;
  }
  svg += `<circle cx="${c}" cy="${c}" r="25" fill="${surface}" stroke="${grid}"/>`;
  svg += `<text x="${c}" y="${c + 2}" text-anchor="middle" font-size="15" font-weight="700" fill="${text}">${fmtNum(total)}</text>`;
  svg += `<text x="${c}" y="${c + 15}" text-anchor="middle" font-size="10.5" fill="${textMuted}">${unit}</text>`;
  svg += '</svg>';

  const sorted = [...directions].sort((a, b) => b.count - a.count);
  const list = sorted.map((d) => `<button type="button" data-dir="${d.direction}"><span class="sw" style="background:var(--dir-${d.direction})"></span>`
    + `To ${esc(d.label)}<span class="muted">${fmtKg(d.weightKg)}</span><span class="n">${fmtNum(d.count)}</span></button>`).join('');
  el.innerHTML = `<div class="compass-wrap"><div class="compass">${svg}</div><div class="compass-list">${list}</div></div>`;

  const byDir = Object.fromEntries(directions.map((d) => [d.direction, d]));
  el.querySelectorAll('.petal').forEach((p) => {
    p.addEventListener('mousemove', (e) => {
      const d = byDir[p.dataset.dir];
      const share = total ? ((d.count / total) * 100).toFixed(1) : '0';
      showTip(`<div class="t">To ${esc(d.label)}</div><div class="r"><span>Count</span><b>${fmtNum(d.count)} ${unit}</b></div>`
        + `<div class="r"><span>Weight</span><b>${fmtKg(d.weightKg)}</b></div><div class="r"><span>Share</span><b>${share}%</b></div>`, e.clientX, e.clientY);
    });
    p.addEventListener('mouseleave', hideTip);
  });
  if (onPick) {
    el.querySelectorAll('[data-dir]').forEach((n) => n.addEventListener('click', () => {
      hideTip();
      onPick(n.dataset.dir);
    }));
  }
}

export function renderBars(el, { categories, series, format = (v) => fmtNum(v), height = 240 }) {
  const width = 640;
  const pad = { top: 12, right: 8, bottom: 26, left: 48 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxVal = Math.max(1, ...series.flatMap((s) => s.values));
  const step = niceStep(maxVal / 4);
  const top = Math.ceil(maxVal / step) * step;
  const y = (v) => pad.top + innerH - (v / top) * innerH;
  const group = innerW / categories.length;
  const gap = 2;
  const barW = Math.max(3, Math.min(28, (group * 0.7 - gap * (series.length - 1)) / series.length));
  const muted = cssVar('--muted');

  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img">`;
  for (let v = 0; v <= top + 1e-9; v += step) {
    svg += `<line class="${v === 0 ? 'baseline' : 'grid-line'}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(v)}" y2="${y(v)}"/>`;
    svg += `<text x="${pad.left - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${muted}">${esc(format(v, true))}</text>`;
  }
  categories.forEach((cat, i) => {
    const gx = pad.left + group * i + (group - (barW * series.length + gap * (series.length - 1))) / 2;
    series.forEach((s, j) => {
      const v = s.values[i] ?? 0;
      const x = gx + j * (barW + gap);
      const h = Math.max(0, y(0) - y(v));
      if (h > 0) {
        const r = Math.min(4, h, barW / 2);
        const yt = y(v);
        svg += `<path class="mark" d="M${x},${y(0)} V${yt + r} Q${x},${yt} ${x + r},${yt} H${x + barW - r} Q${x + barW},${yt} ${x + barW},${yt + r} V${y(0)} Z" fill="${s.color}"/>`;
      }
    });
    svg += `<text x="${pad.left + group * i + group / 2}" y="${height - 8}" text-anchor="middle" font-size="11" fill="${muted}">${esc(cat)}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${pad.left + group * i}" y="${pad.top}" width="${group}" height="${innerH}" fill="transparent"/>`;
  });
  svg += '</svg>';
  const legend = series.length > 1
    ? `<div class="legend" style="margin-bottom:8px">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>`
    : '';
  el.innerHTML = `${legend}<div class="chart">${svg}</div>`;
  el.querySelectorAll('.hit').forEach((r) => {
    r.addEventListener('mousemove', (e) => {
      const i = Number(r.dataset.i);
      showTip(`<div class="t">${esc(categories[i])}</div>${series.map((s) => `<div class="r"><span><i style="background:${s.color}"></i> ${esc(s.label)}</span><b>${esc(format(s.values[i] ?? 0))}</b></div>`).join('')}`, e.clientX, e.clientY);
    });
    r.addEventListener('mouseleave', hideTip);
  });
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return Math.max(nice * pow, 1);
}
