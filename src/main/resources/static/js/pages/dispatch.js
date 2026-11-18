import { get, post } from '../api.js';
import {
  $, ago, badge, dirChip, throttle, esc, fmtHM, fmtKg, fmtNum, fmtTime, lane, toast
} from '../ui.js';
import { openShipment } from './shipments.js';

let s = null;

const laneKey = (l) => `${l.origin.id}>${l.destination.id}`;

function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function loadAll() {
  if (!s) return;
  const token = s;
  const [lanes, vehicles, trips] = await Promise.all([get('/api/dispatch/lanes'), get('/api/vehicles'), get('/api/trips')]);
  if (s !== token) return;
  s.lanes = lanes;
  s.vehicles = vehicles;
  s.trips = trips;
  renderLanes();
  const sig = pickSignature();
  if (sig !== s.pickSig) renderPick();
  renderTrips();
}

function pickSignature() {
  const l = s.lanes.find((x) => laneKey(x) === s.selected);
  if (!l) return 'none';
  const ids = l.shipments.map((x) => x.id).join(',');
  const fleet = s.vehicles.filter((v) => v.hub.id === l.origin.id).map((v) => `${v.id}:${v.status}`).join(',');
  return `${s.selected}|${ids}|${fleet}`;
}

function renderLanes() {
  const list = $('#lane-list');
  const now = s.ctx.simNow();
  const total = s.lanes.reduce((n, l) => n + l.count, 0);
  $('#lane-sum').textContent = `${s.lanes.length} routes · ${total} shipments`;
  if (!s.lanes.length) {
    list.innerHTML = '<div class="empty">No shipments awaiting dispatch 👍</div>';
    return;
  }
  list.innerHTML = s.lanes.map((l) => `
    <button type="button" class="lane-card${laneKey(l) === s.selected ? ' selected' : ''}" data-key="${laneKey(l)}">
      <div class="row">${lane(l.origin, l.destination)} ${dirChip(l.direction, l.directionLabel)}
        ${l.air ? '<span class="badge air plain">Air freight</span>' : ''}
        ${l.overdue ? '<span class="badge overdue">Ready to dispatch</span>' : ''}</div>
      <div class="row meta"><span class="num">${l.count} shipments · ${fmtKg(l.totalKg)}</span>${l.expressCount ? `<span class="badge express plain">Express ${l.expressCount}</span>` : ''}
        ${l.transferCount ? `<span class="badge transfer plain">Transfer ${l.transferCount}</span>` : ''}
          <span class="muted">Queued ${ago(l.waitingSince, now)}</span></div>
    </button>`).join('');
  list.querySelectorAll('.lane-card').forEach((b) => b.addEventListener('click', () => {
    s.selected = b.dataset.key;
    s.checked = null;
    s.vehicleId = null;
    list.querySelectorAll('.lane-card').forEach((x) => x.classList.toggle('selected', x === b));
    renderPick();
  }));
}

function renderPick() {
  const box = $('#pick');
  s.pickSig = pickSignature();
  const l = s.lanes.find((x) => laneKey(x) === s.selected);
  if (!l) {
    $('#pick-title').textContent = 'Manual dispatch';
    box.innerHTML = '<div class="empty">← Select a route, choose shipments, and assign a vehicle.</div>';
    return;
  }
  $('#pick-title').innerHTML = `Manual dispatch · ${lane(l.origin, l.destination)}`;
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
      return `<label class="${v.id === s.vehicleId ? 'on' : ''}${ok ? '' : ' disabled'}" data-vid="${v.id}">
        <input type="radio" name="vehicle" value="${v.id}" ${ok ? '' : 'disabled'}>
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
        <span style="flex:1"></span><button class="btn small" data-relocate="${v.id}">Relocate to ${esc(l.origin.code)}</button></div>`).join('')}</div>` : 'No vehicles are available nearby. Try again shortly.'}</div>`;
  }

  box.innerHTML = `
    <div class="section-title" style="margin-top:0;display:flex;align-items:center;gap:8px">
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
      <button class="btn primary" id="do-dispatch" ${!vehicle || over || !s.checked.size ? 'disabled' : ''}>Dispatch vehicle</button>
    </div>`;

  box.querySelectorAll('.pick-list input').forEach((c) => c.addEventListener('change', () => {
    const id = Number(c.value);
    if (c.checked) s.checked.add(id); else s.checked.delete(id);
    renderPick();
  }));
  box.querySelectorAll('[data-no]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    openShipment(a.dataset.no, s.ctx, loadAll);
  }));
  $('#check-all').addEventListener('click', () => { s.checked = new Set(ids); renderPick(); });
  $('#check-none').addEventListener('click', () => { s.checked = new Set(); renderPick(); });
  box.querySelectorAll('.vehicle-pick label:not(.disabled)').forEach((lb) => lb.addEventListener('click', (e) => {
    e.preventDefault();
    s.vehicleId = Number(lb.dataset.vid);
    renderPick();
  }));
  box.querySelectorAll('[data-relocate]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const trip = await post(`/api/vehicles/${b.dataset.relocate}/relocate`, { hubId: l.origin.id });
      toast(`Empty relocation scheduled for ${trip.plateNo}: ${trip.origin.code} → ${trip.destination.code}, ETA ${fmtHM(trip.arriveAt)}`, 'success');
      await loadAll();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
  $('#do-dispatch').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const trip = await post('/api/dispatch', { vehicleId: s.vehicleId, shipmentIds: [...s.checked] });
      toast(`Trip ${trip.code} created. ${trip.plateNo} has ${trip.shipmentCount} shipments (${fmtKg(trip.loadKg)}), ETD ${fmtHM(trip.departAt)}.`, 'success');
      s.checked = null;
      s.vehicleId = null;
      await loadAll();
    } catch (err) {
      toast(err.message, 'error');
      await loadAll();
    }
  });
}

