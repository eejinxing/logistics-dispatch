import { get, post } from '../api.js';
import { DispatchMap } from '../dispatch-map.js';
import {
  $, badge, throttle, esc, fmtDuration, fmtHM, fmtKg, fmtNum, fmtTime, hubOptions, lane, toast
} from '../ui.js';
import { openShipment } from './shipments.js';

let s = null;

const laneKey = (l) => `${l.origin.id}>${l.destination.id}`;
const itemKey = (item) => item.status ? String(item.id) : laneKey(item);
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></svg>';

function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadAll(current = s) {
  if (!current || s !== current) return;
  const version = ++current.version;
  const [lanes, vehicles, trips] = await Promise.all([get('/api/dispatch/lanes'), get('/api/vehicles'), get('/api/trips')]);
  if (s !== current || version !== current.version) return;
  Object.assign(current, { lanes, vehicles, trips });
  renderWorkspace(current);
}

function pickSignature() {
  const l = s.lanes.find((x) => laneKey(x) === s.selected);
  if (!l) return 'none';
  const ids = l.shipments.map((x) => x.id).join(',');
  const fleet = s.vehicles.map(v => `${v.id}:${v.status}:${v.hub.id}`).join(',');
  return `${s.selected}|${ids}|${fleet}`;
}

function matchingItems(current) {
  const hub = $('#dispatch-hub').value;
  const term = $('#dispatch-search').value.trim().toLowerCase();
  const items = current.view === 'waiting' ? current.lanes : current.trips;
  return items.filter(item => {
    const name = `${item.origin.code} ${item.origin.name} ${item.destination.code} ${item.destination.name} ${item.directionLabel} ${item.code ?? ''} ${item.plateNo ?? ''}`;
    return (!hub || String(item.origin.id) === hub) && (!term || name.toLowerCase().includes(term));
  });
}

function itemStatus(item) {
  const label = item.status ? item.statusLabel : item.overdue ? 'Ready to dispatch' : 'Queued';
  const highlighted = item.status === 'IN_TRANSIT' || item.overdue;
  return `<span class="dispatch-status${highlighted ? ' is-highlighted' : ''}">${esc(label)}</span>`;
}

function rowContent(item) {
  const route = lane(item.origin, item.destination);
  if (item.status) {
    return `<span class="dispatch-row-top"><strong>${esc(item.code)}</strong>${itemStatus(item)}</span>
      <span class="dispatch-row-caption">${route}<span>${esc(item.plateNo)}</span></span>
      <span class="dispatch-row-meta"><span>ETA ${fmtTime(item.arriveAt)}</span><span>${item.relocation ? 'Empty relocation' : fmtKg(item.loadKg)}</span></span>`;
  }
  return `<span class="dispatch-row-top"><strong>${route}</strong>${itemStatus(item)}</span>
    <span class="dispatch-row-caption">${esc(item.origin.name)} → ${esc(item.destination.name)}</span>
    <span class="dispatch-row-meta"><span>${fmtNum(item.count)} ${item.count === 1 ? 'shipment' : 'shipments'} · ${fmtKg(item.totalKg)}</span>
      <span>${item.air ? 'Air freight' : esc(item.directionLabel)}</span></span>`;
}

