import { get, post } from '../api.js';
import { $, esc, fmtFull, fmtHM, fmtKg, fmtNum, hubOptions, openModal, throttle, toast } from '../ui.js';
import { vehicleIllustration } from '../vehicle-illustration.js';

let s = null;

const TYPES = { VAN: ['Van', 1000], LORRY: ['Lorry', 5000], TRAILER: ['Trailer', 20000], AIR_CARGO: ['Cargo aircraft', 8000] };
const VIEWS = [['', 'All vehicles'], ['IDLE', 'Available'], ['ON_TRIP', 'On trip'], ['MAINTENANCE', 'Maintenance']];
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/></svg>';

async function load(current) {
  if (s !== current) return;
  const version = ++current.version;
  const [vehicles, trips] = await Promise.allSettled([get('/api/vehicles'), get('/api/trips')]);
  if (s !== current || version !== current.version) return;
  if (vehicles.status === 'rejected') throw vehicles.reason;
  current.vehicles = vehicles.value;
  if (trips.status === 'fulfilled') current.trips = new Map(trips.value.map(trip => [trip.vehicleId, trip]));
  render(current);
}

function statusMark(status, label) {
  return `<span class="fleet-status" data-status="${esc(status)}">${esc(label)}</span>`;
}

function assignment(v) {
  return v.tripDestination ? `${v.hub.code} → ${v.tripDestination.code}` : `${v.hub.code} · ${v.hub.name}`;
}

function vehicleCardContent(v) {
  return `<span class="fleet-vehicle-head"><strong>${esc(v.plateNo)}</strong>${statusMark(v.status, v.statusLabel)}</span>
    <span class="fleet-vehicle-body">
      <span class="fleet-vehicle-copy"><small>${esc(v.typeLabel)}</small><b>${esc(assignment(v))}</b>
        <small>Driver</small><b>${esc(v.driverName)}</b></span>
      ${vehicleIllustration(v.type, v.typeLabel)}
    </span>
    <span class="fleet-vehicle-foot"><span>${fmtNum(v.capacityKg)} kg capacity</span>${v.tripCode ? `<span class="mono">${esc(v.tripCode)}</span>` : ''}</span>`;
}

function renderCards(current, rows, selected) {
  const list = $('#vehicles', current.root);
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  if (!rows.length) {
    list.innerHTML = '<p class="empty">No vehicles match these filters.</p>';
    if (focused) $('#v-search', current.root).focus({ preventScroll: true });
    return;
  }
  $('.empty', list)?.remove();
  const ids = new Set(rows.map(v => String(v.id)));
  for (const card of [...list.children]) {
    if (!ids.has(card.dataset.vehicle)) card.remove();
  }
  const existing = new Map([...list.children].map(card => [card.dataset.vehicle, card]));
  let position = list.firstElementChild;
  for (const v of rows) {
    const key = String(v.id);
    const card = existing.get(key) ?? document.createElement('button');
    if (!existing.has(key)) {
      card.type = 'button';
      card.className = 'fleet-vehicle';
      card.dataset.vehicle = key;
      card.setAttribute('aria-controls', 'fleet-detail');
    }
    card.setAttribute('aria-pressed', String(v === selected));
    const markup = vehicleCardContent(v);
    if (current.cardMarkup.get(card) !== markup) {
      current.cardMarkup.set(card, markup);
      card.innerHTML = markup;
    }
    if (card !== position) list.insertBefore(card, position);
    position = card.nextElementSibling;
  }
  if (focused && document.activeElement !== focused) {
    (focused.isConnected ? focused : $('#v-search', current.root)).focus({ preventScroll: true });
  }
}

