import { get, post } from '../api.js';
import { $, badge, esc, fmtHM, fmtNum, hubOptions, openModal, throttle, toast } from '../ui.js';

let s = null;

const TYPES = { VAN: ['Van', 1000], LORRY: ['Lorry', 5000], TRAILER: ['Trailer', 20000], AIR_CARGO: ['Cargo aircraft', 8000] };

async function load() {
  if (!s) return;
  const token = s;
  const vehicles = await get('/api/vehicles');
  if (s !== token) return;
  s.vehicles = vehicles;
  render();
}

function render() {
  const hub = $('#v-hub').value;
  const status = $('#v-status').value;
  const type = $('#v-type').value;
  const rows = s.vehicles.filter((v) => (!hub || String(v.hub.id) === hub) && (!status || v.status === status) && (!type || v.type === type));
  const count = (st) => s.vehicles.filter((v) => v.status === st).length;
  $('#fleet-sum').textContent = `Total ${s.vehicles.length} vehicles · On trip ${count('ON_TRIP')} · Available ${count('IDLE')} · Maintenance ${count('MAINTENANCE')}`;
  const el = $('#vehicles');
  if (!rows.length) {
    el.innerHTML = '<div class="empty">No matching vehicles</div>';
    return;
  }
  el.innerHTML = `<table class="data"><thead><tr><th>Plate number</th><th>Vehicle type</th><th class="right">Capacity</th><th>Driver</th><th>Status</th><th>Location / Assignment</th><th class="right">Actions</th></tr></thead><tbody>
    ${rows.map((v) => `<tr>
      <td><b>${esc(v.plateNo)}</b></td>
      <td>${esc(v.typeLabel)}</td>
      <td class="right num">${fmtNum(v.capacityKg)} kg</td>
      <td>${esc(v.driverName)} <span class="muted">${esc(v.driverPhone ?? '')}</span></td>
      <td>${badge(v.status, v.statusLabel)}</td>
      <td>${v.tripCode
        ? `<span class="mono">${esc(v.tripCode)}</span> · ${esc(v.hub.code)} → ${esc(v.tripDestination.code)}${v.tripLoadKg ? ` · ${fmtNum(v.tripLoadKg)} kg` : ' · Empty'}`
        : `At hub ${esc(v.hub.code)} ${esc(v.hub.name)}`}</td>
      <td class="right nowrap">
        ${v.status === 'IDLE' ? `<button class="btn small" data-relocate="${v.id}">Relocate</button> <button class="btn small" data-maint="${v.id}" data-on="true">Maintenance</button>` : ''}
        ${v.status === 'MAINTENANCE' ? `<button class="btn small" data-maint="${v.id}" data-on="false">Complete maintenance</button>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
  el.querySelectorAll('[data-maint]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const v = await post(`/api/vehicles/${b.dataset.maint}/maintenance`, { on: b.dataset.on === 'true' });
      toast(`${v.plateNo} ${v.status === 'MAINTENANCE' ? 'entered maintenance' : 'is available'}`, 'success');
      await load();
    } catch (e) {
      toast(e.message, 'error');
      b.disabled = false;
    }
  }));
  el.querySelectorAll('[data-relocate]').forEach((b) => b.addEventListener('click', () => relocate(s.vehicles.find((v) => String(v.id) === b.dataset.relocate))));
}

function relocate(v) {
  const targets = s.ctx.hubs.filter((h) => h.id !== v.hub.id && (v.type === 'AIR_CARGO' || h.landmass === s.ctx.hubsById.get(v.hub.id)?.landmass));
  const { el, close } = openModal({
    title: `Relocate ${v.plateNo}`,
    body: `<p class="text-2" style="margin-top:0">The empty vehicle will leave ${esc(v.hub.code)} and stand by at the destination hub.${v.type === 'AIR_CARGO' ? '' : ' Road relocations stay within Peninsular Malaysia or East Malaysia.'}</p>
      <div class="field"><label>Destination hub</label><select class="input" id="relocate-to">${hubOptions(targets, null)}</select></div>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="relocate-ok">Confirm relocation</button>'
  });
  el.querySelector('#relocate-ok').addEventListener('click', async () => {
    try {
      const trip = await post(`/api/vehicles/${v.id}/relocate`, { hubId: Number(el.querySelector('#relocate-to').value) });
      toast(`${trip.plateNo} departs at ${fmtHM(trip.departAt)}. ETA at ${trip.destination.code}: ${fmtHM(trip.arriveAt)}.`, 'success');
      close();
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

function openCreate() {
  const { el, close } = openModal({
    title: 'Add vehicle',
    body: `<form class="form-grid" id="vehicle-form" autocomplete="off">
      <div class="field"><label>Plate number</label><input class="input" name="plateNo" maxlength="16" placeholder="e.g. WXY 1234" required></div>
      <div class="field"><label>Vehicle type</label><select class="input" name="type">${Object.entries(TYPES).map(([k, [label, cap]]) => `<option value="${k}">${label} (default: ${fmtNum(cap)} kg)</option>`).join('')}</select></div>
      <div class="field"><label>Capacity (kg, optional)</label><input class="input" name="capacityKg" type="number" min="100" step="100"></div>
      <div class="field"><label>Current hub</label><select class="input" name="hubId">${hubOptions(s.ctx.hubs, null)}</select></div>
      <div class="field"><label>Driver</label><input class="input" name="driverName" maxlength="60" required></div>
      <div class="field"><label>Driver phone</label><input class="input" name="driverPhone" maxlength="30"></div>
    </form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="vehicle-ok">Save</button>'
  });
  el.querySelector('#vehicle-ok').addEventListener('click', async () => {
    const form = el.querySelector('#vehicle-form');
    if (!form.reportValidity()) return;
    const f = new FormData(form);
    try {
      const v = await post('/api/vehicles', {
        plateNo: f.get('plateNo'), type: f.get('type'), capacityKg: f.get('capacityKg') ? Number(f.get('capacityKg')) : null,
        hubId: Number(f.get('hubId')), driverName: f.get('driverName'), driverPhone: f.get('driverPhone')
      });
      toast(`Added ${v.plateNo}`, 'success');
      close();
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

export default {
  title: 'Fleet',

  async mount(root, ctx) {
    s = { ctx, vehicles: [] };
    root.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Vehicles</h2><span class="sub" id="fleet-sum"></span></div>
        <div class="card-body">
          <div class="filters">
            <select class="input" id="v-hub" aria-label="Hub">${hubOptions(ctx.hubs, null, 'All hubs')}</select>
            <select class="input" id="v-status" aria-label="Status"><option value="">All statuses</option><option value="IDLE">Available</option><option value="ON_TRIP">On trip</option><option value="MAINTENANCE">Under maintenance</option></select>
            <select class="input" id="v-type" aria-label="Vehicle type"><option value="">All vehicle types</option>${Object.entries(TYPES).map(([k, [label]]) => `<option value="${k}">${label}</option>`).join('')}</select>
            <span style="flex:1"></span>
            <button class="btn primary" id="add">+ Add vehicle</button>
          </div>
        </div>
        <div class="table-wrap" id="vehicles"><div class="empty">Loading…</div></div>
      </section>`;
    ['#v-hub', '#v-status', '#v-type'].forEach((id) => $(id).addEventListener('change', render));
    $('#add').addEventListener('click', openCreate);
    s.reloadSoon = throttle(() => load().catch(() => {}), 2000);
    await load();
  },

  unmount() {
    s = null;
  },

  onEvent(evt) {
    if (s && ['trip', 'fleet', 'dispatch'].includes(evt.type)) s.reloadSoon();
  }
};
