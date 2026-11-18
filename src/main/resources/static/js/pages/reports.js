import { get } from '../api.js';
import { renderBars, renderRose } from '../charts.js';
import { $, cssVar, esc, fmtDay, fmtFull, fmtKg, fmtMoney, fmtNum, fmtPct } from '../ui.js';

let s = null;

function tile(label, value, hint = '') {
  return `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

async function load() {
  if (!s) return;
  const token = s;
  const r = await get(`/api/reports/daily?days=${s.days}`);
  if (s !== token) return;
  const t = r.totals;
  $('#totals').innerHTML = [
    tile('Shipments created', fmtNum(t.created), `Last ${s.days} days, excluding cancellations`),
    tile('Shipments delivered', fmtNum(t.delivered), `On-time rate ${fmtPct(t.onTimeRate)}`),
    tile('Revenue', fmtMoney(t.revenue), `Average per shipment ${t.created ? fmtMoney(t.revenue / t.created) : '—'}`),
    tile('Average weight', fmtKg(t.avgWeightKg), 'per shipment')
  ].join('');
  $('#generated').textContent = `As of ${fmtFull(r.generatedAt)} (simulation time)`;

  const days = r.days.map((d) => fmtDay(d.date));
  renderBars($('#volume'), {
    categories: days,
    series: [
      { label: 'Created', color: cssVar('--text-2'), values: r.days.map((d) => d.created) },
      { label: 'Delivered', color: cssVar('--accent'), values: r.days.map((d) => d.delivered) }
    ],
    format: (v) => fmtNum(v)
  });
  renderBars($('#revenue'), {
    categories: days,
    series: [{ label: 'Revenue', color: cssVar('--accent'), values: r.days.map((d) => Number(d.revenue)) }],
    format: (v, axis) => (axis ? (v >= 1000 ? `${fmtNum(v / 1000)}k` : fmtNum(v)) : fmtMoney(v))
  });
  renderRose($('#rose'), r.directions, { onPick: (dir) => s.ctx.go(`#/shipments?direction=${dir}`) });

  $('#days').innerHTML = `<table class="data"><thead><tr><th>Date</th><th class="right">Created</th><th class="right">Delivered</th><th class="right">Delivered late</th><th class="right">On-time rate</th><th class="right">Revenue</th></tr></thead><tbody>
    ${[...r.days].reverse().map((d) => `<tr><td>${esc(d.date)}</td><td class="right num">${fmtNum(d.created)}</td><td class="right num">${fmtNum(d.delivered)}</td>
      <td class="right num">${fmtNum(d.deliveredLate)}</td><td class="right num">${d.delivered ? fmtPct(d.onTimeRate) : '—'}</td><td class="right num">${fmtMoney(d.revenue)}</td></tr>`).join('')}</tbody></table>`;

  const maxOut = Math.max(1, ...r.hubs.map((h) => h.outbound));
  $('#hubs').innerHTML = `<table class="data"><thead><tr><th>Hub</th><th style="min-width:160px">Outbound</th><th class="right">Inbound</th><th class="right">Outbound revenue</th></tr></thead><tbody>
    ${r.hubs.map((h) => `<tr class="clickable" data-hub="${h.hubId}"><td><b>${esc(h.code)}</b> ${esc(h.name)}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="bar" style="flex:1"><span style="width:${(h.outbound / maxOut * 100).toFixed(1)}%"></span></div><span class="num" style="min-width:36px;text-align:right">${fmtNum(h.outbound)}</span></div></td>
      <td class="right num">${fmtNum(h.inbound)}</td><td class="right num">${fmtMoney(h.revenue)}</td></tr>`).join('')}</tbody></table>`;
  $('#hubs').querySelectorAll('tr[data-hub]').forEach((tr) => tr.addEventListener('click', () => s.ctx.go(`#/dashboard?originId=${tr.dataset.hub}`)));
}

export default {
  title: 'Reports',

  async mount(root, ctx) {
    s = { ctx, days: 7 };
    root.innerHTML = `
      <div class="filters">
        <div class="seg" id="range" role="group" aria-label="Date range"><button data-days="7" class="on">Last 7 days</button><button data-days="14">Last 14 days</button><button data-days="30">Last 30 days</button></div>
        <span class="muted" id="generated"></span><span style="flex:1"></span>
        <a class="btn" href="/api/reports/shipments.csv">Export all shipments CSV</a>
      </div>
      <div class="grid kpis" id="totals"></div>
      <div class="grid two">
        <section class="card"><div class="card-head"><h2>Daily orders and deliveries</h2><span class="sub">Shipments</span></div><div class="card-body" id="volume"></div></section>
        <section class="card"><div class="card-head"><h2>Daily revenue</h2><span class="sub">RM</span></div><div class="card-body" id="revenue"></div></section>
      </div>
      <div class="grid two">
        <section class="card"><div class="card-head"><h2>Shipments by direction</h2><span class="sub">Shipments created in this period, grouped by direction.</span></div><div class="card-body" id="rose"></div></section>
        <section class="card"><div class="card-head"><h2>Volume by hub</h2></div><div class="card-body flush"><div class="table-wrap" id="hubs"></div></div></section>
      </div>
      <section class="card"><div class="card-head"><h2>Daily breakdown</h2></div><div class="card-body flush"><div class="table-wrap" id="days"></div></div></section>`;
    $('#range').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      s.days = Number(b.dataset.days);
      $('#range').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      load();
    });
    await load();
  },

  unmount() {
    s = null;
  }
};
