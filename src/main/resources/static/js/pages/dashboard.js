import { get, query } from '../api.js';
import { FreightMap } from '../freight-map.js';
import { EXCEPTION_REASONS, hubName, SHIPMENT_STATES } from '../overview-labels.js';
import { $, DIRS, DIR_ANGLE, esc, fmtKg, fmtMoney, fmtNum, fmtPct, fmtTime, hubOptions, throttle, ZONE } from '../ui.js';
import { vehicleIllustration } from '../vehicle-illustration.js';
import { openCreateShipment, openShipment } from './shipments.js';

const DIRECTION_NAMES = { N: 'North', NE: 'Northeast', E: 'East', SE: 'Southeast', S: 'South', SW: 'Southwest', W: 'West', NW: 'Northwest' };
const ICONS = [
  '<path d="m3 7 9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4m-9 4v10"/>',
  '<path d="M5 4h14v16H5zm4 5h6m-6 4h6"/>',
  '<path d="M12 5v14M5 12h14"/>',
  '<path d="m5 12 4 4L19 6"/>',
  '<path d="M12 4 3 20h18zM12 9v5m0 3v1"/>',
  '<path d="M3 6h12v10H3zM15 10h3l3 3v3h-6M6 19h2m8 0h2"/>'
].map(path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`);

let state;
const trends = { active: [], pending: [], late: [], fleet: [] };
const TREND_LENGTH = 24;

function polar(cx, cy, radius, degrees) {
  const rad = degrees * Math.PI / 180;
  return [cx + radius * Math.sin(rad), cy - radius * Math.cos(rad)];
}

function recordTrends(d) {
  const counts = Object.fromEntries((d.statuses ?? []).map(({ status, count }) => [status, count]));
  const samples = {
    active: d.statuses ? ['ASSIGNED', 'IN_TRANSIT', 'AT_TRANSFER', 'ARRIVED_HUB', 'OUT_FOR_DELIVERY'].reduce((total, status) => total + (counts[status] ?? 0), 0) : null,
    pending: d.statuses ? (counts.CREATED ?? 0) + (counts.AT_TRANSFER ?? 0) : null,
    late: d.alerts ? d.alerts.late : null,
    fleet: d.fleet ? Number(d.fleet.utilisation) * 100 : null
  };
  for (const [key, value] of Object.entries(samples)) {
    if (Number.isFinite(value)) trends[key] = [...trends[key], value].slice(-TREND_LENGTH);
  }
}

const chartDate = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const exceptionDate = new Intl.DateTimeFormat('en-MY', { day: 'numeric', month: 'short', timeZone: ZONE });

function metricChart(label, { recent, prior = [], dates = [], unit = '' }) {
  if (!recent.length) return '<p class="overview-chart-empty">Trend data unavailable</p>';
  const max = Math.max(4, Math.ceil(Math.max(...recent, ...prior) / 4) * 4);
  const [left, right, top, bottom] = [40, 305, 12, 108];
  const x = index => recent.length === 1 ? (left + right) / 2 : left + index * (right - left) / (recent.length - 1);
  const y = value => bottom - (bottom - top) * value / max;
  const plot = (series, name) => {
    if (!series.length) return '';
    if (series.length === 1) return `<circle class="chart-dot ${name}" cx="${x(0)}" cy="${y(series[0])}" r="3"/>`;
    const points = series.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
    return `<polyline class="chart-line ${name}" points="${points}"/>`;
  };
  const ticks = [max, max * .75, max * .5, max * .25, 0].map(value => `
    <line class="chart-gridline" x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}"/>
    <text x="${left - 7}" y="${y(value)}" dy=".32em" text-anchor="end">${fmtNum(value)}${unit}</text>`).join('');
  const xLabels = dates.length ? [0, 2, 4, 6].filter(i => i < dates.length).map(i =>
    `<text x="${x(i)}" y="128" text-anchor="middle">${chartDate.format(new Date(dates[i]))}</text>`).join('') : '';
  const recentLabel = dates.length ? 'Last 7 days' : 'Recent samples';
  const priorLabel = dates.length ? 'Previous 7 days' : 'Earlier samples';
  const description = `${label}. ${recentLabel}: ${recent.map(value => `${fmtNum(value)}${unit}`).join(', ')}`
    + (prior.length ? `. ${priorLabel}: ${prior.map(value => `${fmtNum(value)}${unit}`).join(', ')}` : '');
  return `<div class="overview-chart">
    <div class="overview-chart-key"><span><i></i>${recentLabel}</span>${prior.length ? `<span class="chart-prior"><i></i>${priorLabel}</span>` : ''}</div>
    <svg viewBox="0 0 325 ${dates.length ? 136 : 119}" role="img" aria-label="${esc(description)}">
      ${ticks}${xLabels}${plot(prior, 'chart-prior')}${plot(recent, 'chart-recent')}
    </svg>
  </div>`;
}

const withUnit = text => (text.endsWith('%') ? `${text.slice(0, -1)}<small>%</small>` : text);

function kpi(index, label, value, hint, series) {
  const sum = values => values.reduce((total, n) => total + n, 0);
  const baseline = series.dates?.length ? sum(series.prior) : 0;
  const change = baseline ? (sum(series.recent) - baseline) * 100 / baseline : 0;
  const badge = baseline ? `<span class="overview-kpi-change ${change < 0 ? 'is-down' : ''}" aria-label="${fmtNum(Math.abs(change))}% ${change < 0 ? 'lower' : change > 0 ? 'higher' : 'change'} than the previous 7 days" title="Compared with the previous 7 days">${change > 0 ? '+' : ''}${fmtNum(change)}%</span>` : '';
  return `<article class="overview-kpi">
    <header class="overview-kpi-head"><span class="overview-kpi-icon">${ICONS[index]}</span><h3>${label}</h3>${badge}</header>
    <strong class="overview-kpi-value">${withUnit(value)}</strong>
    <p class="overview-kpi-hint">${hint}</p>
    ${metricChart(label, series)}
  </article>`;
}

function renderKpis(d, history) {
  const counts = Object.fromEntries((d.statuses ?? []).map(({ status, count }) => [status, count]));
  const moving = ['ASSIGNED', 'IN_TRANSIT', 'AT_TRANSFER', 'ARRIVED_HUB', 'OUT_FOR_DELIVERY'].reduce((total, status) => total + (counts[status] ?? 0), 0);
  const pending = (counts.CREATED ?? 0) + (counts.AT_TRANSFER ?? 0);
  const { today, alerts, fleet } = d;
  const days = history.slice(0, -1);
  const daily = field => ({
    recent: days.slice(-7).map(day => day[field]),
    prior: days.length >= 14 ? days.slice(-14, -7).map(day => day[field]) : [],
    dates: days.slice(-7).map(day => day.date)
  });
  const live = (key, unit) => {
    const series = trends[key];
    if (series.length < 8) return { recent: series, unit };
    const size = Math.floor(series.length / 2);
    return { recent: series.slice(-size), prior: series.slice(-2 * size, -size), unit };
  };
  $('#kpis').innerHTML = [
    kpi(0, 'Active shipments', d.statuses ? fmtNum(moving) : '—', `${fmtNum(counts.IN_TRANSIT)} in transit · ${fmtNum(counts.OUT_FOR_DELIVERY)} out for delivery`,
      live('active')),
    kpi(1, 'Awaiting dispatch', d.statuses ? fmtNum(pending) : '—', `${fmtNum(counts.CREATED)} new · ${fmtNum(counts.AT_TRANSFER)} at transfer`,
      live('pending')),
    kpi(2, 'Orders today', today ? fmtNum(today.created) : '—', today ? `${fmtMoney(today.revenue)} revenue` : 'Unavailable', daily('created')),
    kpi(3, 'Delivered today', today ? fmtNum(today.delivered) : '—', today ? `${fmtPct(today.onTimeRate24h)} on time in 24h` : 'Unavailable', daily('delivered')),
    kpi(4, 'Late shipments', alerts ? fmtNum(alerts.late) : '—', alerts ? `${fmtNum(alerts.exceptions)} delivery exceptions` : 'Unavailable',
      live('late')),
    kpi(5, 'Fleet utilisation', fleet ? fmtPct(fleet.utilisation) : '—', fleet ? `${fleet.onTrip} on trip · ${fleet.idle} idle · ${fleet.maintenance} maintenance` : 'Unavailable',
      live('fleet', '%'))
  ].join('');
}

function shipmentHref(params) {
  return `#/shipments${query({ ...params, active: state.scope === 'active' })}`;
}

