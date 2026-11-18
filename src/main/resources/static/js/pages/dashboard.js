import { get, query } from '../api.js';
import { FreightMap } from '../map.js';
import { EXCEPTION_REASONS, hubName, SHIPMENT_STATES } from '../overview-labels.js';
import { $, esc, fmtHM, fmtKg, fmtMoney, fmtNum, fmtPct, fmtTime, hubOptions, throttle, VEHICLE_SVG } from '../ui.js';
import { openShipment } from './shipments.js';

const DIR_COLORS = { N: '#427d6e', NE: '#70a898', E: '#a7b99b', SE: '#e7ad70', S: '#cc724c', SW: '#a784ad', W: '#617e9c', NW: '#405d75' };
const DIRECTION_NAMES = { N: 'North', NE: 'Northeast', E: 'East', SE: 'Southeast', S: 'South', SW: 'Southwest', W: 'West', NW: 'Northwest' };
const STAGES = ['Loading', 'In transit', 'Arrived'];
const LOCATION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/></svg>';
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
  if (!directions) {
    $('#directions').innerHTML = '<p class="overview-empty">Direction data is unavailable.</p>';
    return;
  }
  const ordered = [...directions].sort((a, b) => b.count - a.count);
  const total = ordered.reduce((sum, d) => sum + d.count, 0);
  let cursor = 0;
  const segments = ordered.filter(d => d.count > 0).map(d => {
    const start = cursor;
    cursor += d.count / total * 100;
    return `${DIR_COLORS[d.direction]} ${start}% ${cursor}%`;
  });
  const gradient = segments.length ? `conic-gradient(${segments.join(',')})` : '#e4ebe7';
  $('#directions').innerHTML = `<div class="direction-chart">
    <div class="direction-donut" style="--chart:${gradient}" role="img" aria-label="${fmtNum(total)} shipments">
      <div><strong>${fmtNum(total)}</strong><small>Shipments</small></div>
    </div>
    <ul class="direction-key">${ordered.map(d => `<li><a href="${shipmentHref({ direction: d.direction, originId: state.originId })}" title="${fmtKg(d.weightKg)}">
      <i style="--key-color:${DIR_COLORS[d.direction]}"></i><span title="${DIRECTION_NAMES[d.direction]}">${d.direction}</span><b>${fmtNum(d.count)}</b>
    </a></li>`).join('')}</ul>
  </div>`;
}

function renderLanes(lanes) {
  const rows = (lanes ?? []).map(lane => ({
    ...lane, origin: state.ctx.hubsById.get(lane.originId), destination: state.ctx.hubsById.get(lane.destinationId)
  })).filter(lane => lane.origin && lane.destination).slice(0, 3);
  const max = Math.max(1, ...rows.map(row => row.count));
  $('#lanes').innerHTML = rows.length ? rows.map((row, i) => {
    const ratio = Math.round(row.count / max * 100);
    return `<a class="insight-lane" href="${shipmentHref({ originId: row.originId, destinationId: row.destinationId })}" style="--lane-color:${['#216756', '#526d9e', '#a0512d'][i]}">
      <span class="insight-route"><strong>${esc(row.origin.code)} <span aria-hidden="true">→</span> ${esc(row.destination.code)}</strong><small>${DIRECTION_NAMES[row.direction]}</small></span>
      <span class="insight-segments" aria-hidden="true" style="--level:${ratio}%"></span>
      <span class="insight-detail"><b>${fmtNum(row.count)} shipments</b><span>${fmtKg(row.weightKg)}</span></span>
    </a>`;
  }).join('') : '<p class="overview-empty">No routes in this view.</p>';
}

const ALERT_ICONS = {
  review: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12s2.8-5 8-5 8 5 8 5-2.8 5-8 5-8-5-8-5Z"/><circle cx="12" cy="12" r="2"/></svg>',
  exception: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 6.5v7m0 4v.2"/></svg>',
  overdue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="7.5"/><path d="M12 8v4.2l2.6 1.6"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>'
};
const EXCEPTION_COLUMNS = [
  ['id', 'ID'], ['vehicle', 'Vehicle info'], ['driver', 'Assigned drivers'], ['status', 'Status'],
  ['location', 'Location'], ['capacity', 'Capacity'], ['features', 'Features'], ['service', 'Next service'],
  ['fuel', 'Fuel score'], ['action', 'Actions']
];
const VEHICLE_NAMES = { VAN: 'Van', LORRY: 'Lorry', TRAILER: 'Trailer', AIR_CARGO: 'Cargo aircraft' };
const PRIORITY_NAMES = { STANDARD: 'Standard', EXPRESS: 'Express' };