function renderList(current, items) {
  const list = $('#lane-list');
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  $('#lane-sum').textContent = current.view === 'waiting'
    ? `${fmtNum(items.length)} routes · ${fmtNum(items.reduce((total, item) => total + item.count, 0))} shipments`
    : `${fmtNum(items.filter(item => item.status === 'IN_TRANSIT').length)} in transit · ${fmtNum(items.filter(item => item.status === 'LOADING').length)} loading`;
  if (!items.length) {
    list.innerHTML = `<p class="empty">${current.view === 'waiting' ? 'No waiting routes match these filters.' : 'No active trips match these filters.'}</p>`;
    if (focused) $('#dispatch-search').focus();
    return;
  }
  $('.empty', list)?.remove();
  const keys = new Set(items.map(itemKey));
  for (const card of [...list.children]) if (!keys.has(card.dataset.key)) card.remove();
  const existing = new Map([...list.children].map(card => [card.dataset.key, card]));
  let position = list.firstElementChild;
  for (const item of items) {
    const key = itemKey(item);
    const card = existing.get(key) ?? document.createElement('button');
    card.type = 'button';
    card.className = 'dispatch-row';
    card.dataset.key = key;
    card.setAttribute('aria-pressed', String(key === current.selected && !current.detailsClosed));
    card.setAttribute('aria-controls', 'dispatch-detail');
    const markup = rowContent(item);
    if (current.cardMarkup.get(card) !== markup) {
      card.innerHTML = markup;
      current.cardMarkup.set(card, markup);
    }
    if (card !== position) list.insertBefore(card, position);
    position = card.nextElementSibling;
  }
  if (focused && focused !== document.activeElement) (focused.isConnected ? focused : $('#dispatch-search')).focus({ preventScroll: true });
}

function renderWorkspace(current, { focusRoute = false } = {}) {
  const items = matchingItems(current);
  let selected = items.find(item => itemKey(item) === current.selected);
  const routeRemoved = current.manual && !selected && !current.lanes.some(item => laneKey(item) === current.selected);
  if (!selected && !current.detailsClosed && !routeRemoved) {
    selected = items[0];
    current.selected = selected ? itemKey(selected) : null;
    current.manual = false;
    current.checked = null;
    current.vehicleId = null;
  }
  for (const tab of current.root.querySelectorAll('[data-view]')) {
    const waiting = tab.dataset.view === 'waiting';
    tab.setAttribute('aria-pressed', String(tab.dataset.view === current.view));
    $('[data-count]', tab).textContent = fmtNum(waiting ? current.lanes.length : current.trips.length);
  }
  renderList(current, items);
  const displayed = current.detailsClosed ? null : selected ?? (routeRemoved ? current.displayed : null);
  current.displayed = displayed;
  current.map?.setOrigins(items, displayed?.origin.id);
  const routeKey = displayed ? `${current.view}:${itemKey(displayed)}:${laneKey(displayed)}` : '';
  if (routeKey !== current.routeKey) {
    current.routeKey = routeKey;
    current.map?.showRoute(displayed);
  }
  if (focusRoute) current.map?.focusRoute();
  renderDetail(current, displayed, routeRemoved);
  updateProgress();
}

function renderDetail(current, item, routeRemoved = false) {
  const detail = $('#dispatch-detail');
  detail.hidden = !item;
  if (!item) return;
  detail.classList.toggle('is-manual', current.manual);
  $('#dispatch-detail-title').textContent = current.manual ? 'Manual dispatch' : item.status ? item.code : `${item.origin.code} → ${item.destination.code}`;
  const summary = $('#dispatch-summary');
  const pick = $('#pick');
  summary.hidden = current.manual;
  pick.hidden = !current.manual;
  if (current.manual) {
    if (routeRemoved) {
      current.pickSig = 'route-removed';
      pick.innerHTML = '<p class="dispatch-route-note" role="status">This route is no longer awaiting dispatch. Choose another route to continue.</p>';
    } else if (pickSignature() !== current.pickSig) renderPick();
    return;
  }
  const route = `${esc(item.origin.name)} → ${esc(item.destination.name)}`;
  const markup = item.status ? `<p class="dispatch-route-name">${route}</p>
    <dl class="dispatch-facts">
      <div><dt>Status</dt><dd>${esc(item.statusLabel)}</dd></div>
      <div><dt>Vehicle</dt><dd>${esc(item.plateNo)}</dd></div>
      <div><dt>Direction</dt><dd>${esc(item.directionLabel)}</dd></div>
      <div><dt>Load</dt><dd>${item.relocation ? 'Empty relocation' : `${item.shipmentCount} shipments · ${fmtKg(item.loadKg)}`}</dd></div>
      <div><dt>Departure</dt><dd>${fmtTime(item.departAt)}</dd></div>
      <div><dt>ETA</dt><dd>${fmtTime(item.arriveAt)}</dd></div>
    </dl>
    <progress id="dispatch-progress" max="100" value="0" aria-label="Trip progress"></progress>
    <div class="bar-label"><span id="dispatch-trip-pct"></span><span id="dispatch-trip-left"></span></div>
    ${item.delayReason ? `<p class="dispatch-route-note" role="status">Delay · ${esc(item.delayReason)}</p>` : ''}`
    : `<p class="dispatch-route-name">${route}</p>
    <dl class="dispatch-facts">
      <div><dt>Shipments</dt><dd>${fmtNum(item.count)}</dd></div>
      <div><dt>Total weight</dt><dd>${fmtKg(item.totalKg)}</dd></div>
      <div><dt>Direction</dt><dd>${esc(item.directionLabel)}</dd></div>
      <div><dt>Mode</dt><dd>${item.air ? 'Air freight' : 'Road freight'}</dd></div>
      ${item.expressCount ? `<div><dt>Express</dt><dd>${fmtNum(item.expressCount)}</dd></div>` : ''}
      ${item.transferCount ? `<div><dt>Transfers</dt><dd>${fmtNum(item.transferCount)}</dd></div>` : ''}
    </dl>
    <p class="dispatch-route-note" id="dispatch-queue-age"></p>
    <button class="btn primary" type="button" id="show-pick">Assign vehicle</button>`;
  if (markup !== current.summaryMarkup) {
    current.summaryMarkup = markup;
    summary.innerHTML = markup;
  }
}

