import { get, post, query } from '../api.js';
import {
  $, DIRS, DIR_LABEL, STATUS_LABEL, ZONE, badge, debounce, dirChip, esc, fmtDuration, fmtKg, fmtMoney, fmtNum, fmtTime,
  hubOptions, lane, openDrawer, openModal, promptText, throttle, toast
} from '../ui.js';

let s = null;

const SHIPMENT_VIEWS = [
  { id: 'all', label: 'All shipments', statuses: [] },
  { id: 'pending', label: 'Pending', statuses: ['CREATED', 'AT_TRANSFER'] },
  { id: 'arrived', label: 'Arrived', statuses: ['ARRIVED_HUB', 'OUT_FOR_DELIVERY', 'DELIVERED'] }
];
const COLUMNS = [
  ['id', 'Shipment ID'], ['events', 'Shipment event'], ['status', 'Status'], ['arrival', 'Expected arrival'],
  ['route', 'Route'], ['trip', 'Trip / Vehicle'], ['direction', 'Direction'], ['weight', 'Weight'],
  ['fee', 'Shipping fee'], ['created', 'Created at'], ['actions', 'Actions']
];
const SHORT_DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: ZONE });
const DATE_FILTER = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>';
const STAGES = [
  ['Booked', '<path d="m3 7 9-4 9 4v10l-9 4-9-4zm0 0 9 4 9-4m-9 4v10"/>'],
  ['Loaded', '<path d="M3 20V8l9-5 9 5v12M7 20v-8h10v8m-10-4h10m-14 4h18"/>'],
  ['In transit', '<path d="M3 6h12v10H3zm12 4h4l2 3v3h-6"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>'],
  ['Delivered', '<path d="m5 12 4.5 4.5L19 7"/>']
];
const CHECKPOINTS = { CREATED: 1, ASSIGNED: 2, IN_TRANSIT: 3, AT_TRANSFER: 3, ARRIVED_HUB: 3,
  OUT_FOR_DELIVERY: 3, DELIVERED: 4, EXCEPTION: 3, CANCELLED: 1 };

function selectedStatuses(root) {
  return Array.from(root.querySelectorAll('[data-shipment-status]:checked'), input => input.value);
}

function readFilters(root) {
  return {
    q: $('#f-q', root).value.trim(),
    statuses: selectedStatuses(root).join(','),
    from: $('#f-from', root).value,
    to: $('#f-to', root).value,
    originId: $('#f-origin', root).value,
    destinationId: $('#f-dest', root).value,
    direction: $('#f-dir', root).value,
    priority: $('#f-priority', root).value,
    active: $('#f-active', root).checked,
    late: $('#f-late', root).checked,
    merchantId: $('#f-merchant', root).value
  };
}

function shipmentStages(status, statusLabel) {
  const reached = CHECKPOINTS[status] ?? 0;
  return `<div class="shipment-stages" role="img" aria-label="${esc(statusLabel)}" style="--stage-progress:${Math.max(0, reached - 1) / 3 * 100}%">
    ${STAGES.map(([label, icon], i) => `<span class="${i < reached ? 'is-reached' : ''}" title="${label}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>
    </span>`).join('')}
  </div>`;
}