function updateTripProgress(current, trip) {
  const meter = $('#fleet-trip-progress', current.root);
  if (!meter || !trip || current.detailClosed) return;
  const depart = Date.parse(trip.departAt);
  const duration = Date.parse(trip.arriveAt) - depart;
  const value = trip.status === 'IN_TRANSIT' && duration > 0
    ? Math.round(Math.max(0, Math.min(100, (current.ctx.simNow() - depart) / duration * 100)))
    : 0;
  if (meter.value !== value) {
    meter.value = value;
    $('#fleet-trip-percent', current.root).textContent = `${value}%`;
  }
}

function tripMetrics(trip) {
  const activeStep = trip.status === 'IN_TRANSIT' ? 1 : 0;
  return `<section class="fleet-panel fleet-journey" aria-label="Active trip">
    <div class="fleet-panel-heading"><h4>Active trip</h4><span class="mono">${esc(trip.code)}</span></div>
    <div class="fleet-route"><b>${esc(trip.origin.code)} → ${esc(trip.destination.code)}</b>
      <a class="btn small" data-focus-key="map" href="#/dashboard?tripId=${trip.id}">View on map ↗</a></div>
    <ol class="fleet-timeline">${['Loading', 'In transit', 'Arrived'].map((label, index) =>
      `<li${index < activeStep ? ' class="is-complete"' : index === activeStep ? ' aria-current="step"' : ''}>${label}</li>`).join('')}</ol>
    <dl class="fleet-facts">
      <div><dt>Departure</dt><dd>${fmtFull(trip.departAt)}</dd></div>
      <div><dt>Expected arrival</dt><dd>${fmtFull(trip.arriveAt)}</dd></div>
      <div><dt>Route distance</dt><dd>${fmtNum(trip.distanceKm)} km</dd></div>
      <div><dt>Shipments</dt><dd>${fmtNum(trip.shipmentCount)}</dd></div>
    </dl>
    <div class="fleet-progress-label"><label for="fleet-trip-progress">Trip progress</label><span id="fleet-trip-percent">0%</span></div>
    <progress id="fleet-trip-progress" max="100" value="0"></progress>
    ${trip.delayReason ? `<p class="fleet-note">${esc(trip.delayReason)}</p>` : ''}
  </section>`;
}