function pendingRow(shipment, vehicle, late) {
  const x = shipment;
  const exception = x.status === 'EXCEPTION';
  const reason = EXCEPTION_REASONS[x.exceptionReason] ?? x.exceptionReason;
  const type = VEHICLE_NAMES[vehicle?.type];
  const name = vehicle?.driverName?.trim();
  const initials = name?.split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase();
  const location = x.currentHub ? hubName(x.currentHub) : '—';
  const status = exception ? 'Exception' : SHIPMENT_STATES[x.status] ?? x.status;
  return `<tr class="exception-row">
    <th scope="row" class="ex-id">${esc(x.trackingNo)}</th>
    <td class="ex-vehicle">
      ${type ? `<span class="exception-vehicle-type">${esc(type)}</span> ` : ''}
      ${x.plateNo ? `<span class="exception-value">${esc(x.plateNo)}</span>` : '<span class="exception-missing">Unassigned</span>'}
    </td>
    <td class="ex-driver">${name ? `<span class="exception-driver" title="${esc(name)}"><span aria-hidden="true" class="exception-initials">${esc(initials)}</span><span class="exception-text">${esc(name)}</span></span>` : '<span class="exception-missing">—</span>'}</td>
    <td class="ex-status" title="${esc(reason || status)}">
      <span class="exception-tag${exception ? ' is-exception' : ''}">${esc(status)}</span>
      ${late ? '<span class="exception-tag is-late">Overdue</span>' : ''}
    </td>
    <td class="ex-location" title="${esc(location)}"><span class="exception-location">${esc(location)}</span>
      ${x.currentHub ? `<span class="exception-value">${esc(x.currentHub.code)}</span>` : ''}
    </td>
    <td class="ex-capacity">${vehicle?.capacityKg != null ? fmtKg(vehicle.capacityKg) : '<span class="exception-missing">—</span>'}</td>
    <td class="ex-features">
      ${x.priority ? `<span class="exception-feature">${esc(PRIORITY_NAMES[x.priority] ?? x.priority)}</span>` : ''}
      ${vehicle ? `<span class="exception-feature">${vehicle.type === 'AIR_CARGO' ? 'Air' : 'Road'}</span>` : ''}
    </td>
    <td class="ex-service"><span class="exception-missing" title="Service schedule unavailable">—</span></td>
    <td class="ex-fuel"><span class="exception-missing" title="Fuel score unavailable">—</span></td>
    <td class="ex-action"><button type="button" class="exception-action" data-no="${esc(x.trackingNo)}" aria-label="Review shipment ${esc(x.trackingNo)}" title="Review shipment">${ALERT_ICONS.review}</button></td>
  </tr>`;
}