function shipmentRow(x, columns, now) {
  const fields = {
    id: `<b class="shipment-id">${esc(x.trackingNo)}</b>${x.priority === 'EXPRESS' ? ' <span class="badge express plain">Express</span>' : ''}`,
    events: shipmentStages(x.status, x.statusLabel),
    status: `<span class="shipment-statuses">${badge(x.status, x.statusLabel)}${x.late
      ? `<span class="badge late" title="${x.status === 'DELIVERED' ? 'Delivered after the deadline' : `Overdue by ${fmtDuration(now - Date.parse(x.promisedBy))}`}">${x.status === 'DELIVERED' ? 'Late' : 'Overdue'}</span>` : ''}</span>`,
    arrival: `<time datetime="${esc(x.promisedBy)}" title="${fmtTime(x.promisedBy)}">${SHORT_DATE.format(new Date(x.promisedBy))}</time>`,
    route: lane(x.origin, x.destination),
    trip: x.tripCode ? `<span class="shipment-trip"><b>${esc(x.plateNo)}</b><small>${esc(x.tripCode)}</small></span>` : '<span class="muted">—</span>',
    direction: dirChip(x.direction, x.directionLabel),
    weight: fmtKg(x.weightKg),
    fee: fmtMoney(x.price),
    created: fmtTime(x.createdAt),
    actions: `<button type="button" class="btn small ghost shipment-row-open" aria-label="Open shipment ${esc(x.trackingNo)}">⋯</button>`
  };
  return `<tr class="clickable" data-no="${esc(x.trackingNo)}">${columns.map(([key]) => key === 'id'
    ? `<th scope="row" class="shipment-col-id">${fields.id}</th>`
    : `<td class="shipment-col-${key}">${fields[key]}</td>`).join('')}</tr>`;
}

function renderShipments(current) {
  const { data, root, hiddenColumns } = current;
  if (!data) return;
  const table = $('#table', root);
  const focused = table.contains(document.activeElement) ? document.activeElement.closest('[data-no]')?.dataset.no : null;
  const columns = COLUMNS.filter(([key]) => !hiddenColumns.has(key));
  table.innerHTML = data.items.length ? `<table class="data shipment-table">
    <thead><tr>${columns.map(([key, label]) => `<th scope="col" class="shipment-col-${key}">${label}</th>`).join('')}</tr></thead>
    <tbody>${data.items.map(x => shipmentRow(x, columns, current.ctx.simNow())).join('')}</tbody>
  </table>` : '<div class="empty">No matching shipments</div>';
  if (focused) table.querySelector(`[data-no="${CSS.escape(focused)}"] button`)?.focus({ preventScroll: true });
}