function renderPick() {
  const current = s;
  const box = $('#pick');
  current.pickSig = pickSignature();
  const l = s.lanes.find((x) => laneKey(x) === s.selected);
  if (!l) return;
  const active = box.contains(document.activeElement) ? document.activeElement : null;
  const focusSelector = active?.id ? `#${active.id}` : active?.matches('input') ? `input[type="${active.type}"][value="${active.value}"]` : null;
  const ids = new Set(l.shipments.map((x) => x.id));
  if (!s.checked) s.checked = new Set(ids);
  for (const id of [...s.checked]) if (!ids.has(id)) s.checked.delete(id);
  const selectedKg = l.shipments.filter((x) => s.checked.has(x.id)).reduce((n, x) => n + x.weightKg, 0);

  const atHub = s.vehicles.filter((v) => v.hub.id === l.origin.id && v.status !== 'ON_TRIP');
  const eligible = (v) => v.status === 'IDLE' && (v.type === 'AIR_CARGO') === l.air;
  if (s.vehicleId && !atHub.some((v) => v.id === s.vehicleId && eligible(v))) s.vehicleId = null;
  const vehicle = atHub.find((v) => v.id === s.vehicleId);
  const over = vehicle && selectedKg > vehicle.capacityKg;

  const vehicleCards = atHub.length
    ? atHub.map((v) => {
      const ok = eligible(v);
      const fill = Math.min(1, selectedKg / v.capacityKg);
      const why = v.status === 'MAINTENANCE' ? 'Under maintenance' : !ok ? (l.air ? 'This route requires a cargo aircraft.' : 'Cargo aircraft serve cross-sea routes.') : '';
      return `<label class="${v.id === s.vehicleId ? 'on' : ''}${ok ? '' : ' disabled'}">
        <input type="radio" name="vehicle" value="${v.id}" ${ok ? '' : 'disabled'} ${v.id === s.vehicleId ? 'checked' : ''}>
        <div><b>${esc(v.plateNo)}</b> <span class="muted">${esc(v.typeLabel)}</span></div>
        <div class="text-2">${esc(v.driverName)}${why ? ` · <span style="color:var(--critical)">${why}</span>` : ''}</div>
        <div class="bar${selectedKg > v.capacityKg ? ' over' : ''}"><span style="width:${(fill * 100).toFixed(1)}%"></span></div>
        <div class="bar-label"><span>Load ${(selectedKg / v.capacityKg * 100).toFixed(0)}%</span><span>Capacity ${fmtNum(v.capacityKg)} kg</span></div>
      </label>`;
    }).join('')
    : '';

  let suggestions = '';
  if (!atHub.some(eligible)) {
    const origin = s.ctx.hubsById.get(l.origin.id);
    const candidates = s.vehicles
      .filter((v) => v.status === 'IDLE' && (v.type === 'AIR_CARGO') === l.air && v.hub.id !== l.origin.id)
      .filter((v) => l.air || s.ctx.hubsById.get(v.hub.id)?.landmass === origin?.landmass)
      .map((v) => ({ v, km: haversine(v.hub, l.origin) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
    suggestions = `<div class="result-box" style="margin-top:10px">No ${l.air ? 'cargo aircraft' : 'road vehicle'} is available at ${esc(l.origin.code)}.
      ${candidates.length ? `Relocate an empty vehicle from a nearby hub:<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">${candidates.map(({ v, km }) => `
        <div style="display:flex;align-items:center;gap:8px"><b>${esc(v.plateNo)}</b><span class="muted">${esc(v.typeLabel)} @ ${esc(v.hub.code)} · About ${fmtNum(km)} km</span>
        <span style="flex:1"></span><button class="btn small" data-relocate="${v.id}" ${current.relocating.has(v.id) ? 'disabled' : ''}>Relocate to ${esc(l.origin.code)}</button></div>`).join('')}</div>` : 'No vehicles are available nearby. Try again shortly.'}</div>`;
  }

  box.innerHTML = `
    <p class="dispatch-route-name">${esc(l.origin.name)} → ${esc(l.destination.name)}</p>
    <div class="section-title dispatch-pick-heading">
      <span>Shipments (selected: ${s.checked.size} / ${l.count} shipments · ${fmtKg(selectedKg)})</span><span style="flex:1"></span>
      <button class="btn small ghost" id="check-all">Select all</button><button class="btn small ghost" id="check-none">Clear selection</button></div>
    <div class="pick-list">${l.shipments.map((x) => `
      <label><input type="checkbox" value="${x.id}" ${s.checked.has(x.id) ? 'checked' : ''}>
        <span><a href="javascript:void 0" class="mono" data-no="${esc(x.trackingNo)}">${esc(x.trackingNo)}</a>
          ${x.priority === 'EXPRESS' ? '<span class="badge express plain">Express</span>' : ''}
          ${x.destination.id !== l.destination.id ? `<span class="badge transfer plain">Transfer → ${esc(x.destination.code)}</span>` : ''}
          <span class="muted">${esc(x.receiverName)}</span></span>
        <span class="num text-2">${fmtKg(x.weightKg)}</span></label>`).join('')}</div>
    <div class="section-title">Vehicles at ${esc(l.origin.code)}</div>
    ${atHub.length ? `<div class="vehicle-pick">${vehicleCards}</div>` : '<div class="muted">No vehicles at this hub</div>'}
    ${suggestions}
    <div style="display:flex;gap:10px;align-items:center;margin-top:14px;flex-wrap:wrap">
      <span class="text-2" style="font-size:13px">${vehicle ? `${esc(vehicle.plateNo)} · Load ${fmtKg(selectedKg)} / ${fmtNum(vehicle.capacityKg)} kg` : 'Select a vehicle'}
        ${over ? '<b style="color:var(--critical)"> · Over capacity</b>' : ''}</span>
      <span style="flex:1"></span>
      <button class="btn primary" id="do-dispatch" ${!vehicle || over || !s.checked.size || current.submitting ? 'disabled' : ''}>Dispatch vehicle</button>
    </div>`;
  if (focusSelector) $(focusSelector, box)?.focus({ preventScroll: true });

  box.querySelectorAll('.pick-list input').forEach((c) => c.addEventListener('change', () => {
    const id = Number(c.value);
    if (c.checked) s.checked.add(id); else s.checked.delete(id);
    renderPick();
  }));
  box.querySelectorAll('[data-no]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openShipment(a.dataset.no, current.ctx, () => loadAll(current));
  }));
  $('#check-all').addEventListener('click', () => { s.checked = new Set(ids); renderPick(); });
  $('#check-none').addEventListener('click', () => { s.checked = new Set(); renderPick(); });
  box.querySelectorAll('.vehicle-pick input:not(:disabled)').forEach(input => input.addEventListener('change', () => {
    s.vehicleId = Number(input.value);
    renderPick();
  }));
  box.querySelectorAll('[data-relocate]').forEach((b) => b.addEventListener('click', async () => {
    const id = Number(b.dataset.relocate);
    if (current.relocating.has(id)) return;
    current.relocating.add(id);
    b.disabled = true;
    try {
      const trip = await post(`/api/vehicles/${id}/relocate`, { hubId: l.origin.id });
      toast(`Empty relocation scheduled for ${trip.plateNo}: ${trip.origin.code} → ${trip.destination.code}, ETA ${fmtHM(trip.arriveAt)}`, 'success');
      await loadAll(current);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      current.relocating.delete(id);
      if (s === current && current.manual && current.selected === laneKey(l)) renderPick();
    }
  }));
  $('#do-dispatch').addEventListener('click', async (e) => {
    if (current.submitting) return;
    current.submitting = true;
    e.target.disabled = true;
    try {
      const trip = await post('/api/dispatch', { vehicleId: current.vehicleId, shipmentIds: [...current.checked] });
      toast(`Trip ${trip.code} created. ${trip.plateNo} has ${trip.shipmentCount} shipments (${fmtKg(trip.loadKg)}), ETD ${fmtHM(trip.departAt)}.`, 'success');
      if (s === current) showDispatchedTrip(current, trip);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      current.submitting = false;
      if (s === current) {
        if (current.manual) renderPick();
        current.reloadSoon();
      }
    }
  });
}

function showDispatchedTrip(current, trip) {
  current.trips = [trip, ...current.trips.filter(item => item.id !== trip.id)];
  $('#dispatch-search').value = '';
  $('#dispatch-hub').value = '';
  current.view = 'trips';
  selectItem(current, itemKey(trip));
}

function updateProgress() {
  const t = s?.displayed;
  if (!t || s.manual) return;
  const now = s.ctx.simNow();
  if (!t.status) {
    $('#dispatch-queue-age').textContent = `Queued for ${fmtDuration(Math.max(0, now - Date.parse(t.waitingSince)))}`;
    return;
  }
  const depart = Date.parse(t.departAt);
  const arrive = Date.parse(t.arriveAt);
  const loading = t.status === 'LOADING';
  const p = loading ? 0 : Math.max(0, Math.min(1, (now - depart) / Math.max(1, arrive - depart)));
  const left = (loading ? depart : arrive) - now;
  const percent = Math.round(p * 100);
  $('#dispatch-progress').value = percent;
  $('#dispatch-trip-pct').textContent = `${percent}%`;
  $('#dispatch-trip-left').textContent = left > 0 ? `${fmtDuration(left)} to ${loading ? 'departure' : 'arrival'}` : 'Updating soon';
  s.map?.setTripProgress(p);
}

function renderAutoResult(r) {
  const box = $('#auto-result');
  const trips = r.trips.slice(0, 12).map((t) => `<li>${esc(t.code)} · ${esc(t.plateNo)} · ${esc(t.origin.code)} → ${esc(t.destination.code)} (${esc(t.directionLabel)}) · ${t.shipmentCount} shipments, ${fmtKg(t.loadKg)}</li>`).join('');
  box.innerHTML = `<div class="result-box">
    <b>Dispatch run:</b> Scanned ${r.hubsScanned} hubs (${r.workers} workers), created <b>${r.tripsCreated}</b> trips and loaded <b>${r.shipmentsAssigned}</b> shipments in ${r.elapsedMs} ms.
    ${trips ? `<ul>${trips}${r.trips.length > 12 ? `<li>… and ${r.trips.length - 12} trips</li>` : ''}</ul>` : ''}
    ${r.relocations.length ? `<div style="margin-top:6px"><b>Empty relocations:</b><ul>${r.relocations.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${r.waiting.length ? `<details style="margin-top:6px"><summary>Routes still waiting (${r.waiting.length})</summary><ul>${r.waiting.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    ${r.problems.length ? `<div style="color:var(--critical);margin-top:6px">${r.problems.map(esc).join('<br>')}</div>` : ''}
  </div>`;
}

function selectItem(current, key, focusRoute = false) {
  if (key !== current.selected) {
    current.manual = false;
    current.checked = null;
    current.vehicleId = null;
    current.pickSig = null;
  }
  current.selected = key;
  current.detailsClosed = false;
  renderWorkspace(current, { focusRoute });
}

export default {
  title: 'Dispatch',

  async mount(root, ctx) {
    const current = {
      root, ctx, lanes: [], vehicles: [], trips: [], selected: null, checked: null, vehicleId: null,
      view: 'waiting', manual: false, detailsClosed: matchMedia('(max-width: 760px)').matches,
      version: 0, timers: [], relocating: new Set(), cardMarkup: new WeakMap()
    };
    s = current;
    root.innerHTML = `
      <div class="dispatch-workspace light-workspace">
        <section class="dispatch-queue" aria-labelledby="dispatch-queue-title">
          <header class="dispatch-queue-header">
            <div class="dispatch-heading"><h2 id="dispatch-queue-title">Dispatch queue</h2><button class="btn primary small" type="button" id="auto">Run auto dispatch</button></div>
            <div class="dispatch-tabs" role="group" aria-label="Dispatch views">
              <button type="button" data-view="waiting" aria-pressed="true">Waiting <span data-count>0</span></button>
              <button type="button" data-view="trips" aria-pressed="false">Active trips <span data-count>0</span></button>
            </div>
            <div class="dispatch-filters">
              <label class="dispatch-search">${SEARCH_ICON}<input id="dispatch-search" type="search" aria-label="Search routes or trips" placeholder="Search hub, trip or plate"></label>
              <select id="dispatch-hub" class="input" aria-label="Origin hub">${hubOptions(ctx.hubs, null, 'All origins')}</select>
            </div>
            <p class="dispatch-list-count" id="lane-sum"></p>
          </header>
          <div class="dispatch-rows" id="lane-list"><p class="empty">Loading routes…</p></div>
          <footer class="dispatch-queue-footer">
            <details class="dispatch-rules"><summary>Automatic dispatch rules</summary>
              <p>Shipments on the same leg share a vehicle. Dispatch starts at 60% capacity or after 3 hours in the queue (1.5 hours for Express). Express shipments load first. Cross-sea routes use cargo aircraft.</p>
              <p>If a hub runs out of vehicles, an idle vehicle can relocate from a nearby hub. Hubs plan dispatch in parallel with a lock per hub to prevent duplicate assignments.</p>
            </details>
            <div id="auto-result" aria-live="polite"></div>
          </footer>
        </section>
        <div class="dispatch-stage">
          <div class="dispatch-map-region" role="region" aria-label="Malaysia dispatch map">
            <div id="dispatch-map"></div>
            <div id="dispatch-map-tools" class="dispatch-map-tools" role="group" aria-label="Basemap">
              <button type="button" data-basemap="street" aria-pressed="true">Map</button>
              <button type="button" data-basemap="satellite" aria-pressed="false">Satellite</button>
            </div>
            <div class="dispatch-map-controls" id="dispatch-map-controls" role="group" aria-label="Map controls">
              <button type="button" data-map-zoom="in" aria-label="Zoom in">+</button>
              <button type="button" data-map-zoom="out" aria-label="Zoom out">−</button>
              <button type="button" data-map-zoom="reset" aria-label="Show all of Malaysia" title="Show all of Malaysia">⌖</button>
            </div>
            <div class="dispatch-map-credit"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a><span id="dispatch-satellite-credit" hidden> · <a href="https://s2maps.eu/" target="_blank" rel="noopener noreferrer">Sentinel‑2 by EOX</a></span> · Natural Earth</div>
          </div>
          <section id="dispatch-detail" class="dispatch-detail" aria-labelledby="dispatch-detail-title" hidden>
            <header class="dispatch-detail-head"><h3 id="dispatch-detail-title" tabindex="-1"></h3>
              <button type="button" class="dispatch-close" id="close-dispatch-detail" aria-label="Close route details">×</button></header>
            <div id="dispatch-summary" class="dispatch-detail-body"></div>
            <div id="pick" class="dispatch-detail-body" hidden></div>
          </section>
        </div>
      </div>`;

    if (globalThis.L) {
      current.map = new DispatchMap($('#dispatch-map'), id => {
        const select = $('#dispatch-hub');
        select.value = select.value === String(id) ? '' : String(id);
        current.detailsClosed = false;
        renderWorkspace(current);
      });
    } else {
      $('#dispatch-map').innerHTML = '<p class="empty">The map is temporarily unavailable.</p>';
      $('#dispatch-map-tools').hidden = true;
      $('#dispatch-map-controls').hidden = true;
    }

    $('.dispatch-tabs').addEventListener('click', event => {
      const tab = event.target.closest('[data-view]');
      if (!tab || tab.dataset.view === current.view) return;
      current.view = tab.dataset.view;
      selectItem(current, null);
    });
    $('#dispatch-search').addEventListener('input', () => renderWorkspace(current));
    $('#dispatch-hub').addEventListener('change', () => renderWorkspace(current));
    $('#lane-list').addEventListener('click', event => {
      const card = event.target.closest('[data-key]');
      if (!card) return;
      selectItem(current, card.dataset.key, true);
      if (matchMedia('(max-width: 760px)').matches) $('#dispatch-detail-title').focus();
    });
    $('#dispatch-detail').addEventListener('click', event => {
      if (event.target.closest('#show-pick')) {
        current.manual = true;
        current.pickSig = null;
        renderDetail(current, current.displayed);
        $('#dispatch-detail-title').focus();
      } else if (event.target.closest('#close-dispatch-detail')) {
        if (current.manual) {
          current.manual = false;
          renderWorkspace(current);
          $('#show-pick')?.focus();
        } else {
          current.detailsClosed = true;
          renderWorkspace(current);
          const card = [...$('#lane-list').children].find(item => item.dataset.key === current.selected);
          card?.focus();
        }
      }
    });
    $('#dispatch-map-tools').addEventListener('click', event => {
      const button = event.target.closest('[data-basemap]');
      if (!button || button.getAttribute('aria-pressed') === 'true') return;
      for (const item of $('#dispatch-map-tools').children) item.setAttribute('aria-pressed', String(item === button));
      current.map?.setBasemap(button.dataset.basemap);
      $('#dispatch-satellite-credit').hidden = button.dataset.basemap !== 'satellite';
    });
    $('#dispatch-map-controls').addEventListener('click', event => {
      const action = event.target.closest('[data-map-zoom]')?.dataset.mapZoom;
      if (action === 'reset') current.map?.reset();
      else if (action) current.map?.zoom(action === 'in' ? 1 : -1);
    });
    $('#auto').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Dispatching…';
      try {
        const r = await post('/api/dispatch/auto');
        if (s !== current) return;
        renderAutoResult(r);
        current.reloadSoon();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Run auto dispatch';
      }
    });
    current.reloadSoon = throttle(() => loadAll(current).catch(() => {}), 2000);
    current.timers.push(setInterval(updateProgress, 1000), setInterval(current.reloadSoon, 15000));
    try {
      await loadAll(current);
    } catch {
      if (s === current) $('#lane-list').innerHTML = '<p class="empty">Routes could not load. Retrying shortly.</p>';
    }
  },

  unmount() {
    if (!s) return;
    s.timers.forEach(clearInterval);
    s.map?.destroy();
    s = null;
  },

  onEvent(evt) {
    if (s && ['shipment', 'trip', 'dispatch', 'fleet'].includes(evt.type)) s.reloadSoon();
  }
};