function renderDetails(current, v) {
  const el = $('#fleet-detail', current.root);
  el.hidden = !v;
  if (!v) return;
  const trip = current.trips.get(v.id);
  const activeTrip = trip?.code === v.tripCode ? trip : null;
  const busy = current.busy.has(v.id) ? ' disabled' : '';
  const load = Math.max(0, Math.min(100, Math.round(v.tripLoadKg / v.capacityKg * 100)));
  const phone = v.driverPhone?.replace(/[^\d+]/g, '');
  const reliefDrivers = (v.assignedDrivers ?? []).filter(driver => driver.name !== v.driverName);
  const markup = `<header class="fleet-detail-heading">
      <div><p class="fleet-eyebrow">Vehicle details</p><h3 id="fleet-detail-title" tabindex="-1">${esc(v.plateNo)}</h3></div>
      <button type="button" class="fleet-close" data-focus-key="close" aria-label="Close vehicle details">×</button>
    </header>
    <section class="fleet-panel fleet-detail-hero" aria-label="Vehicle assignment">
      <div><h4>${esc(v.typeLabel)}</h4>${statusMark(v.status, v.statusLabel)}
        <p>${esc(assignment(v))}</p>${v.tripCode && !activeTrip ? `<small class="mono">${esc(v.tripCode)}</small>` : ''}</div>
      ${vehicleIllustration(v.type, v.typeLabel)}
    </section>
    <div class="fleet-detail-grid">
      ${activeTrip ? tripMetrics(activeTrip) : ''}
      <section class="fleet-panel">
        <h4>Capacity</h4>
        <p class="fleet-value">${fmtNum(v.capacityKg)} <small>kg</small></p>
        ${v.tripCode ? `<div class="fleet-progress-label"><label for="fleet-load">Current load</label><span>${fmtKg(v.tripLoadKg)}</span></div>
          <progress id="fleet-load" max="100" value="${load}">${load}%</progress>` : ''}
        <p class="fleet-note">${[v.refrigerated ? 'Refrigerated' : '', v.heavyDuty ? 'Heavy duty' : ''].filter(Boolean).join(' · ') || 'Standard equipment'}</p>
      </section>
      <section class="fleet-panel">
        <h4>Service</h4>
        <dl class="fleet-facts fleet-service">
          <div><dt>Next service</dt><dd>${v.nextServiceOn ? `<time datetime="${esc(v.nextServiceOn)}">${esc(v.nextServiceOn)}</time>` : 'Unscheduled'}</dd></div>
          <div><dt>Fuel score</dt><dd>${v.fuelScore == null ? 'Unavailable' : `${fmtNum(v.fuelScore)} / 10`}</dd></div>
        </dl>
        ${v.fuelScore == null ? '' : `<progress aria-label="Fuel score" max="10" value="${v.fuelScore}"></progress>`}
      </section>
      <section class="fleet-panel fleet-driver">
        <div><h4>Assigned driver</h4><b>${esc(v.driverName)}</b>
          ${reliefDrivers.length ? `<p class="fleet-note">Relief drivers · ${reliefDrivers.map(driver => esc(driver.name)).join(', ')}</p>` : ''}</div>
        ${phone ? `<a class="btn small" data-focus-key="phone" href="tel:${esc(phone)}">${esc(v.driverPhone)}</a>` : ''}
      </section>
    </div>
    ${v.status === 'IDLE' ? `<footer class="fleet-actions"><button type="button" class="btn primary" data-relocate data-focus-key="relocate">Relocate</button>
      <button type="button" class="btn" data-maint="true" data-focus-key="maintenance"${busy}>Mark for maintenance</button></footer>`
    : v.status === 'MAINTENANCE' ? `<footer class="fleet-actions"><button type="button" class="btn primary" data-maint="false" data-focus-key="maintenance"${busy}>Complete maintenance</button></footer>` : ''}`;
  if (markup !== current.detailMarkup) {
    const focused = el.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
    current.detailMarkup = markup;
    el.innerHTML = markup;
    if (focused) ($(`[data-focus-key="${focused}"]:not(:disabled)`, el) ?? $('#fleet-detail-title', el)).focus({ preventScroll: true });
  }
  updateTripProgress(current, activeTrip);
}

function render(current) {
  const { root, vehicles } = current;
  const hub = $('#v-hub', root).value;
  const type = $('#v-type', root).value;
  const search = $('#v-search', root).value.trim().toLowerCase();
  const matches = vehicles.filter(v => (!hub || String(v.hub.id) === hub) && (!type || v.type === type)
    && (!search || [v.plateNo, v.typeLabel, v.driverName, assignment(v), v.tripCode].filter(Boolean).some(value => value.toLowerCase().includes(search))));
  for (const button of root.querySelectorAll('[data-fleet-view]')) {
    const status = button.dataset.fleetView;
    button.setAttribute('aria-pressed', String(status === current.status));
    $('[data-count]', button).textContent = status ? matches.filter(v => v.status === status).length : matches.length;
  }
  const rows = matches.filter(v => !current.status || v.status === current.status);
  let selected = rows.find(v => v.id === current.selectedId);
  if (!selected && !current.detailClosed) {
    selected = rows[0];
    current.selectedId = selected?.id ?? null;
  }
  renderCards(current, rows, selected);
  renderDetails(current, selected);
}