function renderAlerts() {
  const { alerts, alertFilter, alertSearch, vehiclesByPlate } = state;
  const root = $('#alerts');
  const statRoot = $('#exception-stats');
  const pager = $('#exception-pagination');
  if (!alerts) {
    state.alertMarkup = null;
    root.innerHTML = '<p class="overview-empty">Exception data is unavailable.</p>';
    statRoot.innerHTML = '<p class="overview-empty">Totals are unavailable.</p>';
    pager.hidden = true;
    return;
  }
  const total = Math.max(1, alerts.exceptions + alerts.late);
  statRoot.innerHTML = `<div class="exception-stat-row">${[['Exceptions', alerts.exceptions, 'rose', 'exception'], ['Overdue', alerts.late, 'amber', 'overdue']].map(([label, count, tone, icon]) =>
    `<div class="exception-stat tone-${tone}"><span class="exception-stat-icon">${ALERT_ICONS[icon]}</span><strong>${fmtNum(count)}</strong><span class="exception-stat-label">${label}</span></div>`).join('')}</div>
    <div class="exception-stat-bar" role="img" aria-label="${fmtNum(alerts.exceptions)} exceptions and ${fmtNum(alerts.late)} overdue. A shipment may count in both.">
      <i class="tone-rose" style="flex:${alerts.exceptions / total}"></i><i class="tone-amber" style="flex:${alerts.late / total}"></i>
    </div>`;
  const unique = new Map();
  const exceptions = alerts.latestExceptions;
  const overdue = alerts.topLate;
  const overdueIds = new Set(alerts.topLate.map(shipment => shipment.trackingNo));
  for (const shipment of [...exceptions.slice(0, 4), ...overdue.slice(0, 4), ...exceptions.slice(4), ...overdue.slice(4)]) {
    if (!unique.has(shipment.trackingNo)) unique.set(shipment.trackingNo, shipment);
  }
  const matches = [...unique.values()].filter(x => {
    if (alertFilter === 'exception' && x.status !== 'EXCEPTION') return false;
    if (alertFilter === 'overdue' && !x.late && !overdueIds.has(x.trackingNo)) return false;
    const reason = EXCEPTION_REASONS[x.exceptionReason] ?? x.exceptionReason;
    const vehicle = vehiclesByPlate.get(x.plateNo);
    return [x.trackingNo, x.origin.code, x.destination.code, x.currentHub?.code, x.currentHub?.name,
      x.plateNo, vehicle?.driverName, VEHICLE_NAMES[vehicle?.type], reason].some(value =>
      String(value ?? '').toLowerCase().includes(alertSearch));
  });
  if (state.alertSort === 'id') {
    matches.sort((a, b) => a.trackingNo.localeCompare(b.trackingNo));
  } else if (state.alertSort === 'updated') {
    matches.sort((a, b) => Date.parse(b.statusChangedAt) - Date.parse(a.statusChangedAt));
  } else if (state.alertSort === 'due') {
    const date = shipment => Date.parse(shipment.promisedBy) || Infinity;
    matches.sort((a, b) => date(a) - date(b));
  }
  const pages = Math.max(1, Math.ceil(matches.length / state.alertPageSize));
  state.alertPage = Math.min(state.alertPage, pages);
  const start = (state.alertPage - 1) * state.alertPageSize;
  const rows = matches.slice(start, start + state.alertPageSize);
  pager.hidden = !matches.length;
  $('#exception-row-count').textContent = `${matches.length} recent ${matches.length === 1 ? 'item' : 'items'}`;
  $('#exception-page-label').textContent = `${state.alertPage} / ${pages}`;
  $('#exception-prev').disabled = state.alertPage === 1;
  $('#exception-next').disabled = state.alertPage === pages;
  const table = rows.length ? `<div class="exception-table-scroll" role="region" aria-label="Pending shipments table" tabindex="0"><table class="exception-table">
    <thead><tr>${EXCEPTION_COLUMNS.map(([key, name]) => `<th scope="col" class="ex-${key}">${name}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(x => pendingRow(x, vehiclesByPlate.get(x.plateNo), x.late || overdueIds.has(x.trackingNo))).join('')}</tbody>
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

function stageOf(trip) {
  return trip.status === 'ARRIVED' ? 2 : trip.status === 'IN_TRANSIT' ? 1 : 0;
}

function tripProgress(trip, now) {
  const stage = stageOf(trip);
  if (stage === 2) return 100;
  if (stage === 0) return 0;
  const depart = Date.parse(trip.departAt);
  const duration = Date.parse(trip.arriveAt) - depart;
  return duration > 0 ? Math.round(Math.max(0, Math.min(1, (now - depart) / duration)) * 100) : 0;
}

function tripCard(trip, now, highlighted) {
  const stage = stageOf(trip);
  const progress = tripProgress(trip, now);
  const air = trip.vehicleType === 'AIR_CARGO';
  return `<article class="tracking-card${highlighted ? ' is-highlighted' : ''}">
    <header class="tracking-card-head">
      <div class="tracking-meta">
        <span class="tracking-mode" aria-hidden="true">${air ? VEHICLE_SVG.air : VEHICLE_SVG.road}</span>
        <div><h3>${esc(trip.code)}</h3><small>${esc(trip.plateNo)} · ${trip.relocation ? 'Empty relocation' : `${fmtNum(trip.shipmentCount)} shipments`}</small></div>
      </div>
      <span class="tracking-state stage-${stage}${trip.delayReason ? ' is-delayed' : ''}">${trip.delayReason ? 'Delayed' : STAGES[stage]}</span>
    </header>
    <div class="tracking-stops">
      <div class="tracking-stop"><strong>${esc(trip.origin.code)}</strong><small>${esc(hubName(trip.origin))}</small><time datetime="${esc(trip.departAt)}">${stage === 0 ? 'ETD ' : ''}${fmtTime(trip.departAt)}</time></div>
      <div class="tracking-stop tracking-end"><strong>${esc(trip.destination.code)}</strong><small>${esc(hubName(trip.destination))}</small><time datetime="${esc(trip.arrivedAt || trip.arriveAt)}">${stage === 2 ? '' : 'ETA '}${fmtTime(trip.arrivedAt || trip.arriveAt)}</time></div>
    </div>
    <div class="tracking-journey">
      <span class="tracking-origin" aria-hidden="true">${ICONS[0]}</span>
      <div class="tracking-progress" role="progressbar" aria-label="${esc(trip.code)} trip progress" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100" style="--progress:${progress}%">
        <i class="tracking-fill" aria-hidden="true"></i>
        <span class="tracking-vehicle" aria-hidden="true">${air ? VEHICLE_SVG.air : '<img src="/img/freight-truck.png" width="44" height="22" alt="">'}</span>
      </div>
      <button type="button" class="tracking-locate" data-trip-id="${esc(trip.id)}" aria-label="Show trip ${esc(trip.code)} on the map" title="Show on map">${LOCATION}</button>
    </div>
    <small class="tracking-distance">${fmtNum(trip.distanceKm)} km · ${progress}% complete</small>
  </article>`;
}

