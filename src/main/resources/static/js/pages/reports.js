import { get, query } from '../api.js';
import { $, esc, fmtMoney, fmtNum, ZONE } from '../ui.js';

const RANGES = [7, 14, 28];
const amount = new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: ZONE });
const format = value => value == null ? '—' : fmtNum(value);
const money = value => value == null ? '—' : fmtMoney(value);
const percent = value => value == null ? '—' : `${fmtNum(value, 1)}%`;
const weight = value => value == null ? '—' : `${fmtNum(value, Number.isInteger(value) ? 0 : 1)} kg`;
const shortDate = value => date.format(new Date(`${value}T12:00:00+08:00`));

const METRICS = [
  { title: 'Shipments created', value: r => r.totals.created, daily: d => d.created, format },
  { title: 'On-time delivery', value: r => r.totals.delivered ? r.totals.onTimeRate * 100 : null,
    daily: d => d.delivered ? d.onTimeRate * 100 : null, format: percent, rate: true },
  { title: 'Shipping revenue', value: r => Number(r.totals.revenue), daily: d => Number(d.revenue), format: money,
    compact: value => `RM ${amount.format(value)}`, axis: value => `RM ${amount.format(value)}` }
];

const RANKINGS = [
  { title: 'Top origin hubs', key: 'outbound', format },
  { title: 'Top destination hubs', key: 'inbound', format },
  { title: 'Top hubs by revenue', key: 'revenue', format: money }
];

const SIDE_METRICS = [
  { title: 'Shipments delivered', value: r => r.totals.delivered, format },
  { title: 'Average shipment weight', value: r => r.totals.created ? r.totals.avgWeightKg : null, format: weight,
    caption: () => 'Per shipment created' },
  { title: 'Late deliveries', value: r => r.days.reduce((sum, day) => sum + day.deliveredLate, 0), format, lowerIsBetter: true,
    caption: (r, n) => r.totals.delivered ? `${percent(n * 100 / r.totals.delivered)} of deliveries` : 'No shipments delivered' }
];

function deltaBadge(value, prior, { rate = false, lowerIsBetter = false } = {}) {
  if (value == null || prior == null || (!rate && prior === 0)) return '';
  const difference = rate ? value - prior : (value - prior) / prior * 100;
  const absolute = Math.round(Math.abs(difference) * 10) / 10;
  if (!absolute) return `<span class="report-delta" title="Change from prior period">0${rate ? ' pp' : '%'}</span>`;
  const favorable = lowerIsBetter ? difference < 0 : difference > 0;
  return `<span class="report-delta ${favorable ? 'is-favorable' : 'is-unfavorable'}" title="Change from prior period">
    ${difference > 0 ? '+' : '−'}${fmtNum(absolute, absolute % 1 ? 1 : 0)}${rate ? ' pp' : '%'}
  </span>`;
}

function previousValue(value, formatter) {
  return value == null ? 'No prior-period data' : `vs ${formatter(value)} in prior period`;
}

function chart(current, previous, metric) {
  const values = current.map(metric.daily);
  const prior = previous.map(metric.daily);
  if (![...values, ...prior].some(value => value != null)) {
    return '<p class="report-chart-empty">No deliveries in either period.</p>';
  }
  const left = metric.axis ? 54 : 37;
  const right = 289;
  const top = 10;
  const bottom = 104;
  const rawStep = Math.max(1, ...values, ...prior) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = metric.rate ? 25 : Math.max(1, Math.ceil(rawStep / magnitude) * magnitude);
  const max = metric.rate ? 100 : step * 3;
  const x = index => left + (right - left) * index / Math.max(1, values.length - 1);
  const y = value => bottom - (bottom - top) * value / max;
  const tickFormat = metric.axis ?? (metric.rate ? number => `${number}%` : number => amount.format(number));
  const axes = Array.from({ length: metric.rate ? 5 : 4 }, (_, i) => i * step).map(value =>
    `<line x1="${left}" y1="${y(value)}" x2="${right}" y2="${y(value)}" />
     <text x="${left - 7}" y="${y(value) + 3}" text-anchor="end">${esc(tickFormat(value))}</text>`).join('');
  const ticks = [...new Set([0, 1, 2, 3].map(i => Math.round(i * (values.length - 1) / 3)))];
  const days = ticks.map(i =>
    `<text x="${x(i)}" y="124" text-anchor="${i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'}">${esc(shortDate(current[i].date))}</text>`).join('');
  const plot = (points, cssClass) => {
    const path = points.map((value, i) => value == null ? '' : `${i > 0 && points[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(2)} ${y(value).toFixed(2)}`).join(' ');
    const dots = points.map((value, i) => value != null && points[i - 1] == null && points[i + 1] == null
      ? `<circle cx="${x(i)}" cy="${y(value)}" r="2.5"/>` : '').join('');
    return `<g class="${cssClass}"><path d="${path}"/>${dots}</g>`;
  };
  return `<div class="report-legend"><span>Past ${values.length} days</span><span>Prior ${values.length} days</span></div>
    <svg class="report-chart" viewBox="0 0 298 130" role="img" aria-label="${esc(metric.title)} daily trend for the current and prior periods">
      <g class="report-chart-axes">${axes}${days}</g>
      ${plot(prior, 'report-series-prior')}${plot(values, 'report-series-current')}
    </svg>`;
}