function relocate(current, v) {
  const targets = current.ctx.hubs.filter((h) => h.id !== v.hub.id && (v.type === 'AIR_CARGO' || h.landmass === current.ctx.hubsById.get(v.hub.id)?.landmass));
  const { el, close } = openModal({
    title: `Relocate ${v.plateNo}`,
    body: `<p class="text-2" style="margin-top:0">The empty vehicle will leave ${esc(v.hub.code)} and stand by at the destination hub.${v.type === 'AIR_CARGO' ? '' : ' Road relocations stay within Peninsular Malaysia or East Malaysia.'}</p>
      <label class="field"><span>Destination hub</span><select class="input" id="relocate-to">${hubOptions(targets, null, targets.length ? undefined : 'No reachable hubs')}</select></label>`,
    foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" id="relocate-ok"${targets.length ? '' : ' disabled'}>Confirm relocation</button>`
  });
  el.querySelector('#relocate-ok').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const trip = await post(`/api/vehicles/${v.id}/relocate`, { hubId: Number(el.querySelector('#relocate-to').value) });
      toast(`${trip.plateNo} departs at ${fmtHM(trip.departAt)}. ETA at ${trip.destination.code}: ${fmtHM(trip.arriveAt)}.`, 'success');
      close();
      current.reloadSoon();
    } catch (e) {
      toast(e.message, 'error');
      button.disabled = false;
    }
  });
}