function renderDirections(directions) {
  const root = $('#directions');
  if (!directions) {
    state.directionMarkup = null;
    root.innerHTML = '<p class="overview-empty">Direction data is unavailable.</p>';
    return;
  }
  const byDirection = new Map(directions.map(d => [d.direction, d]));
  const compass = DIRS.map(direction => byDirection.get(direction) ?? { direction, count: 0, weightKg: 0 });
  const total = compass.reduce((sum, d) => sum + d.count, 0);
  const peak = Math.max(1, ...compass.map(d => d.count));
  const center = 90, inner = 11, outer = 78;
  const radius = fraction => Math.sqrt(inner ** 2 + (outer ** 2 - inner ** 2) * fraction);
  const href = direction => shipmentHref({ direction, originId: state.originId });
  const tone = direction => direction.length === 1 ? 'is-lime' : 'is-teal';
  const guides = [.25, .5, .75, 1].map(fraction =>
    `<circle cx="${center}" cy="${center}" r="${radius(fraction)}"/>`).join('');
  const sectors = compass.filter(d => d.count > 0).map(d => {
    const r = radius(d.count / peak);
    const start = DIR_ANGLE[d.direction] - 20.5;
    const end = DIR_ANGLE[d.direction] + 20.5;
    const [tipStart, tipEnd, baseStart, baseEnd] = [
      polar(center, center, r, start), polar(center, center, r, end),
      polar(center, center, inner, start), polar(center, center, inner, end)
    ];
    const path = `M${baseStart} L${tipStart} A${r},${r} 0 0 1 ${tipEnd} L${baseEnd} A${inner},${inner} 0 0 0 ${baseStart} Z`;
    return `<a class="direction-sector ${tone(d.direction)}" href="${esc(href(d.direction))}" tabindex="-1" data-direction="${d.direction}">
      <path d="${path}"/>
      <title>${DIRECTION_NAMES[d.direction]} · ${fmtNum(d.count)} shipments · ${fmtKg(d.weightKg)}</title>
    </a>`;
  }).join('');
  const legend = compass.map(d => `<li><a class="${tone(d.direction)}" href="${esc(href(d.direction))}" data-direction="${d.direction}" title="${fmtKg(d.weightKg)}">
    <i aria-hidden="true"></i><span>${DIRECTION_NAMES[d.direction]}</span><b>${fmtNum(d.count)}</b>
  </a></li>`).join('');
  const markup = `<div class="direction-chart">
    <div class="direction-total"><strong>${fmtNum(total)}</strong><span>${state.scope === 'active' ? 'Active shipments' : 'Total shipments'}</span></div>
    <svg class="direction-rose" viewBox="0 0 180 180" role="img" aria-label="Shipments by compass direction">
      <g class="direction-guides" aria-hidden="true">${guides}</g>
      ${sectors}
      <circle class="direction-center" cx="${center}" cy="${center}" r="7" aria-hidden="true"/>
    </svg>
    <ul class="direction-key" aria-label="Shipment counts by direction">${legend}</ul>
  </div>`;
  if (markup === state.directionMarkup) return;
  const focused = $('.direction-key a:focus', root)?.dataset.direction;
  state.directionMarkup = markup;
  root.innerHTML = markup;
  if (focused) $(`.direction-key a[data-direction="${focused}"]`, root)?.focus({ preventScroll: true });
}

