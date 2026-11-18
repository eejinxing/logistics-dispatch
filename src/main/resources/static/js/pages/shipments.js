import { get, post, query } from '../api.js';
import {
  $, DIRS, DIR_LABEL, STATUS_LABEL, badge, debounce, dirChip, esc, fmtDuration, fmtKg, fmtMoney, fmtNum, fmtTime,
  hubOptions, lane, openDrawer, openModal, promptText, throttle, toast
} from '../ui.js';

let s = null;

const FILTER_KEYS = ['q', 'status', 'originId', 'destinationId', 'direction', 'priority', 'active', 'late', 'merchantId'];

function readFilters() {
  return {
    q: $('#f-q').value.trim(),
    status: $('#f-status').value,
    originId: $('#f-origin').value,
    destinationId: $('#f-dest').value,
    direction: $('#f-dir').value,
    priority: $('#f-priority').value,
    active: $('#f-active').checked,
    late: $('#f-late').checked,
    merchantId: $('#f-merchant').value
  };
}

async function load() {
  if (!s) return;
  const token = s;
  const f = readFilters();
  const data = await get(`/api/shipments${query({ ...f, page: s.page, size: s.size })}`);
  if (s !== token) return;
  const now = s.ctx.simNow();
  const table = $('#table');
  if (!data.items.length) {
    table.innerHTML = '<div class="empty">No matching shipments</div>';
  } else {
    table.innerHTML = `<table class="data"><thead><tr>
        <th>Tracking number</th><th>Route</th><th>Direction</th><th>Status</th><th class="right">Weight</th><th class="right">Shipping fee</th>
        <th>Created at</th><th>Promised delivery</th><th>Trip / Vehicle</th></tr></thead><tbody>
      ${data.items.map((x) => `<tr class="clickable" data-no="${esc(x.trackingNo)}">
        <td><span class="mono">${esc(x.trackingNo)}</span>${x.priority === 'EXPRESS' ? ' <span class="badge express plain">Express</span>' : ''}</td>
        <td>${lane(x.origin, x.destination)}</td>
        <td>${dirChip(x.direction, x.directionLabel)}</td>
        <td>${badge(x.status, x.statusLabel)}</td>
        <td class="right num">${fmtKg(x.weightKg)}</td>
        <td class="right num">${fmtMoney(x.price)}</td>
        <td class="nowrap">${fmtTime(x.createdAt)}</td>
        <td class="nowrap">${fmtTime(x.promisedBy)}${x.late ? ` <span class="badge late plain">${x.status === 'DELIVERED' ? 'Late' : `Overdue ${fmtDuration(now - Date.parse(x.promisedBy))}`}</span>` : ''}</td>
        <td class="nowrap">${x.tripCode ? `<span class="mono">${esc(x.tripCode)}</span> <span class="muted">${esc(x.plateNo)}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`).join('')}</tbody></table>`;
    table.querySelectorAll('tr[data-no]').forEach((tr) => tr.addEventListener('click', () => openShipment(tr.dataset.no, s.ctx, load)));
  }
  $('#pager').innerHTML = `<span>Total ${fmtNum(data.total)} shipments · Page ${data.page + 1} / ${Math.max(1, data.totalPages)} </span>
    <span class="btns"><button class="btn small" id="prev" ${data.page === 0 ? 'disabled' : ''}>Previous</button>
    <button class="btn small" id="next" ${data.page + 1 >= data.totalPages ? 'disabled' : ''}>Next</button></span>`;
  $('#prev').addEventListener('click', () => { s.page--; load(); });
  $('#next').addEventListener('click', () => { s.page++; load(); });
}


export async function openShipment(trackingNo, ctx, onChange) {
  const { el, close } = openDrawer({ title: `Shipment ${trackingNo}`, body: '<div class="empty">Loading…</div>' });
  const body = el.querySelector('.panel-body');

  async function render() {
    let d;
    try {
      d = await get(`/api/shipments/${encodeURIComponent(trackingNo)}`);
    } catch (e) {
      body.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
      return;
    }
    const x = d.shipment;
    const t = d.trip;
    const now = ctx.simNow();
    const actions = [];
    if (x.status === 'CREATED' || (x.status === 'ASSIGNED' && x.currentHub.id === x.origin.id)) actions.push('<button class="btn danger" data-act="cancel">Cancel shipment</button>');
    if (['IN_TRANSIT', 'AT_TRANSFER', 'ARRIVED_HUB', 'OUT_FOR_DELIVERY'].includes(x.status)) actions.push('<button class="btn danger" data-act="exception">Flag exception</button>');
    if (x.status === 'EXCEPTION') actions.push('<button class="btn primary" data-act="resolve">Resolve exception</button>');
    if (x.status === 'OUT_FOR_DELIVERY') actions.push('<button class="btn primary" data-act="deliver">Confirm delivery</button>');
    body.innerHTML = `
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        ${badge(x.status, x.statusLabel)} ${x.priority === 'EXPRESS' ? '<span class="badge express">Express</span>' : '<span class="badge plain">Standard</span>'}
        ${x.late ? '<span class="badge late">Past the delivery deadline</span>' : ''}
        ${x.exceptionReason ? `<span class="badge st-EXCEPTION">${esc(x.exceptionReason)}</span>` : ''}
      </div>
      <dl class="kv">
        <dt>Route</dt><dd>${lane(x.origin, x.destination)} &nbsp;${esc(x.origin.name)} → ${esc(x.destination.name)}</dd>
        <dt>Direction</dt><dd>${dirChip(x.direction, x.directionLabel)} · ${fmtNum(x.distanceKm, 1)} km</dd>
        <dt>Current location</dt><dd>${x.status === 'IN_TRANSIT' && t ? `In transit ${esc(t.origin.code)} → ${esc(t.destination.code)}` : `${esc(x.currentHub.code)} ${esc(x.currentHub.name)}`}
          ${x.status === 'AT_TRANSFER' ? '<span class="badge st-AT_TRANSFER">Awaiting transfer</span>' : ''}</dd>
        <dt>Weight / Shipping fee</dt><dd>${fmtKg(x.weightKg)} · ${fmtMoney(x.price)}</dd>
        <dt>Sender</dt><dd>${x.merchantName ? `<span class="badge plain">Merchant</span> ${esc(x.merchantName)}` : `${esc(x.senderName)} <span class="muted"> (Guest)</span>`}</dd>
        <dt>Recipient</dt><dd>${esc(x.receiverName)} ${x.receiverPhone ? `<span class="muted">${esc(x.receiverPhone)}</span>` : ''}</dd>
        <dt>Address</dt><dd>${esc(x.receiverAddress ?? '—')}</dd>
        <dt>Created at</dt><dd>${fmtTime(x.createdAt)}</dd>
        <dt>Promised delivery</dt><dd>${fmtTime(x.promisedBy)} ${x.status !== 'DELIVERED' && !x.late && x.status !== 'CANCELLED' ? `<span class="muted"> (remaining: ${fmtDuration(Date.parse(x.promisedBy) - now)})</span>` : ''}</dd>
        ${x.deliveredAt ? `<dt>Delivered at</dt><dd>${fmtTime(x.deliveredAt)}</dd>` : ''}
        ${t ? `<dt>Trip</dt><dd><span class="mono">${esc(t.code)}</span> · ${esc(t.plateNo)} (${esc(t.vehicleTypeLabel)}, driver: ${esc(t.driverName)}) · ${badge(t.status, t.statusLabel)}
          <div class="muted" style="font-size:12px">${t.status === 'ARRIVED' ? `Arrived ${fmtTime(t.arrivedAt)}` : `ETA ${fmtTime(t.arriveAt)}`}${t.delayReason ? ` · Delay: ${esc(t.delayReason)}` : ''}</div></dd>` : ''}
      </dl>
      <div class="section-title">Tracking history</div>
      <ul class="timeline">
        ${[...d.events].reverse().map((e, i) => `<li class="${i === 0 ? (e.status === 'EXCEPTION' || e.status === 'CANCELLED' ? 'warn' : 'current') : ''}">
          <div><b>${esc(e.statusLabel)}</b> · ${esc(e.location ?? '')}</div>
          <div class="text-2">${esc(e.note ?? '')}</div><div class="when">${fmtTime(e.occurredAt)}</div></li>`).join('')}
      </ul>`;
    let foot = el.querySelector('.panel-foot');
    if (!foot) {
      foot = document.createElement('div');
      foot.className = 'panel-foot';
      el.appendChild(foot);
    }
    foot.innerHTML = actions.length ? actions.join('') : '<span class="muted">This shipment is closed.</span>';
    foot.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act, x)));
  }

  async function act(action, x) {
    try {
      if (action === 'cancel') {
        const reason = await promptText({ title: 'Cancel shipment', label: 'Cancellation reason (optional)', placeholder: 'e.g. Cancelled at the customer’s request', confirmText: 'Confirm cancellation', danger: true });
        if (reason === null) return;
        await post(`/api/shipments/${x.id}/cancel`, { reason });
        toast(`Shipment ${x.trackingNo} cancelled`, 'success');
      } else if (action === 'exception') {
        const reason = await promptText({ title: 'Flag exception', label: 'Exception reason', placeholder: 'e.g. Damaged parcel or incorrect address', required: true, confirmText: 'Flag exception', danger: true });
        if (reason === null) return;
        await post(`/api/shipments/${x.id}/exception`, { reason });
        toast(`Exception flagged for ${x.trackingNo}`, 'warn');
      } else if (action === 'resolve') {
        const reason = await promptText({ title: 'Resolve exception', label: 'Resolution notes (optional)', placeholder: 'e.g. Agreed to redeliver tomorrow' });
        if (reason === null) return;
        await post(`/api/shipments/${x.id}/resolve`, { reason });
        toast('Exception resolved', 'success');
      } else if (action === 'deliver') {
        await post(`/api/shipments/${x.id}/deliver`);
        toast(`Shipment ${x.trackingNo} delivered`, 'success');
      }
      await render();
      onChange?.();
    } catch (e) {
      toast(e.message, 'error');
      await render();
    }
  }

  await render();
  return close;
}


export async function openCreateShipment(ctx, onCreated, preset = {}) {
  const priority = preset.priority ?? 'STANDARD';
  let merchantList = [];
  try { merchantList = (await get('/api/merchants')).filter((m) => m.active); } catch { }
  const { el, close } = openModal({
    title: 'New shipment',
    body: `<form class="form-grid" id="create-form" autocomplete="off">
        <div class="field"><label>Origin hub</label><select class="input" name="originId" required>${hubOptions(ctx.hubs, preset.originId, 'Select')}</select></div>
        <div class="field"><label>Destination hub</label><select class="input" name="destinationId" required>${hubOptions(ctx.hubs, preset.destinationId, 'Select')}</select></div>
        <div class="field"><label>Weight (kg)</label><input class="input" name="weightKg" type="number" min="0.1" max="5000" step="0.1" value="25" required></div>
        <div class="field"><label>Service</label><select class="input" name="priority"><option value="STANDARD" ${priority === 'STANDARD' ? 'selected' : ''}>Standard (48 hours)</option><option value="EXPRESS" ${priority === 'EXPRESS' ? 'selected' : ''}>Express (24 hours)</option></select></div>
        <div class="field"><label>Merchant</label><select class="input" name="merchantId"><option value="">Guest sender</option>
          ${merchantList.map((m) => `<option value="${m.id}">${esc(m.code)} · ${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Sender (required for guests)</label><input class="input" name="senderName" maxlength="80"></div>
        <div class="field"><label>Recipient</label><input class="input" name="receiverName" maxlength="80" required></div>
        <div class="field"><label>Recipient phone</label><input class="input" name="receiverPhone" maxlength="30"></div>
        <div class="field"><label>Delivery address</label><input class="input" name="receiverAddress" maxlength="200"></div>
        <div class="full"><div class="section-title" style="margin-top:4px">Shipping quote</div><div id="quote" class="quote-box"><span class="muted">Select hubs and enter the parcel weight to get a quote.</span></div></div>
      </form>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="create-submit">Create shipment</button>'
  });
  const form = el.querySelector('#create-form');
  const values = () => {
    const f = new FormData(form);
    return {
      originId: f.get('originId') ? Number(f.get('originId')) : null,
      destinationId: f.get('destinationId') ? Number(f.get('destinationId')) : null,
      weightKg: f.get('weightKg') ? Number(f.get('weightKg')) : null,
      priority: f.get('priority'),
      merchantId: f.get('merchantId') ? Number(f.get('merchantId')) : null,
      senderName: f.get('senderName'),
      receiverName: f.get('receiverName'),
      receiverPhone: f.get('receiverPhone'),
      receiverAddress: f.get('receiverAddress')
    };
  };
  const quoteBox = el.querySelector('#quote');
  const refreshQuote = debounce(async () => {
    const v = values();
    if (!v.originId || !v.destinationId || !v.weightKg) return;
    if (v.originId === v.destinationId) {
      quoteBox.innerHTML = '<span style="color:var(--critical)">Origin and destination hubs must differ.</span>';
      return;
    }
    try {
      const q = await post('/api/shipments/quote', { originId: v.originId, destinationId: v.destinationId, weightKg: v.weightKg, priority: v.priority });
      quoteBox.innerHTML = `
        <div><div class="k">Direction</div><div class="v">${dirChip(q.direction, q.directionLabel)}</div></div>
        <div><div class="k">Distance / Transport</div><div class="v">${fmtNum(q.distanceKm)} km · ${esc(q.mode)}</div></div>
        <div><div class="k">Route</div><div class="v">${q.route.map(esc).join(' → ')}</div></div>
        <div><div class="k">Line-haul time</div><div class="v">About ${q.transitHours} hours</div></div>
        <div><div class="k">Promised delivery</div><div class="v">${fmtTime(q.promisedBy)}</div></div>
        <div><div class="k">Shipping fee</div><div class="v price">${fmtMoney(q.price)}</div></div>`;
    } catch (e) {
      quoteBox.innerHTML = `<span style="color:var(--critical)">${esc(e.message)}</span>`;
    }
  }, 250);
  form.addEventListener('input', refreshQuote);
  form.addEventListener('change', refreshQuote);
  refreshQuote();
  el.querySelector('#create-submit').addEventListener('click', async () => {
    if (!form.reportValidity()) return;
    try {
      const created = await post('/api/shipments', values());
      toast(`Shipment created: ${created.trackingNo} (${created.origin.code} → ${created.destination.code})`, 'success');
      close();
      onCreated?.(created);
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}


export default {
  title: 'Shipments',

  async mount(root, ctx, params) {
    s = { ctx, page: 0, size: 20 };
    const p = Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? '']));
    root.innerHTML = `
      <section class="card">
        <div class="card-body">
          <div class="filters">
            <input class="input search" id="f-q" placeholder="Search tracking numbers / Recipient / Sender / Trip" value="${esc(p.q)}">
            <select class="input" id="f-status" aria-label="Status"><option value="">All statuses</option>
              ${Object.entries(STATUS_LABEL).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
            <select class="input" id="f-origin" aria-label="Origin">${hubOptions(ctx.hubs, p.originId, 'All origins')}</select>
            <select class="input" id="f-dest" aria-label="Destination">${hubOptions(ctx.hubs, p.destinationId, 'All destinations')}</select>
            <select class="input" id="f-dir" aria-label="Direction"><option value="">All directions</option>
              ${DIRS.map((d) => `<option value="${d}" ${p.direction === d ? 'selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select>
            <select class="input" id="f-priority" aria-label="Priority"><option value="">All services</option>
              <option value="STANDARD" ${p.priority === 'STANDARD' ? 'selected' : ''}>Standard</option><option value="EXPRESS" ${p.priority === 'EXPRESS' ? 'selected' : ''}>Express</option></select>
            <select class="input" id="f-merchant" aria-label="Merchant"><option value="">All merchants</option></select>
            <label class="toggle"><input type="checkbox" id="f-active" ${p.active === 'true' ? 'checked' : ''}>Active only</label>
            <label class="toggle"><input type="checkbox" id="f-late" ${p.late === 'true' ? 'checked' : ''}>Overdue only</label>
            <span style="flex:1"></span>
            <button class="btn" id="reset">Reset</button>
            <button class="btn" id="export">Export CSV</button>
            <button class="btn primary" id="create">+ New shipment</button>
          </div>
        </div>
        <div class="table-wrap" id="table"><div class="empty">Loading…</div></div>
        <div class="pager" id="pager"></div>
      </section>`;
    const reload = () => { s.page = 0; load(); };
    $('#f-q').addEventListener('input', debounce(reload, 300));
    ['#f-status', '#f-origin', '#f-dest', '#f-dir', '#f-priority', '#f-merchant', '#f-active', '#f-late'].forEach((id) => $(id).addEventListener('change', reload));
    try {
      const list = await get('/api/merchants');
      $('#f-merchant').insertAdjacentHTML('beforeend', list.map((m) => `<option value="${m.id}" ${String(m.id) === p.merchantId ? 'selected' : ''}>${esc(m.name)}</option>`).join(''));
    } catch { }
    $('#reset').addEventListener('click', () => ctx.go('#/shipments'));
    $('#export').addEventListener('click', () => { window.location.href = `/api/reports/shipments.csv${query(readFilters())}`; });
    $('#create').addEventListener('click', () => openCreateShipment(ctx, (x) => { reload(); openShipment(x.trackingNo, ctx, load); }));
    s.liveReload = throttle(() => { if (s && s.page === 0 && !document.querySelector('.overlay')) load().catch(() => {}); }, 3000);
    await load();
  },

  unmount() {
    s = null;
  },

  onEvent(evt) {
    if (s && (evt.type === 'shipment' || evt.type === 'dispatch')) s.liveReload();
  }
};