function openCreate(current) {
  const { el, close } = openModal({
    title: 'Add vehicle',
    body: `<form class="form-grid" id="vehicle-form" autocomplete="off">
      <label class="field"><span>Plate number</span><input class="input" name="plateNo" maxlength="16" placeholder="e.g. WXY 1234" required></label>
      <label class="field"><span>Vehicle type</span><select class="input" name="type">${Object.entries(TYPES).map(([k, [label, cap]]) => `<option value="${k}">${label} (default: ${fmtNum(cap)} kg)</option>`).join('')}</select></label>
      <label class="field"><span>Capacity (kg, optional)</span><input class="input" name="capacityKg" type="number" min="100" step="100"></label>
      <label class="field"><span>Current hub</span><select class="input" name="hubId">${hubOptions(current.ctx.hubs, null)}</select></label>
      <label class="field"><span>Driver</span><input class="input" name="driverName" maxlength="60" required></label>
      <label class="field"><span>Driver phone</span><input class="input" name="driverPhone" maxlength="30"></label>
      <label class="field full"><span>Relief drivers (optional, comma-separated)</span><input class="input" name="reliefDrivers" maxlength="720"></label>
      <label class="field"><span>Next service (optional)</span><input class="input" type="date" name="nextServiceOn"></label>
      <label class="field"><span>Fuel score (0–10, optional)</span><input class="input" type="number" name="fuelScore" min="0" max="10"></label>
      <label class="toggle"><input type="checkbox" name="refrigerated">Refrigerated</label>
    </form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="vehicle-ok">Save</button>'
  });
  el.querySelector('#vehicle-ok').addEventListener('click', async event => {
    const button = event.currentTarget;
    const form = el.querySelector('#vehicle-form');
    if (!form.reportValidity()) return;
    const f = new FormData(form);
    button.disabled = true;
    try {
      const v = await post('/api/vehicles', {
        plateNo: f.get('plateNo'), type: f.get('type'), capacityKg: f.get('capacityKg') ? Number(f.get('capacityKg')) : null,
        hubId: Number(f.get('hubId')), driverName: f.get('driverName'), driverPhone: f.get('driverPhone'),
        reliefDrivers: f.get('reliefDrivers').split(',').map(name => name.trim()).filter(Boolean),
        nextServiceOn: f.get('nextServiceOn') || null,
        fuelScore: f.get('fuelScore') ? Number(f.get('fuelScore')) : null,
        refrigerated: f.has('refrigerated')
      });
      toast(`Added ${v.plateNo}`, 'success');
      close();
      if (s === current) {
        current.selectedId = v.id;
        current.detailClosed = false;
        current.status = '';
        for (const id of ['#v-hub', '#v-type', '#v-search']) $(id, current.root).value = '';
        current.reloadSoon();
      }
    } catch (e) {
      toast(e.message, 'error');
      button.disabled = false;
    }
  });
}

export default {
  title: 'Fleet',

  async mount(root, ctx) {
    const compactView = matchMedia('(max-width: 820px)');
    const current = { root, ctx, vehicles: [], trips: new Map(), busy: new Set(), cardMarkup: new WeakMap(),
      version: 0, status: '', selectedId: null, detailClosed: compactView.matches };
    s = current;
    root.innerHTML = `
      <div class="fleet-workspace light-workspace">
        <section class="fleet-list" aria-labelledby="fleet-title">
          <header class="fleet-list-heading">
            <h2 id="fleet-title">Vehicles</h2>
            <button type="button" class="btn primary" id="add">+ Add vehicle</button>
          </header>
          <div class="fleet-filters">
            <label class="fleet-search">${SEARCH_ICON}<input id="v-search" type="search" placeholder="Search vehicles" aria-label="Search vehicles"></label>
            <select class="input" id="v-hub" aria-label="Hub">${hubOptions(ctx.hubs, null, 'All hubs')}</select>
            <select class="input" id="v-type" aria-label="Vehicle type"><option value="">All vehicle types</option>${Object.entries(TYPES).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select>
          </div>
          <div class="fleet-views" role="group" aria-label="Vehicle status">
            ${VIEWS.map(([status, label]) => `<button type="button" data-fleet-view="${status}" aria-pressed="${!status}">${label}<span data-count></span></button>`).join('')}
          </div>
          <div class="fleet-vehicles" id="vehicles"><p class="empty">Loading vehicles…</p></div>
        </section>
        <section class="fleet-detail" id="fleet-detail" aria-labelledby="fleet-detail-title" hidden></section>
      </div>`;
    for (const id of ['#v-hub', '#v-type']) $(id, root).addEventListener('change', () => render(current));
    $('#v-search', root).addEventListener('input', () => render(current));
    $('.fleet-views', root).addEventListener('click', event => {
      const button = event.target.closest('[data-fleet-view]');
      if (!button) return;
      current.status = button.dataset.fleetView;
      render(current);
    });
    $('#vehicles', root).addEventListener('click', event => {
      const card = event.target.closest('[data-vehicle]');
      if (!card) return;
      current.selectedId = Number(card.dataset.vehicle);
      current.detailClosed = false;
      render(current);
      if (compactView.matches) $('#fleet-detail-title', root).focus();
    });
    $('#fleet-detail', root).addEventListener('click', async event => {
      const button = event.target.closest('button');
      if (!button) return;
      const selected = current.vehicles.find(v => v.id === current.selectedId);
      if (!selected) return;
      if (button.classList.contains('fleet-close')) {
        current.selectedId = null;
        current.detailClosed = true;
        render(current);
        $(`[data-vehicle="${selected.id}"]`, root)?.focus();
      } else if (button.hasAttribute('data-relocate')) {
        relocate(current, selected);
      } else if (button.hasAttribute('data-maint') && !current.busy.has(selected.id)) {
        current.busy.add(selected.id);
        button.disabled = true;
        try {
          const v = await post(`/api/vehicles/${selected.id}/maintenance`, { on: button.dataset.maint === 'true' });
          toast(`${v.plateNo} ${v.status === 'MAINTENANCE' ? 'entered maintenance' : 'is available'}`, 'success');
          current.vehicles = current.vehicles.map(item => item.id === v.id ? v : item);
          current.reloadSoon();
        } catch (e) {
          toast(e.message, 'error');
        } finally {
          current.busy.delete(selected.id);
          if (s === current) {
            button.disabled = false;
            render(current);
          }
        }
      }
    });
    $('#add', root).addEventListener('click', () => openCreate(current));
    current.reloadSoon = throttle(() => load(current).catch(() => {}), 2000);
    await load(current);
    if (s !== current) return;
    current.progressTimer = setInterval(() => updateTripProgress(current, current.trips.get(current.selectedId)), 1000);
  },

  unmount() {
    clearInterval(s?.progressTimer);
    s = null;
  },

  onEvent(evt) {
    if (s && ['trip', 'fleet', 'dispatch'].includes(evt.type)) s.reloadSoon();
  }
};