function renderLanes(lanes) {
  const rows = (lanes ?? []).map(lane => ({
    ...lane, origin: state.ctx.hubsById.get(lane.originId), destination: state.ctx.hubsById.get(lane.destinationId)
  })).filter(lane => lane.origin && lane.destination).slice(0, 3);
  const max = Math.max(1, ...rows.map(row => row.count));
  const shipments = rows.reduce((sum, row) => sum + row.count, 0);
  const weight = rows.reduce((sum, row) => sum + row.weightKg, 0);
  const segmentCount = 9;
  const links = rows.map(row => {
    const levels = Array.from({ length: segmentCount }, (_, index) =>
      Math.min(100, Math.max(0, (row.count / max * segmentCount - index) * 100)));
    const href = shipmentHref({ originId: row.originId, destinationId: row.destinationId });
    return `<a class="insight-lane" href="${esc(href)}">
      <span class="insight-route"><strong>${esc(row.origin.code)} <span aria-hidden="true">→</span> ${esc(row.destination.code)}</strong><small>${DIRECTION_NAMES[row.direction]}</small></span>
      <span class="insight-segments" aria-hidden="true">${levels.map(level => level > 0 ? `<i class="has-fill" style="--segment-fill:${level}%"></i>` : '<i></i>').join('')}</span>
      <span class="insight-detail"><b>${fmtNum(row.count)} shipments</b><span>${fmtKg(row.weightKg)}</span></span>
    </a>`;
  }).join('');
  const markup = rows.length ? `<div class="insight-metrics" aria-label="Totals for the routes shown">
    <div><span>Routes shown</span><strong>${fmtNum(rows.length)}</strong></div>
    <div><span>Shipments</span><strong>${fmtNum(shipments)}</strong></div>
    <div><span>Total weight</span><strong>${fmtNum(weight)} <small>kg</small></strong></div>
  </div><div class="insight-list">${links}</div>` : '<p class="overview-empty">No routes in this view.</p>';
  if (markup === state.laneMarkup) return;
  const root = $('#lanes');
  const focused = $('.insight-lane:focus', root)?.getAttribute('href');
  state.laneMarkup = markup;
  root.innerHTML = markup;
  if (focused) Array.from(root.querySelectorAll('.insight-lane'))
    .find(link => link.getAttribute('href') === focused)?.focus({ preventScroll: true });
}

const ALERT_ICONS = {
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z"/><circle cx="12" cy="12" r="2"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
  filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16l-6 7v5l-4 2v-7z"/></svg>',
  columns: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M10 5v14m4-14v14"/></svg>',
  density: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  driver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="12" cy="8" r="3"/><path d="M5 20v-1a7 7 0 0114 0v1"/></svg>'
};
const EXCEPTION_COLUMNS = [
  ['id', 'ID'], ['vehicle', 'Vehicle info'], ['driver', 'Assigned drivers'], ['status', 'Status'],
  ['location', 'Location'], ['capacity', 'Capacity'], ['features', 'Features'], ['service', 'Next service'],
  ['fuel', 'Fuel score'], ['action', 'Actions']
];
const VEHICLE_NAMES = { VAN: 'Van', LORRY: 'Lorry', TRAILER: 'Trailer', AIR_CARGO: 'Cargo aircraft' };
const PRIORITY_NAMES = { STANDARD: 'Standard', EXPRESS: 'Express' };
const ALERT_FILTER_GROUPS = {
  'Vehicle features': { refrigerated: 'Refrigerated', heavy: 'Heavy' },
  Status: { exception: 'Exception', overdue: 'Overdue' },
  Service: PRIORITY_NAMES
};
const ALERT_FILTERS = Object.assign({}, ...Object.values(ALERT_FILTER_GROUPS));
const LIVE_SHIPMENT_STATES = new Set(['ASSIGNED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY']);

function driverStack(drivers) {
  const remaining = drivers.slice(3);
  const names = drivers.map(driver => driver.name).join(', ');
  const visible = drivers.slice(0, 3).map(({ name, portrait }) => {
    if (!Number.isInteger(portrait) || portrait < 0 || portrait > 15) {
      return `<span class="exception-person" title="${esc(name)}">${ALERT_ICONS.driver}</span>`;
    }
    const x = (portrait % 4) * (100 / 3);
    const y = Math.floor(portrait / 4) * (100 / 3);
    return `<span class="exception-person has-portrait" style="--portrait-position:${x}% ${y}%" title="${esc(name)}"></span>`;
  }).join('');
  return `<span class="exception-driver-stack" role="img" aria-label="${esc(names)}">${visible}${remaining.length
    ? `<span class="exception-driver-count" title="${esc(remaining.map(driver => driver.name).join(', '))}">+${remaining.length}</span>` : ''}</span>`;
}

