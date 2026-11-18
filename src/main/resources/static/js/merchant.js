import { get, post, query } from './api.js';
import { renderRose } from './charts.js';
import { createClock } from './clock.js';
import { FreightMap } from './map.js';
import {
  $, $$, DIRS, DIR_LABEL, STATUS_LABEL, badge, debounce, dirChip, esc, fmtDuration, fmtFull, fmtKg, fmtMoney, fmtNum,
  fmtPct, fmtTime, hubOptions, lane, openDrawer, promptText, stepper, toast
} from './ui.js';

const clock = createClock();
const ctx = { hubs: [], hubsById: new Map(), simNow: clock.now, profile: null };
let current = null;


function kpi(label, value, hint, alert = false) {
  return `<div class="card kpi${alert ? ' alert' : ''}"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

function shipmentRows(items, onOpen) {
  if (!items.length) return '<div class="empty">No shipments yet. “Create shipment” to send your first parcel.</div>';
  const now = clock.now();
  return `<table class="data"><thead><tr><th>Tracking number</th><th>Recipient</th><th>Route</th><th>Direction</th><th>Status</th>
      <th class="right">Weight</th><th class="right">Shipping fee</th><th>Created at</th><th>Promised delivery</th></tr></thead><tbody>
    ${items.map((x) => `<tr class="clickable" data-no="${esc(x.trackingNo)}">
      <td><span class="mono">${esc(x.trackingNo)}</span>${x.priority === 'EXPRESS' ? ' <span class="badge express plain">Express</span>' : ''}</td>
      <td>${esc(x.receiverName)}</td><td>${lane(x.origin, x.destination)}</td><td>${dirChip(x.direction, x.directionLabel)}</td>
      <td>${badge(x.status, x.statusLabel)}</td><td class="right num">${fmtKg(x.weightKg)}</td>
      <td class="right num">${fmtMoney(x.price)}</td><td class="nowrap">${fmtTime(x.createdAt)}</td>
      <td class="nowrap">${fmtTime(x.promisedBy)}${x.late ? ` <span class="badge late plain">${x.status === 'DELIVERED' ? 'Late' : `Overdue ${fmtDuration(now - Date.parse(x.promisedBy))}`}</span>` : ''}</td>
    </tr>`).join('')}</tbody></table>`;
}

function bindRows(root, onChange) {
  root.querySelectorAll('tr[data-no]').forEach((tr) => tr.addEventListener('click', () => openParcel(tr.dataset.no, onChange)));
}

async function openParcel(trackingNo, onChange) {
  const { el, close } = openDrawer({ title: `Shipment ${trackingNo}`, body: '<div class="empty">Loading…</div>' });
  const body = el.querySelector('.panel-body');
  async function render() {
    let d;
    try {
      d = await get(`/api/merchant/shipments/${encodeURIComponent(trackingNo)}`);
    } catch (e) {
      body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const x = d.shipment;
    const t = d.trip;
    body.innerHTML = `
      <div class="big-status">${badge(x.status, x.statusLabel)}<b>${esc(x.origin.name)} → ${esc(x.destination.name)}</b>
        ${x.late ? '<span class="badge late">Overdue</span>' : ''}</div>
      ${stepper(x.status, x.currentHub.id === x.destination.id)}
      <dl class="kv">
        <dt>Recipient</dt><dd>${esc(x.receiverName)} <span class="muted">${esc(x.receiverPhone ?? '')}</span></dd>
        <dt>Address</dt><dd>${esc(x.receiverAddress ?? '—')}</dd>
        <dt>Direction</dt><dd>${dirChip(x.direction, x.directionLabel)} · ${fmtNum(x.distanceKm, 1)} km</dd>
        <dt>Current location</dt><dd>${x.status === 'IN_TRANSIT' && t ? `In transit ${esc(t.origin.code)} → ${esc(t.destination.code)}` : `${esc(x.currentHub.code)} ${esc(x.currentHub.name)}`}</dd>
        <dt>Weight / Shipping fee</dt><dd>${fmtKg(x.weightKg)} · ${fmtMoney(x.price)} · ${esc(x.priorityLabel)}</dd>
        <dt>Created / Promised</dt><dd>${fmtTime(x.createdAt)} / ${fmtTime(x.promisedBy)}</dd>
        ${x.deliveredAt ? `<dt>Delivered at</dt><dd>${fmtTime(x.deliveredAt)}</dd>` : ''}
        ${t ? `<dt>Trip</dt><dd><span class="mono">${esc(t.code)}</span> · ${esc(t.vehicleTypeLabel)} · ${badge(t.status, t.statusLabel)}</dd>` : ''}
      </dl>
      <p class="text-2" style="font-size:13px">Recipients can register with ${esc(x.receiverPhone ?? 'their mobile number')} for live tracking or enter the tracking number on the sign-in page.</p>
      <div class="section-title">Tracking history</div>
      <ul class="timeline">${[...d.events].reverse().map((e, i) => `
        <li class="${i === 0 ? (e.status === 'EXCEPTION' || e.status === 'CANCELLED' ? 'warn' : 'current') : ''}">
          <div><b>${esc(e.statusLabel)}</b> · ${esc(e.location ?? '')}</div><div class="text-2">${esc(e.note ?? '')}</div>
          <div class="when">${fmtTime(e.occurredAt)}</div></li>`).join('')}</ul>`;
    let foot = el.querySelector('.panel-foot');
    if (!foot) {
      foot = document.createElement('div');
      foot.className = 'panel-foot';
      el.appendChild(foot);
    }
    const cancellable = x.status === 'CREATED' || (x.status === 'ASSIGNED' && x.currentHub.id === x.origin.id);
    foot.innerHTML = cancellable ? '<button class="btn danger" data-cancel>Cancel shipment</button>' : '<span class="muted">The parcel has already left. Contact support if you need help.</span>';
    foot.querySelector('[data-cancel]')?.addEventListener('click', async () => {
      const reason = await promptText({ title: 'Cancel shipment', label: 'Cancellation reason (optional)', confirmText: 'Confirm cancellation', danger: true });
      if (reason === null) return;
      try {
        await post(`/api/merchant/shipments/${x.id}/cancel`, { reason });
        toast(`Shipment ${x.trackingNo} cancelled`, 'success');
        await render();
        onChange?.();
      } catch (e) {
        toast(e.message, 'error');
      }
    });
  }
  await render();
  return close;
}


const dashboard = {
  title: 'Overview',
  async mount(root) {
    root.innerHTML = `
      <div class="grid kpis" id="kpis"></div>
      <div class="grid main-split">
        <section class="card"><div class="card-head"><h2>Shipment destinations</h2><span class="sub">Line width shows shipment volume.</span></div>
          <div class="map" id="map" style="margin-top:12px"></div></section>
        <section class="card"><div class="card-head"><h2>By direction</h2></div><div class="card-body" id="rose"></div></section>
      </div>
      <section class="card"><div class="card-head"><h2>Recent shipments</h2><span style="flex:1"></span><a class="btn small" href="#/shipments">All shipments</a></div>
        <div class="card-body flush"><div class="table-wrap" id="recent"></div></div></section>`;
    this.map = new FreightMap($('#map'), ctx);
    this.map.setHubs(ctx.hubs);
    await this.load();
    this.timer = setInterval(() => this.load().catch(() => {}), 15000);
  },
  async load() {
    const d = await get('/api/merchant/dashboard');
    if (current?.page !== this) return;
    const c = Object.fromEntries(d.statuses.map((s) => [s.status, s.count]));
    const moving = (c.ASSIGNED ?? 0) + (c.IN_TRANSIT ?? 0) + (c.AT_TRANSFER ?? 0) + (c.ARRIVED_HUB ?? 0) + (c.OUT_FOR_DELIVERY ?? 0);
    $('#kpis').innerHTML = [
      kpi('On the way', fmtNum(moving), `Out for delivery ${fmtNum(c.OUT_FOR_DELIVERY)} · At transfer ${fmtNum(c.AT_TRANSFER)}`),
      kpi('Awaiting dispatch', fmtNum(c.CREATED), 'Created and awaiting loading'),
      kpi('Shipments today', fmtNum(d.createdToday), `Shipping fee ${fmtMoney(d.spendToday)}`),
      kpi('Last 30 days', `${fmtNum(d.created30d)} shipments`, `Shipping fee ${fmtMoney(d.spend30d)}`),
      kpi('30-day on-time rate', fmtPct(d.onTimeRate30d), `${fmtNum(d.delivered30d)} shipments delivered`),
      kpi('Overdue / Exception', `${fmtNum(d.late)} / ${fmtNum(c.EXCEPTION)}`, 'Shipments needing attention', d.late + (c.EXCEPTION ?? 0) > 0)
    ].join('');
    renderRose($('#rose'), d.directions, { onPick: (dir) => go(`#/shipments?direction=${dir}`) });
    this.map.setFlows(d.lanes);
    $('#recent').innerHTML = shipmentRows(d.recent);
    bindRows($('#recent'), () => this.load());
  },
  unmount() {
    clearInterval(this.timer);
    this.map?.destroy();
  }
};