function renderTrips() {
  const el = $('#trips');
  const loading = s.trips.filter((t) => t.status === 'LOADING').length;
  $('#trip-sum').textContent = `${s.trips.length - loading} in transit · ${loading} loading`;
  if (!s.trips.length) {
    el.innerHTML = '<div class="empty">No trips are currently active.</div>';
    return;
  }
  el.innerHTML = `<table class="data"><thead><tr><th>Trip</th><th>Vehicle</th><th>Route</th><th>Direction</th><th>Status</th>
      <th style="min-width:150px">Progress</th><th class="right">Load</th><th>Departure</th><th>ETA</th><th>Notes</th></tr></thead><tbody>
    ${s.trips.map((t) => `<tr data-trip="${t.id}">
      <td class="mono">${esc(t.code)}</td>
      <td class="nowrap"><b>${esc(t.plateNo)}</b> <span class="muted">${esc(t.vehicleTypeLabel)}</span></td>
      <td>${lane(t.origin, t.destination)}</td><td>${dirChip(t.direction, t.directionLabel)}</td>
      <td>${badge(t.status, t.statusLabel)}</td>
      <td><div class="bar"><span data-progress style="width:0%"></span></div><div class="bar-label"><span data-pct></span><span data-left></span></div></td>
      <td class="right num nowrap">${t.relocation ? '<span class="muted">Empty relocation</span>' : `${t.shipmentCount} shipments · ${(t.loadKg / t.capacityKg * 100).toFixed(0)}%`}</td>
      <td class="nowrap">${fmtTime(t.departAt)}</td><td class="nowrap">${fmtTime(t.arriveAt)}</td>
      <td>${t.delayReason ? `<span class="badge late plain">Delay: ${esc(t.delayReason)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`;
  updateProgress();
}

function updateProgress() {
  if (!s) return;
  const now = s.ctx.simNow();
  const byId = new Map(s.trips.map((t) => [String(t.id), t]));
  document.querySelectorAll('#trips tr[data-trip]').forEach((tr) => {
    const t = byId.get(tr.dataset.trip);
    if (!t) return;
    const depart = Date.parse(t.departAt);
    const arrive = Date.parse(t.arriveAt);
    const p = t.status === 'LOADING' || now < depart ? 0 : Math.min(1, (now - depart) / Math.max(1, arrive - depart));
    tr.querySelector('[data-progress]').style.width = `${(p * 100).toFixed(1)}%`;
    tr.querySelector('[data-pct]').textContent = t.status === 'LOADING' ? 'Loading' : `${Math.round(p * 100)}%`;
    const left = t.status === 'LOADING' ? depart - now : arrive - now;
    tr.querySelector('[data-left]').textContent = left > 0 ? `${Math.round(left / 60000)} min to ${t.status === 'LOADING' ? 'departure' : 'arrival'}` : 'Updating soon';
  });
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

export default {
  title: 'Dispatch',

  async mount(root, ctx) {
    s = { ctx, lanes: [], vehicles: [], trips: [], selected: null, checked: null, vehicleId: null, timers: [] };
    root.innerHTML = `
      <section class="card">
        <div class="card-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
          <div style="flex:1;min-width:280px"><b>Automatic dispatch rules</b>
            <div class="text-2" style="font-size:13px;margin-top:4px">Shipments on the same leg (origin → destination) share a vehicle. Dispatch starts at ≥ 60% or when the oldest shipment has waited 3 hours ( 1.5 hours for Express). Express shipments are loaded first.
              Cross-sea routes use cargo aircraft. When a hub runs out of vehicles, an idle vehicle can be relocated from the nearest hub without pending freight. Hubs plan dispatch in parallel, with a lock per hub to prevent duplicate assignments.</div></div>
          <button class="btn primary" id="auto">⚡ Run auto dispatch</button>
        </div>
        <div id="auto-result" class="card-body" style="padding-top:0"></div>
      </section>
      <div class="dispatch-grid">
        <section class="card"><div class="card-head"><h2>Routes awaiting dispatch</h2><span class="sub" id="lane-sum"></span></div>
          <div class="card-body flush" style="padding-top:12px"><div class="lane-list" id="lane-list"><div class="empty">Loading…</div></div></div></section>
        <section class="card"><div class="card-head"><h2 id="pick-title">Manual dispatch</h2></div><div class="card-body" id="pick"></div></section>
      </div>
      <section class="card"><div class="card-head"><h2>Active trips</h2><span class="sub" id="trip-sum"></span></div>
        <div class="card-body flush"><div class="table-wrap" id="trips"></div></div></section>`;

    $('#auto').addEventListener('click', async (e) => {
      e.target.disabled = true;
      e.target.textContent = 'Dispatching…';
      try {
        const r = await post('/api/dispatch/auto');
        renderAutoResult(r);
        await loadAll();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        e.target.disabled = false;
        e.target.textContent = '⚡ Run auto dispatch';
      }
    });
    s.reloadSoon = throttle(() => loadAll().catch(() => {}), 2000);
    await loadAll();
    s.timers.push(setInterval(updateProgress, 1000));
    s.timers.push(setInterval(() => loadAll().catch(() => {}), 15000));
  },

  unmount() {
    if (!s) return;
    s.timers.forEach(clearInterval);
    s = null;
  },

  onEvent(evt) {
    if (s && ['shipment', 'trip', 'dispatch', 'fleet'].includes(evt.type)) s.reloadSoon();
  }
};