function pendingRow(x, vehicle, late, columns) {
  const exception = x.status === 'EXCEPTION';
  const reason = EXCEPTION_REASONS[x.exceptionReason] ?? x.exceptionReason;
  const type = VEHICLE_NAMES[vehicle?.type];
  const drivers = vehicle?.assignedDrivers ?? (vehicle?.driverName ? [{ name: vehicle.driverName }] : []);
  const location = x.currentHub ? hubName(x.currentHub) : '—';
  const status = exception ? 'Exception' : SHIPMENT_STATES[x.status] ?? x.status;
  const statusTone = exception ? ' is-exception' : LIVE_SHIPMENT_STATES.has(x.status) ? ' is-live' : '';
  const missing = '<span class="exception-missing">—</span>';
  const fuel = vehicle?.fuelScore;
  const cells = {
    vehicle: `${type ? `<span class="exception-vehicle-type">${esc(type)}</span> ` : ''}${x.plateNo ? `<span class="exception-value">${esc(x.plateNo)}</span>` : '<span class="exception-missing">Unassigned</span>'}`,
    driver: drivers.length ? driverStack(drivers) : missing,
    status: `<span class="exception-tags" title="${esc(reason || status)}"><span class="exception-tag${statusTone}">${esc(status)}</span>${late ? '<span class="exception-tag is-late">Overdue</span>' : ''}</span>`,
    location: `<span class="exception-location" title="${esc(location)}">${esc(location)}</span>${x.currentHub ? ` <span class="exception-value">${esc(x.currentHub.code)}</span>` : ''}`,
    capacity: vehicle?.capacityKg != null ? fmtKg(vehicle.capacityKg) : missing,
    features: [
      vehicle?.refrigerated && 'Refrigerated',
      vehicle?.heavyDuty && 'Heavy',
      x.priority && PRIORITY_NAMES[x.priority],
      vehicle?.type === 'AIR_CARGO' && 'Air'
    ].filter(Boolean).map(label => `<span class="exception-feature">${label}</span>`).join(' '),
    service: vehicle?.nextServiceOn ? `<time datetime="${esc(vehicle.nextServiceOn)}">${esc(vehicle.nextServiceOn.split('-').reverse().join('/'))}</time>` : missing,
    fuel: Number.isInteger(fuel) ? `<span class="exception-fuel${fuel < 4 ? ' is-low' : ''}"><i aria-hidden="true" style="--fuel:${fuel * 10}%"></i><span>${fuel}/10</span></span>` : missing,
    action: `<button type="button" class="exception-action" data-no="${esc(x.trackingNo)}" aria-label="Review shipment ${esc(x.trackingNo)}" title="Review shipment">${ALERT_ICONS.review}</button>`
  };
  return `<tr class="exception-row">${columns.map(([key]) => key === 'id'
    ? `<th scope="row" class="ex-id">${esc(x.trackingNo)}</th>`
    : `<td class="ex-${key}">${cells[key]}</td>`).join('')}</tr>`;
}

function exceptionHistoryChart(buckets) {
  if (!buckets?.length) return '<p class="overview-empty">Exception history is unavailable.</p>';
  const peak = Math.max(2, ...buckets.map(bucket => bucket.count));
  const summary = buckets.map(({ start, count }) => `${fmtTime(start)}: ${fmtNum(count)}`).join(', ');
  const days = new Map();
  buckets.forEach(({ start }, index) => {
    const label = exceptionDate.format(new Date(start));
    const day = days.get(label);
    if (day) day.width++;
    else days.set(label, { first: index + 1, width: 1 });
  });
  return `<figure class="exception-history-chart">
    <figcaption><strong>Recorded exceptions</strong><span>Last 72 hours · 3h intervals</span></figcaption>
    <div class="exception-history-plot" role="img" aria-label="${esc(`Exceptions in 3-hour intervals. ${summary}`)}">
      ${buckets.map(({ start, count }) => {
        const level = count / peak;
        const tone = level >= .75 ? 'is-high' : level >= .5 ? 'is-mid' : 'is-low';
        return `<div class="exception-history-column" title="${esc(`${fmtTime(start)} · ${fmtNum(count)} exception${count === 1 ? '' : 's'}`)}">
          ${count ? `<div class="exception-history-bar ${tone}" style="--level:${level}"><span>${fmtNum(count)}</span></div>` : ''}
        </div>`;
      }).join('')}
      ${buckets.some(bucket => bucket.count > 0) ? '' : '<p class="exception-history-empty">No exceptions recorded in this period.</p>'}
    </div>
    <div class="exception-history-axis" style="--buckets:${buckets.length}" aria-hidden="true">
      ${[...days].map(([label, { first, width }]) => `<span style="grid-column:${first} / span ${width}">${label}</span>`).join('')}
    </div>
  </figure>`;
}

function renderExceptionSummary({ alerts, today }) {
  const count = value => value === undefined ? '—' : fmtNum(value);
  const onTime = today?.delivered24h ? fmtPct(today.onTimeRate24h).replace('.0%', '%') : '—';
  $('#exception-stats').innerHTML = `<dl class="exception-overview-values">
    <div><dt>Exceptions</dt><dd>${count(alerts?.exceptions)}</dd><dd class="exception-overview-note">Currently open</dd></div>
    <div><dt>Overdue</dt><dd>${count(alerts?.late)}</dd><dd class="exception-overview-note">Active shipments</dd></div>
    <div><dt>On-time delivery</dt><dd>${onTime}</dd><dd class="exception-overview-note">${today ? `${fmtNum(today.delivered24h)} delivered in 24h` : 'Data unavailable'}</dd></div>
  </dl>${exceptionHistoryChart(alerts?.exceptionTrend)}`;
}