function renderTracking() {
  const { activeTrips, arrivals, ctx } = state;
  const ordered = [...activeTrips].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const completed = new Set(arrivals.map(trip => trip.id));
  const active = ordered.filter(trip => !completed.has(trip.id));
  const featured = [active.find(t => t.status === 'LOADING'), active.find(t => t.status === 'IN_TRANSIT'), arrivals[0]].filter(Boolean);
  const featuredIds = new Set(featured.map(t => t.id));
  const all = [...featured, ...[...active, ...arrivals].filter(trip => !featuredIds.has(trip.id))];
  const rolling = state.trackingSearch ? all.filter(trip =>
    [trip.code, trip.plateNo, trip.origin.code, trip.destination.code, hubName(trip.origin), hubName(trip.destination)]
      .some(value => String(value ?? '').toLowerCase().includes(state.trackingSearch))
  ) : all.slice(0, 6);
  $('#trip-count').textContent = `${active.filter(t => t.status === 'IN_TRANSIT').length} in transit · ${active.filter(t => t.status === 'LOADING').length} loading`;
  const highlighted = rolling.find(trip => trip.id === state.focusedTripId) ?? rolling.find(trip => trip.status === 'IN_TRANSIT');
  const cards = $('#tracking-cards');
  const now = ctx.simNow();
  const markup = rolling.length ? rolling.map(trip => tripCard(trip, now, trip.id === highlighted?.id)).join('')
    : `<p class="overview-empty">${state.trackingSearch ? 'No trips match your search.' : 'No trips to display.'}</p>`;
  if (markup === state.trackingMarkup) return;
  const focusedTrip = cards.contains(document.activeElement) ? document.activeElement.dataset.tripId : null;
  state.trackingMarkup = markup;
  cards.innerHTML = markup;
  if (focusedTrip) cards.querySelector(`[data-trip-id="${CSS.escape(focusedTrip)}"]`)?.focus({ preventScroll: true });
}

function eventLabel({ type, data = {} }) {
  if (data.trackingNo) return `${data.trackingNo} · ${SHIPMENT_STATES[data.status] ?? 'Shipment updated'}`;
  if (data.tripCode) {
    const labels = { created: 'Trip scheduled', departed: 'Departed', arrived: 'Arrived', delayed: 'Delayed' };
    return `${data.tripCode} · ${labels[data.event] ?? 'Trip updated'}`;
  }
  if (type === 'dispatch') return `Dispatch run · ${fmtNum(data.trips)} trips · ${fmtNum(data.shipments)} shipments`;
  if (data.plateNo) return `${data.plateNo} · Fleet updated`;
  return { alert: 'Delivery alert', clock: 'Simulation settings updated', fleet: 'Fleet updated' }[type] ?? 'System update';
}