function metricCard(metric, current, previous) {
  const value = metric.value(current);
  const prior = metric.value(previous);
  return `<article class="report-card report-metric">
    <header><h3>${esc(metric.title)}</h3>${deltaBadge(value, prior, metric)}</header>
    <p class="report-number" title="${esc(metric.format(value))}">${esc(metric.compact && value >= 10000 ? metric.compact(value) : metric.format(value))}</p>
    <p class="report-caption">${esc(previousValue(prior, metric.format))}</p>
    <div class="report-plot">${chart(current.days, previous.days, metric)}</div>
  </article>`;
}

function rankingCard({ title, key, format: formatter }, hubs) {
  const rows = hubs.filter(hub => Number(hub[key]) > 0).sort((a, b) => Number(b[key]) - Number(a[key]) || a.code.localeCompare(b.code)).slice(0, 5);
  return `<article class="report-card report-ranking"><h3>${esc(title)}</h3>
    ${rows.length ? `<ol>${rows.map(hub => `<li><span>${esc(hub.name)}</span><strong>${esc(formatter(hub[key]))}</strong></li>`).join('')}</ol>`
    : '<p class="report-caption">No activity in this period.</p>'}
  </article>`;
}

function sideMetric(metric, current, previous) {
  const value = metric.value(current);
  const prior = metric.value(previous);
  const caption = metric.caption ? metric.caption(current, value) : previousValue(prior, metric.format);
  return `<article class="report-card report-side-metric">
    <header><h3>${esc(metric.title)}</h3>${deltaBadge(value, prior, metric)}</header>
    <p class="report-side-number">${esc(metric.format(value))}</p>
    <p class="report-caption">${esc(caption)}</p>
  </article>`;
}

function directionMix(current) {
  const rows = current.directions.filter(direction => direction.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 3);
  return `<article class="report-card report-side-metric"><h3>Top shipment directions</h3>
    ${rows.length ? `<dl class="report-directions">${rows.map(direction =>
      `<div><dt>${esc(direction.label)}</dt><dd title="${fmtNum(direction.count)} shipments">${Math.round(direction.count * 100 / current.totals.created)}%</dd></div>`).join('')}</dl>`
    : '<p class="report-caption">No shipments in this period.</p>'}
  </article>`;
}

let state;

async function load(current) {
  const version = ++current.version;
  const days = Number($('#report-range', current.root).value);
  const content = $('#report-content', current.root);
  const status = $('#report-status', current.root);
  content.setAttribute('aria-busy', 'true');
  status.textContent = 'Loading report…';
  try {
    const { current: report, previous } = await get(`/api/reports/summary${query({ days })}`);
    if (state !== current || version !== current.version) return;
    const period = report.days;
    status.textContent = `${shortDate(period[0].date)} – ${shortDate(period.at(-1).date)} · Malaysia time`;
    content.innerHTML = `
      <div class="report-comparison">
        ${METRICS.map(metric => metricCard(metric, report, previous)).join('')}
        ${RANKINGS.map(ranking => rankingCard(ranking, report.hubs)).join('')}
      </div>
      <aside class="report-side" aria-label="Additional metrics">
        ${SIDE_METRICS.map(metric => sideMetric(metric, report, previous)).join('')}
        ${directionMix(report)}
      </aside>`;
  } catch {
    if (state !== current || version !== current.version) return;
    status.textContent = 'Report unavailable';
    content.innerHTML = '<div class="report-card report-error"><p>The report could not load.</p><button type="button" class="btn" data-report-retry>Retry</button></div>';
  } finally {
    if (state === current && version === current.version) content.setAttribute('aria-busy', 'false');
  }
}

export default {
  title: 'Reports',

  async mount(root) {
    const current = { root, version: 0 };
    state = current;
    root.innerHTML = `<section class="reports-workspace light-workspace" aria-labelledby="report-title">
      <header class="report-heading">
        <div><h2 id="report-title">Key Performance Summary</h2><p id="report-status" aria-live="polite"></p></div>
        <label class="report-range"><span>Time range</span><select id="report-range" class="input">
          ${RANGES.map(days => `<option value="${days}"${days === 28 ? ' selected' : ''}>Last ${days} days</option>`).join('')}
        </select></label>
      </header>
      <div class="report-layout" id="report-content"></div>
    </section>`;
    $('#report-range', root).addEventListener('change', () => load(current));
    $('#report-content', root).addEventListener('click', event => {
      if (event.target.closest('[data-report-retry]')) load(current);
    });
    await load(current);
  },

  unmount() {
    state = null;
  }
};