async function load(current = s) {
  if (!current || current !== s) return;
  const version = ++current.version;
  const { root } = current;
  const filters = readFilters(root);
  const table = $('#table', root);
  const pager = $('#pager', root);
  try {
    if (filters.from && filters.to && filters.from > filters.to) throw new Error('The start date must be on or before the end date.');
    const data = await get(`/api/shipments${query({ ...filters, page: current.page, size: current.size })}`);
    if (current !== s || current.version !== version) return;
    if (data.totalPages > 0 && data.page >= data.totalPages) {
      current.page = data.totalPages - 1;
      return load(current);
    }
    current.data = data;
    renderShipments(current);
    const buttons = pager.querySelectorAll('[data-page-step]');
    $('.shipment-page-count', pager).textContent = `${fmtNum(data.total)} shipments · Page ${data.page + 1} of ${Math.max(1, data.totalPages)}`;
    buttons[0].disabled = data.page === 0;
    buttons[1].disabled = data.page + 1 >= data.totalPages;
    pager.hidden = false;
  } catch (error) {
    if (current !== s || current.version !== version) return;
    current.data = null;
    table.innerHTML = `<div class="empty" role="status">${esc(error.message)}</div>`;
    pager.hidden = true;
  }
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

function updateFilterLabels(root) {
  const statuses = selectedStatuses(root);
  root.querySelectorAll('[data-shipment-view]').forEach(button => {
    const view = SHIPMENT_VIEWS.find(item => item.id === button.dataset.shipmentView);
    button.setAttribute('aria-pressed', String(view.statuses.length === statuses.length && view.statuses.every(status => statuses.includes(status))));
  });
  $('#shipment-status-label', root).textContent = statuses.length === 1 ? STATUS_LABEL[statuses[0]]
    : statuses.length ? `${statuses.length} statuses` : 'All shipment statuses';
  const from = $('#f-from', root).value;
  const to = $('#f-to', root).value;
  const date = value => DATE_FILTER.format(new Date(value));
  $('#shipment-date-label', root).textContent = from && to ? `${date(from)} – ${date(to)}`
    : from ? `From ${date(from)}` : to ? `Through ${date(to)}` : 'Created date';
}

export default {
  title: 'Shipments',

  async mount(root, ctx, params) {
    const current = { root, ctx, page: 0, size: 20, version: 0, data: null,
      hiddenColumns: new Set(['direction', 'weight', 'fee', 'created']) };
    s = current;
    const p = Object.fromEntries(params);
    const selected = (p.statuses ?? p.status ?? '').split(',');
    root.innerHTML = `
      <section class="card shipments-workspace" aria-labelledby="shipment-list-title">
        <header class="shipment-heading">
          <h2 id="shipment-list-title">Shipment list</h2>
          <button type="button" class="btn primary" id="create"><span aria-hidden="true">+</span> Add shipment</button>
        </header>
        <div class="shipment-views" role="group" aria-label="Shipment views">
          ${SHIPMENT_VIEWS.map(({ id, label }) => `<button type="button" data-shipment-view="${id}">${label}</button>`).join('')}
        </div>
        <div class="shipment-toolbar">
          <label class="shipment-search">${SEARCH_ICON}<input type="search" id="f-q" aria-label="Search shipments" placeholder="Search shipments" maxlength="40" value="${esc(p.q)}"></label>
          <details class="shipment-menu">
            <summary class="btn small"><span id="shipment-date-label">Created date</span></summary>
            <div class="shipment-menu-body shipment-date-menu">
              <label class="field"><span>From</span><input class="input" type="date" id="f-from" data-shipment-filter value="${esc(p.from)}"></label>
              <label class="field"><span>Through</span><input class="input" type="date" id="f-to" data-shipment-filter value="${esc(p.to)}"></label>
              <button type="button" class="btn small ghost" id="clear-shipment-dates">Clear dates</button>
            </div>
          </details>
          <details class="shipment-menu">
            <summary class="btn small"><span id="shipment-status-label">All shipment statuses</span></summary>
            <div class="shipment-menu-body shipment-option-list">
              ${Object.entries(STATUS_LABEL).map(([key, label]) => `<label><input type="checkbox" data-shipment-status data-shipment-filter value="${key}" ${selected.includes(key) ? 'checked' : ''}>${badge(key, label)}</label>`).join('')}
            </div>
          </details>
          <details class="shipment-menu">
            <summary class="btn small">Advanced filters</summary>
            <div class="shipment-menu-body shipment-advanced">
              <label class="field"><span>Origin</span><select class="input" id="f-origin" data-shipment-filter>${hubOptions(ctx.hubs, p.originId, 'All origins')}</select></label>
              <label class="field"><span>Destination</span><select class="input" id="f-dest" data-shipment-filter>${hubOptions(ctx.hubs, p.destinationId, 'All destinations')}</select></label>
              <label class="field"><span>Direction</span><select class="input" id="f-dir" data-shipment-filter><option value="">All directions</option>
                ${DIRS.map(d => `<option value="${d}" ${p.direction === d ? 'selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select></label>
              <label class="field"><span>Service</span><select class="input" id="f-priority" data-shipment-filter><option value="">All services</option>
                <option value="STANDARD" ${p.priority === 'STANDARD' ? 'selected' : ''}>Standard</option><option value="EXPRESS" ${p.priority === 'EXPRESS' ? 'selected' : ''}>Express</option></select></label>
              <label class="field"><span>Merchant</span><select class="input" id="f-merchant" data-shipment-filter><option value="">All merchants</option></select></label>
              <label class="toggle"><input type="checkbox" id="f-active" data-shipment-filter ${p.active === 'true' ? 'checked' : ''}>Active only</label>
              <label class="toggle"><input type="checkbox" id="f-late" data-shipment-filter ${p.late === 'true' ? 'checked' : ''}>Overdue only</label>
            </div>
          </details>
          <button type="button" class="btn small ghost" id="reset">Reset</button>
          <div class="shipment-table-tools">
            <button type="button" class="btn small" id="export">Export CSV</button>
            <details class="shipment-menu shipment-columns">
              <summary class="btn small">Manage table</summary>
              <div class="shipment-menu-body shipment-option-list">
                ${COLUMNS.slice(1, -1).map(([key, label]) => `<label><input type="checkbox" data-shipment-column value="${key}" ${current.hiddenColumns.has(key) ? '' : 'checked'}>${label}</label>`).join('')}
              </div>
            </details>
          </div>
        </div>
        <div class="table-wrap" id="table" role="region" aria-label="Shipments table" tabindex="0"><div class="empty">Loading…</div></div>
        <div class="pager" id="pager" hidden>
          <span class="shipment-page-count" aria-live="polite"></span>
          <span class="btns"><button type="button" class="btn small" data-page-step="-1">Previous</button>
            <button type="button" class="btn small" data-page-step="1">Next</button></span>
        </div>
      </section>`;
    const reload = () => {
      if (s !== current) return;
      current.page = 0;
      updateFilterLabels(root);
      load(current);
    };
    updateFilterLabels(root);
    $('#f-q', root).addEventListener('input', debounce(reload, 300));
    $('.shipment-views', root).addEventListener('click', event => {
      const view = SHIPMENT_VIEWS.find(item => item.id === event.target.closest('[data-shipment-view]')?.dataset.shipmentView);
      if (!view) return;
      root.querySelectorAll('[data-shipment-status]').forEach(input => { input.checked = view.statuses.includes(input.value); });
      reload();
    });
    $('.shipment-toolbar', root).addEventListener('change', ({ target }) => {
      if (target.matches('[data-shipment-filter]')) reload();
      if (target.matches('[data-shipment-column]')) {
        if (target.checked) current.hiddenColumns.delete(target.value);
        else current.hiddenColumns.add(target.value);
        renderShipments(current);
      }
    });
    const menus = [...root.querySelectorAll('.shipment-menu')];
    for (const menu of menus) {
      menu.addEventListener('toggle', () => {
        if (menu.open) menus.filter(other => other !== menu).forEach(other => { other.open = false; });
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
    $('#clear-shipment-dates', root).addEventListener('click', () => {
      $('#f-from', root).value = '';
      $('#f-to', root).value = '';
      reload();
    });
    $('#table', root).addEventListener('click', event => {
      const row = event.target.closest('tr[data-no]');
      if (row) openShipment(row.dataset.no, ctx, () => load(current));
    });
    $('#pager', root).addEventListener('click', event => {
      const step = event.target.closest('[data-page-step]');
      if (!step || step.disabled) return;
      current.page = Math.max(0, Math.min(current.data.totalPages - 1, current.page + Number(step.dataset.pageStep)));
      load(current);
    });
    $('#reset', root).addEventListener('click', () => ctx.go('#/shipments'));
    $('#export', root).addEventListener('click', () => {
      const filters = readFilters(root);
      if (filters.from && filters.to && filters.from > filters.to) {
        toast('The start date must be on or before the end date.', 'error');
        return;
      }
      window.location.href = `/api/reports/shipments.csv${query(filters)}`;
    });
    $('#create', root).addEventListener('click', () => openCreateShipment(ctx, x => {
      if (s !== current) return;
      reload();
      openShipment(x.trackingNo, ctx, () => load(current));
    }));
    current.liveReload = throttle(() => {
      if (s === current && current.page === 0 && !document.querySelector('.overlay')) load(current);
    }, 3000);
    try {
      const list = await get('/api/merchants');
      if (s !== current) return;
      $('#f-merchant', root).insertAdjacentHTML('beforeend',
        list.map(m => `<option value="${m.id}" ${String(m.id) === p.merchantId ? 'selected' : ''}>${esc(m.name)}</option>`).join(''));
    } catch { }
    await load(current);
  },

  unmount() {
    s = null;
  },

  onEvent(evt) {
    if (s && (evt.type === 'shipment' || evt.type === 'dispatch')) s.liveReload();
  }
};