function renderAlerts() {
  const { alerts, alertFilters, alertSearch, vehiclesByPlate } = state;
  const root = $('#alerts');
  const pager = $('#exception-pagination');
  if (!alerts) {
    state.alertMarkup = null;
    root.innerHTML = '<p class="overview-empty">Exception data is unavailable.</p>';
    pager.hidden = true;
    return;
  }
  const unique = new Map();
  const exceptions = alerts.latestExceptions;
  const overdue = alerts.topLate;
  const overdueIds = new Set(alerts.topLate.map(shipment => shipment.trackingNo));
  for (const shipment of [...exceptions.slice(0, 4), ...overdue.slice(0, 4), ...exceptions.slice(4), ...overdue.slice(4)]) {
    if (!unique.has(shipment.trackingNo)) unique.set(shipment.trackingNo, shipment);
  }
  const statusFilters = Object.keys(ALERT_FILTER_GROUPS.Status).filter(key => alertFilters.has(key));
  const serviceFilters = Object.keys(PRIORITY_NAMES).filter(key => alertFilters.has(key));
  const matches = [...unique.values()].filter(x => {
    if (statusFilters.length && !statusFilters.some(key => key === 'exception' ? x.status === 'EXCEPTION' : x.late || overdueIds.has(x.trackingNo))) return false;
    if (serviceFilters.length && !serviceFilters.includes(x.priority)) return false;
    const vehicle = vehiclesByPlate.get(x.plateNo);
    if (alertFilters.has('refrigerated') && !vehicle?.refrigerated) return false;
    if (alertFilters.has('heavy') && !vehicle?.heavyDuty) return false;
    const reason = EXCEPTION_REASONS[x.exceptionReason] ?? x.exceptionReason;
    return [x.trackingNo, x.origin.code, x.destination.code, x.currentHub?.code, x.currentHub?.name,
      x.plateNo, vehicle?.driverName, ...(vehicle?.assignedDrivers ?? []).map(driver => driver.name),
      VEHICLE_NAMES[vehicle?.type], reason].some(value =>
      String(value ?? '').toLowerCase().includes(alertSearch));
  });
  const order = state.alertDescending ? -1 : 1;
  if (state.alertSort === 'id') {
    matches.sort((a, b) => order * a.trackingNo.localeCompare(b.trackingNo));
  } else if (state.alertSort === 'updated') {
    matches.sort((a, b) => order * (Date.parse(a.statusChangedAt) - Date.parse(b.statusChangedAt)));
  } else if (state.alertSort === 'due') {
    matches.sort((a, b) => order * (Date.parse(a.promisedBy) - Date.parse(b.promisedBy)));
  } else if (state.alertDescending) {
    matches.reverse();
  }
  const pages = Math.max(1, Math.ceil(matches.length / state.alertPageSize));
  state.alertPage = Math.min(state.alertPage, pages);
  const start = (state.alertPage - 1) * state.alertPageSize;
  const rows = matches.slice(start, start + state.alertPageSize);
  pager.hidden = !matches.length;
  $('#exception-row-count').textContent = `Total ${matches.length} recent ${matches.length === 1 ? 'item' : 'items'}`;
  const pageList = $('#exception-pages');
  const pagination = `${state.alertPage}/${pages}`;
  if (pageList.dataset.pagination !== pagination) {
    const focusedPage = pageList.contains(document.activeElement) ? document.activeElement.dataset.page : null;
    pageList.innerHTML = Array.from({ length: pages }, (_, i) => `<button type="button" data-page="${i + 1}" aria-label="Page ${i + 1}"${i + 1 === state.alertPage ? ' aria-current="page"' : ''}>${i + 1}</button>`).join('');
    pageList.dataset.pagination = pagination;
    if (focusedPage) pageList.querySelector(`[data-page="${focusedPage}"]`)?.focus({ preventScroll: true });
  }
  $('#exception-prev').disabled = state.alertPage === 1;
  $('#exception-next').disabled = state.alertPage === pages;
  const columns = EXCEPTION_COLUMNS.filter(([key]) => !state.hiddenAlertColumns.has(key));
  const sort = state.alertSort === 'id' ? ` aria-sort="${state.alertDescending ? 'descending' : 'ascending'}"` : '';
  const table = rows.length ? `<div class="exception-table-scroll" role="region" aria-label="Pending shipments table" tabindex="0"><table class="exception-table" style="--visible-columns:${columns.length}">
    <thead><tr>${columns.map(([key, name]) => `<th scope="col" class="ex-${key}"${key === 'id' ? sort : ''}>${name}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(x => pendingRow(x, vehiclesByPlate.get(x.plateNo), x.late || overdueIds.has(x.trackingNo), columns)).join('')}</tbody>
    </table></div>` : '<p class="overview-empty">No pending items match.</p>';
  if (table === state.alertMarkup) return;
  const previous = $('.exception-table-scroll', root);
  const scrollLeft = previous?.scrollLeft ?? 0;
  const focused = previous?.contains(document.activeElement);
  const focusedShipment = focused ? document.activeElement.dataset.no : null;
  state.alertMarkup = table;
  root.innerHTML = table;
  const current = $('.exception-table-scroll', root);
  if (current) current.scrollLeft = scrollLeft;
  if (focused && current) {
    const button = focusedShipment && current.querySelector(`[data-no="${CSS.escape(focusedShipment)}"]`);
    (button || current).focus({ preventScroll: true });
  }
}

function tripProgress(trip, now) {
  if (trip.status === 'ARRIVED') return 100;
  if (trip.status !== 'IN_TRANSIT') return 0;
  const depart = Date.parse(trip.departAt);
  const duration = Date.parse(trip.arriveAt) - depart;
  return duration > 0 ? Math.round(Math.max(0, Math.min(1, (now - depart) / duration)) * 100) : 0;
}

function tripCard(trip, now, highlighted) {
  const loading = trip.status === 'LOADING';
  const loadPercent = trip.capacityKg > 0
    ? Math.round(Math.max(0, Math.min(1, trip.loadKg / trip.capacityKg)) * 100)
    : null;
  const progress = loading ? loadPercent : tripProgress(trip, now);
  const progressLabel = loading ? 'Load progress' : 'Trip progress';
  const tone = trip.delayReason && trip.status === 'IN_TRANSIT' ? 'is-delayed' : trip.status.toLowerCase();
  const vehicle = vehicleIllustration(trip.vehicleType, trip.vehicleTypeLabel);
  const stops = `${hubName(trip.origin)} → ${hubName(trip.destination)}`;
  const driver = trip.driverName?.trim() || 'Driver unassigned';
  return `<article class="tracking-card${highlighted ? ' is-highlighted' : ''}">
    <div class="tracking-card-main">
      <span class="tracking-state ${esc(tone)}">${tone === 'is-delayed' ? 'Delayed' : esc(trip.statusLabel)}</span>
      ${vehicle ? `<div class="tracking-portrait">${vehicle}</div>` : ''}
      <div class="tracking-meta">
        <h3>${esc(trip.code)}</h3>
        <span>${fmtKg(trip.loadKg)}${loadPercent === null ? '' : ` <span class="tracking-load-share">· (${loadPercent}%)</span>`}</span>
      </div>
    </div>
    <footer class="tracking-journey">
      <div class="tracking-route-row">
        <b title="${esc(stops)}">${esc(trip.origin.code)} → ${esc(trip.destination.code)}</b>
        <span class="tracking-driver">${esc(driver)}${loading ? ' · Dock —' : ''}</span>
      </div>
      <div class="tracking-progress-label"><span>${progressLabel}</span><span aria-hidden="true">${progress === null ? '—' : `${progress}%`}</span></div>
      <div class="tracking-progress" role="progressbar" aria-label="${progressLabel}"${progress === null ? '' : ` aria-valuenow="${progress}"`} aria-valuemin="0" aria-valuemax="100" style="--progress:${progress ?? 0}%">
        <i class="tracking-fill" aria-hidden="true"></i>
      </div>
    </footer>
    <button type="button" class="tracking-card-map" data-trip-id="${esc(trip.id)}" aria-label="Show trip ${esc(trip.code)} on the map" title="Show on map"></button>
  </article>`;
}

function renderTracking() {
  const { activeTrips, arrivals, ctx } = state;
  const ordered = [...activeTrips].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const completed = new Set(arrivals.map(trip => trip.id));
  const active = ordered.filter(trip => !completed.has(trip.id));
  const featured = [active.find(t => t.status === 'LOADING'), active.find(t => t.status === 'IN_TRANSIT'), arrivals[0]].filter(Boolean);
  const featuredIds = new Set(featured.map(t => t.id));
  const visible = [...featured, ...[...active, ...arrivals].filter(trip => !featuredIds.has(trip.id))].slice(0, 6);
  const cards = $('#tracking-cards');
  const now = ctx.simNow();
  const markup = visible.length ? visible.map(trip => tripCard(trip, now, trip.id === state.focusedTripId)).join('')
    : '<p class="overview-empty">No trips to display.</p>';
  if (markup === state.trackingMarkup) return;
  const focusedTrip = cards.contains(document.activeElement) ? document.activeElement.dataset.tripId : null;
  state.trackingMarkup = markup;
  cards.innerHTML = markup;
  if (focusedTrip) cards.querySelector(`[data-trip-id="${CSS.escape(focusedTrip)}"]`)?.focus({ preventScroll: true });
}

async function loadDashboard(current) {
  const version = ++current.dashboardVersion;
  const d = await get(`/api/dashboard${query({ originId: current.originId, scope: current.scope })}`);
  if (state !== current || version !== current.dashboardVersion) return;
  $('#degraded').textContent = d.degraded?.length ? 'Some dashboard data is temporarily unavailable.' : '';
  current.dashboard = d;
  current.alerts = d.alerts;
  recordTrends(d);
  renderKpis(d, current.history);
  renderExceptionSummary(d);
  renderDirections(d.directions);
  renderLanes(d.lanes);
  renderAlerts();
  current.map.setFlows(d.lanes);
}

async function loadHistory(current) {
  try {
    const report = await get('/api/reports/daily?days=15');
    if (state !== current) return;
    current.history = report.days ?? [];
    if (current.dashboard) renderKpis(current.dashboard, current.history);
  } catch { }
}

async function loadVehicles(current) {
  try {
    const version = ++current.fleetVersion;
    const vehicles = await get('/api/vehicles');
    if (state !== current || version !== current.fleetVersion) return;
    current.vehiclesByPlate = new Map(vehicles.map(vehicle => [vehicle.plateNo, vehicle]));
    if (current.alerts) renderAlerts();
  } catch { }
}

async function loadTrips(current) {
  if (state !== current) return;
  const version = ++current.tripVersion;
  const [active, recent] = await Promise.allSettled([get('/api/trips'), get('/api/trips/recent?limit=4')]);
  if (state !== current || version !== current.tripVersion) return;
  if (active.status === 'fulfilled') {
    current.activeTrips = active.value;
    current.map.setTrips(active.value);
    const trip = current.activeTrips.find(item => item.id === current.requestedTripId);
    if (trip) {
      current.requestedTripId = null;
      current.focusedTripId = trip.id;
      current.map.focusTrip(trip);
    }
  }
  if (recent.status === 'fulfilled') current.arrivals = recent.value;
  renderTracking();
}

function setOrigin(current, id, showPopup = false) {
  current.originId = id || null;
  $('#origin-filter').value = current.originId ?? '';
  current.map.setHubs(current.ctx.hubs, current.originId, { showPopup });
  current.reloadSoon();
}

function wirePendingTable(current, ctx) {
  const search = $('#exception-search');
  const panel = $('.overview-exceptions');
  const filterChoice = $('#exception-filter-choice');
  const chips = $('#exception-active');
  const sortChoice = $('#exception-sort');
  const sortOrder = $('#exception-sort-order');
  const applySort = () => {
    sortOrder.textContent = current.alertDescending ? 'Descending' : 'Ascending';
    sortOrder.setAttribute('aria-pressed', String(current.alertDescending));
    current.alertPage = 1;
    renderAlerts();
  };
  const refreshFilters = () => {
    filterChoice.value = '';
    for (const option of filterChoice.options) option.disabled = !option.value || current.alertFilters.has(option.value);
    chips.innerHTML = [...current.alertFilters].map(key => {
      const label = ALERT_FILTERS[key];
      return `<button type="button" data-clear="${key}" aria-label="Remove ${label} filter">${label}<span aria-hidden="true">×</span></button>`;
    }).join('');
    current.alertPage = 1;
    renderAlerts();
  };
  $('#exception-create').addEventListener('click', () => openCreateShipment(ctx, current.reloadSoon));
  $('#alerts').addEventListener('click', event => {
    const button = event.target.closest('[data-no]');
    if (button) openShipment(button.dataset.no, ctx, current.reloadSoon);
  });
  search.addEventListener('input', () => {
    current.alertSearch = search.value.trim().toLowerCase();
    current.alertPage = 1;
    renderAlerts();
  });
  sortChoice.addEventListener('change', () => {
    current.alertSort = sortChoice.value;
    current.alertDescending = sortChoice.value === 'updated';
    applySort();
  });
  sortOrder.addEventListener('click', () => {
    current.alertDescending = !current.alertDescending;
    applySort();
  });
  $('#exception-page-size').addEventListener('change', event => {
    current.alertPageSize = Number(event.target.value);
    current.alertPage = 1;
    renderAlerts();
  });
  for (const [selector, step] of [['#exception-prev', -1], ['#exception-next', 1]]) {
    $(selector).addEventListener('click', () => {
      current.alertPage += step;
      renderAlerts();
    });
  }
  $('#exception-pages').addEventListener('click', event => {
    const button = event.target.closest('[data-page]');
    if (!button) return;
    current.alertPage = Number(button.dataset.page);
    renderAlerts();
  });
  filterChoice.addEventListener('change', () => {
    if (!Object.hasOwn(ALERT_FILTERS, filterChoice.value)) return;
    current.alertFilters.add(filterChoice.value);
    refreshFilters();
  });
  chips.addEventListener('click', event => {
    const button = event.target.closest('[data-clear]');
    if (!button) return;
    current.alertFilters.delete(button.dataset.clear);
    refreshFilters();
    $('#exception-filter-menu summary').focus();
  });
  $('#exception-columns').addEventListener('change', event => {
    const input = event.target.closest('input[data-column]');
    if (!input) return;
    if (input.checked) current.hiddenAlertColumns.delete(input.dataset.column);
    else current.hiddenAlertColumns.add(input.dataset.column);
    renderAlerts();
  });
  $('#exception-density').addEventListener('click', event => {
    const compact = panel.classList.toggle('is-compact');
    event.currentTarget.setAttribute('aria-pressed', String(compact));
    event.currentTarget.querySelector('span').textContent = compact ? 'Compact' : 'Comfortable';
  });
  const menus = panel.querySelectorAll('.exception-menu');
  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (menu.open) menus.forEach(other => { if (other !== menu) other.open = false; });
    });
    menu.addEventListener('focusout', event => {
      if (event.relatedTarget && !menu.contains(event.relatedTarget)) menu.open = false;
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary').focus();
      }
    });
  }
}

export default {
  title: 'Overview',

  async mount(root, ctx, params) {
    const current = {
      ctx, originId: Number(params.get('originId')) || null,
      requestedTripId: Number(params.get('tripId')) || null, scope: 'active', timers: [],
      history: [], activeTrips: [], arrivals: [],
      alertFilters: new Set(), alertSearch: '', alertSort: 'id', alertDescending: false, alertPage: 1, alertPageSize: 10,
      hiddenAlertColumns: new Set(),
      vehiclesByPlate: new Map(), dashboardVersion: 0, tripVersion: 0, fleetVersion: 0
    };
    state = current;
    root.innerHTML = `<div class="network-overview">
      <div id="degraded" class="degraded" role="status"></div>
      <section class="overview-stage" aria-label="Freight operations overview">
        <div class="map" id="map"></div>
        <div class="overview-stage-content">
          <div class="overview-map-region">
            <div class="overview-map-space"></div>
            <aside class="map-data-panel overview-map-panel" aria-labelledby="direction-title">
              <header><h3 id="direction-title">Shipment directions</h3></header>
              <div class="direction-filters">
                <select id="origin-filter" aria-label="Origin hub">${hubOptions(ctx.hubs.map(h => ({ ...h, name: hubName(h) })), current.originId, 'All hubs')}</select>
                <div class="direction-scope" id="scope" role="group" aria-label="Shipment scope"><button type="button" data-scope="active" aria-pressed="true">Active</button><button type="button" data-scope="all" aria-pressed="false">History</button></div>
              </div>
              <div id="directions"><p class="overview-empty">Loading directions…</p></div>
              <small class="overview-map-credit"><a href="https://cloudless.eox.at/" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH (modified Copernicus Sentinel data 2016 &amp; 2017)<br><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></small>
            </aside>
          </div>
          <div class="overview-controls">
            <section class="overview-exceptions is-compact" aria-labelledby="exceptions-title">
              <header class="overview-section-header">
                <div class="exception-heading"><h2 id="exceptions-title">Pending Items</h2><button type="button" class="exception-new" id="exception-create">+ New shipment</button></div>
                <a class="exception-all" href="#/shipments">View shipments <span aria-hidden="true">↗</span></a>
              </header>
              <div class="exception-toolbar">
                <label class="overview-search"><span>${ALERT_ICONS.search}</span><input type="search" id="exception-search" placeholder="Search shipments" aria-label="Search pending shipments"></label>
                <div class="exception-toolbar-actions">
                  <div id="exception-active" class="exception-active"></div>
                  <div class="exception-sort">
                    <label>Sort by:
                    <select id="exception-sort">
                      <option value="id">ID</option>
                      <option value="priority">Priority</option>
                      <option value="updated">Last modified</option>
                      <option value="due">Due date</option>
                    </select>
                    </label>
                    <button type="button" id="exception-sort-order" aria-label="Reverse sort order" aria-pressed="false">Ascending</button>
                  </div>
                  <details class="exception-menu" id="exception-filter-menu">
                    <summary>${ALERT_ICONS.filter} Filters</summary>
                    <div class="exception-menu-body">
                      <label class="exception-filter-label">Add filter
                        <select id="exception-filter-choice">
                          <option value="" disabled selected>Choose a filter</option>
                          ${Object.entries(ALERT_FILTER_GROUPS).map(([group, choices]) => `<optgroup label="${group}">${Object.entries(choices).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</optgroup>`).join('')}
                        </select>
                      </label>
                    </div>
                  </details>
                  <details class="exception-menu" id="exception-columns">
                    <summary>${ALERT_ICONS.columns} Manage columns</summary>
                    <div class="exception-menu-body">
                      ${EXCEPTION_COLUMNS.filter(([key]) => !['id', 'action'].includes(key)).map(([key, label]) => `<label><input type="checkbox" data-column="${key}" checked> ${label}</label>`).join('')}
                    </div>
                  </details>
                  <button type="button" class="exception-density" id="exception-density" aria-pressed="true" aria-label="Compact rows">${ALERT_ICONS.density} <span>Compact</span></button>
                </div>
              </div>
              <div id="alerts"><p class="overview-empty">Loading exceptions…</p></div>
              <nav id="exception-pagination" class="exception-pagination" aria-label="Pending shipments pages" hidden>
                <span id="exception-row-count"></span>
                <div class="exception-page-controls">
                  <button type="button" id="exception-prev" aria-label="Previous page">‹</button>
                  <div id="exception-pages" class="exception-pages" aria-label="Page numbers"></div>
                  <button type="button" id="exception-next" aria-label="Next page">›</button>
                </div>
                <select id="exception-page-size" aria-label="Items per page">
                  <option value="10">10 / page</option>
                  <option value="5">5 / page</option>
                  <option value="8">8 / page</option>
                </select>
              </nav>
            </section>
            <div class="overview-workspace">
              <div class="overview-analysis">
                <section class="overview-exception-summary" aria-labelledby="exception-stats-title">
                  <header class="overview-section-header"><h2 id="exception-stats-title">Exception Overview</h2></header>
                  <div id="exception-stats"><p class="overview-empty">Loading totals…</p></div>
                  <nav class="exception-links" aria-label="Shipment lists">
                    <a href="#/shipments?status=EXCEPTION">All exceptions ↗</a>
                    <a href="#/shipments?late=true">All overdue ↗</a>
                  </nav>
                </section>
                <section class="overview-route-summary" aria-labelledby="insight-title">
                  <header class="overview-section-header"><h2 id="insight-title">Top routes</h2><span>By shipments</span></header>
                  <div id="lanes"><p class="overview-empty">Loading routes…</p></div>
                </section>
              </div>
              <section class="overview-tracking" aria-labelledby="tracking-title">
                <header class="overview-section-header"><h2 id="tracking-title">Live Tracking</h2></header>
                <div id="tracking-cards" class="tracking-list"><p class="overview-empty">Loading trips…</p></div>
              </section>
              <section class="overview-metrics" aria-labelledby="metrics-title">
                <header class="overview-section-header"><h2 id="metrics-title">Operations metrics</h2></header>
                <div class="overview-kpis" id="kpis"></div>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>`;

    current.reloadSoon = throttle(() => { if (state === current) loadDashboard(current).catch(() => {}); }, 1200);
    current.tripsSoon = throttle(() => loadTrips(current).catch(() => {}), 1000);
    current.vehiclesSoon = throttle(() => { if (state === current) loadVehicles(current); }, 2000);
    current.map = new FreightMap($('#map'), ctx, {
      getViewport: () => {
        const space = $('.overview-map-space');
        const panel = $('.overview-map-panel');
        return {
          height: space.clientHeight,
          rightInset: getComputedStyle(panel).position === 'absolute' ? panel.offsetWidth + 32 : 0
        };
      },
      onHubClick: h => setOrigin(current, current.originId === h.id ? null : h.id, true)
    });
    current.map.setHubs(ctx.hubs, current.originId);
    $('#origin-filter').addEventListener('change', event => setOrigin(current, Number(event.target.value)));
    $('#scope').addEventListener('click', event => {
      const button = event.target.closest('button[data-scope]');
      if (!button || button.dataset.scope === current.scope) return;
      current.scope = button.dataset.scope;
      $('#scope').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      current.reloadSoon();
    });
    wirePendingTable(current, ctx);
    $('#tracking-cards').addEventListener('click', event => {
      const button = event.target.closest('button[data-trip-id]');
      if (!button) return;
      const trip = [...current.activeTrips, ...current.arrivals].find(item => String(item.id) === button.dataset.tripId);
      if (!trip) return;
      current.focusedTripId = trip.id;
      current.map.focusTrip(trip);
      $('.overview-stage').scrollIntoView({ block: 'start' });
      renderTracking();
    });
    await Promise.all([loadDashboard(current), loadTrips(current), loadHistory(current), loadVehicles(current)]);
    if (state !== current) return;
    current.timers.push(setInterval(current.reloadSoon, 8000));
    current.timers.push(setInterval(current.tripsSoon, 12000));
    current.timers.push(setInterval(() => loadHistory(current), 60000));
    current.timers.push(setInterval(async () => {
      try {
        await ctx.refreshHubs();
        if (state !== current) return;
        current.map.setHubs(ctx.hubs, current.originId);
        $('#origin-filter').innerHTML = hubOptions(ctx.hubs.map(h => ({ ...h, name: hubName(h) })), current.originId, 'All hubs');
      } catch { }
    }, 20000));
  },

  unmount() {
    if (!state) return;
    state.timers.forEach(clearInterval);
    state.map?.destroy();
    state = null;
  },

  onEvent(evt) {
    if (!state?.map) return;
    state.reloadSoon();
    if (['trip', 'dispatch', 'clock'].includes(evt.type)) state.tripsSoon();
    if (evt.type === 'fleet') state.vehiclesSoon();
  }
};