const ship = {
  title: 'Create shipment',
  async mount(root) {
    const home = ctx.profile.defaultHub;
    root.innerHTML = `
      <section class="card" style="max-width:860px">
        <div class="card-head"><h2>Shipment details</h2><span class="sub">Sender: ${esc(ctx.profile.name)}</span></div>
        <div class="card-body">
          <form class="form-grid" id="ship-form" autocomplete="off">
            <div class="field"><label>Collection hub</label><select class="input" name="originId">${hubOptions(ctx.hubs, home.id)}</select></div>
            <div class="field"><label>Destination hub</label><select class="input" name="destinationId" required>${hubOptions(ctx.hubs.filter((h) => h.id !== home.id), null, 'Select')}</select></div>
            <div class="field"><label>Recipient</label><input class="input" name="receiverName" maxlength="80" required></div>
            <div class="field"><label>Recipient phone (used for tracking)</label><input class="input" name="receiverPhone" maxlength="30" placeholder="012-345 6789" required></div>
            <div class="field full"><label>Delivery address</label><input class="input" name="receiverAddress" maxlength="200"></div>
            <div class="field"><label>Weight (kg)</label><input class="input" name="weightKg" type="number" min="0.1" max="5000" step="0.1" value="5" required></div>
            <div class="field"><label>Service</label><select class="input" name="priority"><option value="STANDARD">Standard (48 hours)</option><option value="EXPRESS">Express (24 hours)</option></select></div>
            <div class="full"><div class="section-title" style="margin-top:4px">Shipping quote</div><div id="quote" class="quote-box"><span class="muted">Select a destination hub to get a quote.</span></div></div>
          </form>
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn primary" id="ship-submit">Confirm shipment</button></div>
          <div id="ship-result" style="margin-top:14px"></div>
        </div>
      </section>`;
    const form = $('#ship-form');
    const values = () => {
      const f = new FormData(form);
      return {
        originId: Number(f.get('originId')), destinationId: f.get('destinationId') ? Number(f.get('destinationId')) : null,
        receiverName: f.get('receiverName'), receiverPhone: f.get('receiverPhone'), receiverAddress: f.get('receiverAddress'),
        weightKg: f.get('weightKg') ? Number(f.get('weightKg')) : null, priority: f.get('priority')
      };
    };
    const quote = debounce(async () => {
      const v = values();
      if (!v.destinationId || !v.weightKg) return;
      if (v.originId === v.destinationId) {
        $('#quote').innerHTML = '<span style="color:var(--critical)">Collection and destination hubs must differ.</span>';
        return;
      }
      try {
        const q = await post('/api/merchant/shipments/quote', { originId: v.originId, destinationId: v.destinationId, weightKg: v.weightKg, priority: v.priority });
        $('#quote').innerHTML = `
          <div><div class="k">Direction</div><div class="v">${dirChip(q.direction, q.directionLabel)}</div></div>
          <div><div class="k">Route</div><div class="v">${q.route.map(esc).join(' → ')}</div></div>
          <div><div class="k">Transport / Distance</div><div class="v">${esc(q.mode)} · ${fmtNum(q.distanceKm)} km</div></div>
          <div><div class="k">Promised delivery</div><div class="v">${fmtTime(q.promisedBy)}</div></div>
          <div><div class="k">Shipping fee</div><div class="v price">${fmtMoney(q.price)}</div></div>`;
      } catch (e) {
        $('#quote').innerHTML = `<span style="color:var(--critical)">${esc(e.message)}</span>`;
      }
    }, 250);
    form.addEventListener('input', quote);
    form.addEventListener('change', quote);
    $('#ship-submit').addEventListener('click', async (e) => {
      if (!form.reportValidity()) return;
      e.target.disabled = true;
      try {
        const x = await post('/api/merchant/shipments', values());
        $('#ship-result').innerHTML = `<div class="success-box"><b>Shipment created</b> Tracking number <span class="mono">${esc(x.trackingNo)}</span>
          · ${esc(x.origin.code)} → ${esc(x.destination.code)} (${esc(x.directionLabel)}) · Shipping fee ${fmtMoney(x.price)}
          <div class="text-2" style="margin-top:6px;font-size:13px">Share the tracking number with ${esc(x.receiverName)}. The recipient can track it on the sign-in page or register with ${esc(x.receiverPhone)} for live updates.</div>
          <div style="margin-top:10px;display:flex;gap:8px"><button class="btn small" id="open-new">View shipment</button><button class="btn small" id="copy-no">Copy tracking number</button></div></div>`;
        $('#open-new').addEventListener('click', () => openParcel(x.trackingNo));
        $('#copy-no').addEventListener('click', () => navigator.clipboard?.writeText(x.trackingNo).then(() => toast('Copied', 'success')));
        form.querySelector('[name=receiverName]').value = '';
        form.querySelector('[name=receiverPhone]').value = '';
        form.querySelector('[name=receiverAddress]').value = '';
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        e.target.disabled = false;
      }
    });
  }
};