function renderFeed() {
  $('#feed').innerHTML = state.ctx.feed.length ? state.ctx.feed.slice(0, 20).map(evt =>
    `<li><time>${fmtHM(evt.at)}</time><span title="${esc(evt.message)}">${esc(eventLabel(evt))}</span></li>`).join('') : '<li>No recent events.</li>';
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

export default {
  title: 'Overview',

  async mount(root, ctx, params) {
    const current = {
      ctx, originId: Number(params.get('originId')) || null, scope: 'active', timers: [],
      history: [], activeTrips: [], arrivals: [], trackingSearch: '',
      alertFilter: 'all', alertSearch: '', alertSort: 'id', alertPage: 1, alertPageSize: 10,
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
              <small class="overview-map-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a></small>
            </aside>
          </div>
          <div class="overview-controls">
            <section class="overview-exceptions" aria-labelledby="exceptions-title">
              <header class="overview-section-header">
                <h2 id="exceptions-title">Pending Items</h2>
              </header>
              <div class="exception-toolbar">
                <label class="overview-search"><span>${ALERT_ICONS.search}</span><input type="search" id="exception-search" placeholder="Search shipments" aria-label="Search pending shipments"></label>
                <div class="exception-toolbar-actions">
                  <div id="exception-filters" class="exception-filters" role="group" aria-label="Filter pending shipments">
                    <button type="button" data-filter="all" aria-pressed="true">All items</button>
                    <button type="button" data-filter="exception" aria-pressed="false">Exception</button>
                    <button type="button" data-filter="overdue" aria-pressed="false">Overdue</button>
                  </div>
                  <label class="exception-sort">Sort by
                    <select id="exception-sort">
                      <option value="id">ID</option>
                      <option value="priority">Priority</option>
                      <option value="updated">Last modified</option>
                      <option value="due">Earliest due</option>
                    </select>
                  </label>
                </div>
              </div>
              <div id="alerts"><p class="overview-empty">Loading exceptions…</p></div>
              <nav id="exception-pagination" class="exception-pagination" aria-label="Pending shipments pages" hidden>
                <span id="exception-row-count"></span>
                <div class="exception-page-controls">
                  <button type="button" id="exception-prev" aria-label="Previous page">‹</button>
                  <span id="exception-page-label" aria-live="polite"></span>
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
              <div class="overview-workspace-side">
                <section class="overview-exception-summary" aria-labelledby="exception-stats-title">
                  <header class="overview-section-header"><h2 id="exception-stats-title">Exception Overview</h2></header>
                  <div id="exception-stats"></div>
                  <nav class="exception-links" aria-label="Shipment lists">
                    <a href="#/shipments?status=EXCEPTION">All exceptions ↗</a>
                    <a href="#/shipments?late=true">All overdue ↗</a>
                  </nav>
                </section>
                <section class="map-data-panel overview-route-summary" aria-labelledby="insight-title">
                  <header><h3 id="insight-title">Top routes</h3><span>By shipments</span></header>
                  <div id="lanes"><p class="overview-empty">Loading routes…</p></div>
                </section>
              </div>
              <section class="overview-tracking" aria-labelledby="tracking-title">
                <header class="overview-section-header"><div><h2 id="tracking-title">Live Tracking</h2><span id="trip-count"></span></div><span class="tracking-live"><i></i> Live trips</span></header>
                <label class="overview-search tracking-search"><span>${ALERT_ICONS.search}</span><input type="search" id="tracking-search" placeholder="Search trips, plates or hubs" aria-label="Search trips"></label>
                <div id="tracking-cards" class="tracking-list"><p class="overview-empty">Loading trips…</p></div>
                <details class="tracking-events"><summary>System events</summary><ul id="feed"></ul></details>
              </section>
            </div>
            <section class="overview-metrics" aria-labelledby="metrics-title">
              <header class="overview-section-header"><h2 id="metrics-title">Operations metrics</h2></header>
              <div class="overview-kpis" id="kpis"></div>
            </section>
          </div>
        </div>
      </section>
    </div>`;

    current.reloadSoon = throttle(() => { if (state === current) loadDashboard(current).catch(() => {}); }, 1200);
    current.tripsSoon = throttle(() => loadTrips(current).catch(() => {}), 1000);
    current.vehiclesSoon = throttle(() => { if (state === current) loadVehicles(current); }, 2000);
    current.map = new FreightMap($('#map'), ctx, {
      overview: true,
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
    $('#alerts').addEventListener('click', event => {
      const button = event.target.closest('[data-no]');
      if (button) openShipment(button.dataset.no, ctx, current.reloadSoon);
    });
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
    $('#exception-search').addEventListener('input', event => {
      current.alertSearch = event.target.value.trim().toLowerCase();
      current.alertPage = 1;
      renderAlerts();
    });
    $('#tracking-search').addEventListener('input', event => {
      current.trackingSearch = event.target.value.trim().toLowerCase();
      $('#tracking-cards').scrollTop = 0;
      renderTracking();
    });
    $('#exception-sort').addEventListener('change', event => {
      current.alertSort = event.target.value;
      current.alertPage = 1;
      renderAlerts();
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
    $('#exception-filters').addEventListener('click', event => {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;
      current.alertFilter = button.dataset.filter;
      current.alertPage = 1;
      $('#exception-filters').querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      renderAlerts();
    });
    renderFeed();
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
    renderFeed();
    state.reloadSoon();
    if (['trip', 'dispatch', 'clock'].includes(evt.type)) state.tripsSoon();
    if (evt.type === 'fleet') state.vehiclesSoon();
  }
};
