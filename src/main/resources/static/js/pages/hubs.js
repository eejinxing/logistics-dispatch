import { post } from '../api.js';
import { $, esc, fmtNum, openModal, throttle, toast } from '../ui.js';

let s = null;

function render() {
  const el = $('#hub-grid');
  el.innerHTML = s.ctx.hubs.map((h) => `
    <article class="card hub-card">
      <div class="top"><span class="code">${esc(h.code)}</span><b>${esc(h.name)}</b><span class="muted">${esc(h.state)}</span>
        <span style="flex:1"></span><span class="badge plain">${esc(h.landmassLabel)}</span></div>
      <div class="stats">
        <div><span class="muted">Awaiting dispatch</span><b>${fmtNum(h.pendingOutbound)}</b></div>
        <div><span class="muted">Outbound in transit</span><b>${fmtNum(h.activeOutbound)}</b></div>
        <div><span class="muted">Inbound in transit</span><b>${fmtNum(h.activeInbound)}</b></div>
        <div><span class="muted">Vehicles available / total</span><b>${fmtNum(h.vehiclesIdle)} / ${fmtNum(h.vehiclesTotal)}</b></div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn small" href="#/dashboard?originId=${h.id}">Shipment directions</a>
        <a class="btn small" href="#/shipments?originId=${h.id}&active=true">Outbound shipments</a>
        <a class="btn small" href="#/shipments?destinationId=${h.id}&active=true">Inbound shipments</a>
      </div>
    </article>`).join('');
}

async function load() {
  if (!s) return;
  await s.ctx.refreshHubs();
  if (s) render();
}

function openCreate() {
  const { el, close } = openModal({
    title: 'Add hub',
    body: `<form class="form-grid" id="hub-form" autocomplete="off">
      <div class="field"><label>Hub code (3-5 letters)</label><input class="input" name="code" maxlength="5" pattern="[A-Za-z]{3,5}" required></div>
      <div class="field"><label>Name</label><input class="input" name="name" maxlength="80" placeholder="e.g. Johor Bahru North" required></div>
      <div class="field"><label>State</label><input class="input" name="state" maxlength="40" required></div>
      <div class="field"><label>Region</label><select class="input" name="landmass"><option value="PENINSULAR">Peninsular Malaysia</option><option value="BORNEO">East Malaysia</option></select></div>
      <div class="field"><label>Latitude</label><input class="input" name="lat" type="number" step="0.0001" min="0.5" max="7.5" required></div>
      <div class="field"><label>Longitude</label><input class="input" name="lng" type="number" step="0.0001" min="99.5" max="119.5" required></div>
    </form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="hub-ok">Save</button>'
  });
  el.querySelector('#hub-ok').addEventListener('click', async () => {
    const form = el.querySelector('#hub-form');
    if (!form.reportValidity()) return;
    const f = new FormData(form);
    try {
      const h = await post('/api/hubs', {
        code: f.get('code'), name: f.get('name'), state: f.get('state'), landmass: f.get('landmass'),
        lat: Number(f.get('lat')), lng: Number(f.get('lng'))
      });
      toast(`Hub added ${h.code}`, 'success');
      close();
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

export default {
  title: 'Hub',

  async mount(root, ctx) {
    s = { ctx };
    root.innerHTML = `
      <div class="filters"><span class="text-2">Review shipment volumes and vehicle availability by hub. Select Shipment directions to see where outbound freight is headed.</span>
        <span style="flex:1"></span><button class="btn primary" id="add">+ Add hub</button></div>
      <div class="hub-grid" id="hub-grid"></div>`;
    $('#add').addEventListener('click', openCreate);
    s.reloadSoon = throttle(() => load().catch(() => {}), 3000);
    await load();
  },

  unmount() {
    s = null;
  },

  onEvent() {
    s?.reloadSoon();
  }
};