const shipments = {
  title: 'My shipments',
  async mount(root, params) {
    this.page = 0;
    const p = (k) => params.get(k) ?? '';
    root.innerHTML = `
      <section class="card">
        <div class="card-body"><div class="filters">
          <input class="input search" id="f-q" placeholder="Search tracking numbers / Recipient" value="${esc(p('q'))}">
          <select class="input" id="f-status" aria-label="Status"><option value="">All statuses</option>
            ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${p('status') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <select class="input" id="f-dir" aria-label="Direction"><option value="">All directions</option>
            ${DIRS.map((d) => `<option value="${d}" ${p('direction') === d ? 'selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select>
          <label class="toggle"><input type="checkbox" id="f-active">Active only</label>
          <label class="toggle"><input type="checkbox" id="f-late">Overdue only</label>
          <span style="flex:1"></span>
          <a class="btn" href="/api/merchant/shipments.csv">Export CSV</a>
          <a class="btn primary" href="#/ship">+ New shipment</a>
        </div></div>
        <div class="table-wrap" id="table"><div class="empty">Loading…</div></div>
        <div class="pager" id="pager"></div>
      </section>`;
    const reload = () => { this.page = 0; this.load(); };
    $('#f-q').addEventListener('input', debounce(reload, 300));
    ['#f-status', '#f-dir', '#f-active', '#f-late'].forEach((id) => $(id).addEventListener('change', reload));
    await this.load();
    this.timer = setInterval(() => { if (!document.querySelector('.overlay')) this.load().catch(() => {}); }, 15000);
  },
  async load() {
    const data = await get(`/api/merchant/shipments${query({
      q: $('#f-q').value.trim(), status: $('#f-status').value, direction: $('#f-dir').value,
      active: $('#f-active').checked, late: $('#f-late').checked, page: this.page, size: 20
    })}`);
    if (current?.page !== this) return;
    $('#table').innerHTML = shipmentRows(data.items);
    bindRows($('#table'), () => this.load());
    $('#pager').innerHTML = `<span>Total ${fmtNum(data.total)} shipments · Page ${data.page + 1} / ${Math.max(1, data.totalPages)} </span>
      <span class="btns"><button class="btn small" id="prev" ${data.page === 0 ? 'disabled' : ''}>Previous</button>
      <button class="btn small" id="next" ${data.page + 1 >= data.totalPages ? 'disabled' : ''}>Next</button></span>`;
    $('#prev').addEventListener('click', () => { this.page--; this.load(); });
    $('#next').addEventListener('click', () => { this.page++; this.load(); });
  },
  unmount() {
    clearInterval(this.timer);
  }
};

const profile = {
  title: 'Business profile',
  async mount(root) {
    const m = await get('/api/merchant/profile');
    root.innerHTML = `
      <section class="card" style="max-width:640px"><div class="card-head"><h2>${esc(m.name)}</h2><span class="badge plain">${m.active ? 'Active' : 'Disabled'}</span></div>
        <div class="card-body"><dl class="kv">
          <dt>Merchant ID</dt><dd class="mono">${esc(m.code)}</dd>
          <dt>Contact</dt><dd>${esc(m.contactName ?? '—')}</dd>
          <dt>Phone</dt><dd>${esc(m.phone ?? '—')}</dd>
          <dt>Collection hub</dt><dd>${esc(m.defaultHub.code)} ${esc(m.defaultHub.name)}</dd>
          <dt>Account</dt><dd>${m.usernames.map(esc).join(', ') || '—'}</dd>
          <dt>Total shipments</dt><dd>${fmtNum(m.shipments)} shipments (active: ${fmtNum(m.activeShipments)})</dd>
          <dt>Last 30 days of shipping fees</dt><dd>${fmtMoney(m.revenue30d)}</dd>
          <dt>Joined</dt><dd>${fmtTime(m.createdAt)}</dd>
        </dl><p class="text-2" style="font-size:13px;margin-bottom:0">Contact an administrator to update your profile or add a sign-in account.</p></div></section>`;
  }
};


const PAGES = { dashboard, ship, shipments, profile };

function go(hash) {
  location.hash = hash;
}

async function route() {
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const page = PAGES[path] ?? dashboard;
  try { current?.page.unmount?.(); } catch (e) { console.error(e); }
  current = { page };
  $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (PAGES[path] ? path : 'dashboard')));
  $('#page-title').textContent = page.title;
  document.title = `${page.title} · Merchant portal`;
  const view = $('#view');
  view.innerHTML = '';
  try {
    await page.mount(view, new URLSearchParams(qs || ''));
  } catch (e) {
    view.innerHTML = `<div class="card"><div class="empty">Could not load the page: ${esc(e.message)}</div></div>`;
  }
}

async function boot() {
  let me;
  try {
    me = await get('/api/me');
  } catch {
    return;
  }
  if (me.role !== 'MERCHANT') {
    location.href = me.home || '/';
    return;
  }
  $('#me').textContent = me.username;
  $('#logout').addEventListener('click', async () => {
    try { await post('/api/auth/logout'); } finally { location.href = '/login.html'; }
  });
  await clock.sync();
  const [hubs, profileData] = await Promise.all([get('/api/network/hubs'), get('/api/merchant/profile')]);
  ctx.hubs = hubs;
  ctx.hubsById = new Map(hubs.map((h) => [h.id, h]));
  ctx.profile = profileData;
  $('#shop-name').textContent = profileData.name;
  const tick = () => { $('#sim-now').textContent = fmtFull(clock.now()); };
  tick();
  setInterval(tick, 1000);
  setInterval(() => clock.sync(), 15000);
  window.addEventListener('hashchange', route);
  route();
}

boot();
