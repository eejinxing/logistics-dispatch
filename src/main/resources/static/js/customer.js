import { ApiError, get, post } from './api.js';
import { createClock } from './clock.js';
import { RouteMap } from './map.js';
import { $, badge, dirChip, esc, fmtDuration, fmtKg, fmtTime, stepper, toast } from './ui.js';

const clock = createClock();
const state = { parcels: [], tab: 'active', selected: null, view: null, map: null, external: false };

const isDone = (p) => p.status === 'DELIVERED' || p.status === 'CANCELLED';

function renderList() {
  const items = state.parcels.filter((p) => (state.tab === 'all' ? true : state.tab === 'done' ? isDone(p) : !isDone(p)));
  const moving = state.parcels.filter((p) => !isDone(p)).length;
  $('#summary').textContent = `Total ${state.parcels.length} parcels · ${moving} on the way`;
  const list = $('#list');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${state.tab === 'done' ? 'No parcels have been delivered yet.' : 'No parcels are on the way.'}</div>`;
    return;
  }
  const now = clock.now();
  list.innerHTML = items.map((p) => `
    <button type="button" class="parcel-card${p.trackingNo === state.selected ? ' selected' : ''}" data-no="${esc(p.trackingNo)}">
      <div class="row">${badge(p.status, p.statusLabel)}<span class="mono">${esc(p.trackingNo)}</span>
        ${p.late && !isDone(p) ? '<span class="badge late plain">Overdue</span>' : ''}</div>
      <div class="row"><b>${esc(p.origin.name)} → ${esc(p.destination.name)}</b>${dirChip(p.direction, p.directionLabel)}</div>
      <div class="from">From ${esc(p.senderName)} · ${p.status === 'DELIVERED'
        ? `Delivered ${fmtTime(p.deliveredAt)}`
        : p.status === 'CANCELLED' ? 'Cancelled'
          : Date.parse(p.promisedBy) > now ? `Expected by ${fmtTime(p.promisedBy)}` : `Originally due ${fmtTime(p.promisedBy)}`}</div>
    </button>`).join('');
  list.querySelectorAll('.parcel-card').forEach((b) => b.addEventListener('click', () => select(b.dataset.no, false)));
}

function legText(view) {
  const leg = view.leg;
  if (!leg) {
    if (view.status === 'AT_TRANSFER') return `Awaiting the next leg at the ${view.currentHub.name} hub.`;
    if (view.status === 'CREATED') return `Collected at ${view.currentHub.name} and awaiting loading.`;
    if (view.status === 'ARRIVED_HUB') return `Being sorted for delivery at the ${view.destination.name} hub.`;
    if (view.status === 'OUT_FOR_DELIVERY') return 'The courier is on the way. Keep your phone available.';
    if (view.status === 'DELIVERED') return `Delivered at ${fmtTime(view.deliveredAt)}`;
    if (view.status === 'EXCEPTION') return view.exceptionReason ? `Delivery issue: ${view.exceptionReason}` : 'A delivery issue is under review.';
    return view.statusLabel;
  }
  const vehicle = leg.vehicleTypeLabel.toLowerCase();
  if (leg.status === 'LOADING') return `Loaded onto a ${vehicle} at ${leg.from.name}. Departure for ${leg.to.name} is scheduled for ${fmtTime(leg.departAt)}.`;
  const left = Date.parse(leg.arriveAt) - clock.now();
  const arrival = left > 0 ? `About ${fmtDuration(left)} until arrival.` : 'Arriving soon.';
  return `Travelling by ${vehicle} from ${leg.from.name} to ${leg.to.name}. ${arrival}${leg.delayReason ? ` Delay: ${leg.delayReason}.` : ''}`;
}

function renderDetail() {
  const v = state.view;
  const box = $('#detail');
  if (!v) return;
  if (state.map) {
    state.map.destroy();
    state.map = null;
  }
  const atDestination = v.currentHub.id === v.destination.id;
  box.innerHTML = `
    <div class="big-status">${badge(v.status, v.statusLabel)}<b>${esc(v.origin.name)} → ${esc(v.destination.name)}</b>
      <span class="mono muted">${esc(v.trackingNo)}</span>${v.late && v.status !== 'DELIVERED' ? '<span class="badge late">Overdue</span>' : ''}</div>
    ${stepper(v.status, atDestination)}
    <p style="margin:0 0 12px;font-size:15px" id="leg-text">${esc(legText(v))}</p>
    <div class="route-map" id="route-map"></div>
    <dl class="kv" style="margin-top:14px">
      ${v.full ? `<dt>Sender</dt><dd>${esc(v.merchantName ?? '—')}</dd><dt>Recipient</dt><dd>${esc(v.receiverName ?? '—')}</dd>
        <dt>Delivery address</dt><dd>${esc(v.receiverAddress ?? '—')}</dd>` : ''}
      <dt>Route</dt><dd>${v.route.map((h) => esc(h.code)).join(' → ')} ${v.route.length > 2 ? '<span class="badge transfer plain">via a transfer hub</span>' : ''}</dd>
      <dt>Direction / Weight</dt><dd>${dirChip(v.direction, v.directionLabel)} · ${fmtKg(v.weightKg)} · ${esc(v.priorityLabel)}</dd>
      <dt>Promised delivery</dt><dd>${fmtTime(v.promisedBy)}</dd>
      ${v.deliveredAt ? `<dt>Delivered at</dt><dd>${fmtTime(v.deliveredAt)}</dd>` : ''}
    </dl>
    ${v.full ? '' : '<p class="muted" style="font-size:12px">This parcel is linked to a different mobile number. You can view its public tracking details here.</p>'}
    <div class="section-title">Tracking history</div>
    <ul class="timeline">${[...v.events].reverse().map((e, i) => `
      <li class="${i === 0 ? (e.status === 'EXCEPTION' || e.status === 'CANCELLED' ? 'warn' : 'current') : ''}">
        <div><b>${esc(e.statusLabel)}</b> · ${esc(e.location ?? '')}</div>
        ${e.note ? `<div class="text-2">${esc(e.note)}</div>` : ''}<div class="when">${fmtTime(e.occurredAt)}</div></li>`).join('')}
    </ul>`;
  state.map = new RouteMap($('#route-map'), clock.now);
  state.map.show(v);
}

async function select(trackingNo, external) {
  state.selected = trackingNo;
  state.external = external;
  renderList();
  try {
    const view = external
      ? await get(`/api/public/track/${encodeURIComponent(trackingNo)}`)
      : await get(`/api/customer/parcels/${encodeURIComponent(trackingNo)}`);
    clock.set({ now: view.now, scale: view.timeScale, paused: view.paused });
    state.view = view;
    renderDetail();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refresh() {
  try {
    state.parcels = await get('/api/customer/parcels');
    renderList();
    if (state.selected) {
      const view = state.external
        ? await get(`/api/public/track/${encodeURIComponent(state.selected)}`)
        : await get(`/api/customer/parcels/${encodeURIComponent(state.selected)}`);
      clock.set({ now: view.now, scale: view.timeScale, paused: view.paused });
      const changed = !state.view || view.status !== state.view.status || view.events.length !== state.view.events.length;
      state.view = view;
      if (changed) renderDetail();
      else if (state.map) {
        state.map.leg = view.leg && view.leg.status !== 'ARRIVED' ? view.leg : null;
        $('#leg-text').textContent = legText(view);
      }
    }
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 401)) console.warn(e);
  }
}

async function boot() {
  let me;
  try {
    me = await get('/api/me');
  } catch {
    return;
  }
  if (me.role !== 'CUSTOMER') {
    location.href = me.home || '/';
    return;
  }
  $('#me').textContent = me.displayName;
  $('#logout').addEventListener('click', async () => {
    try { await post('/api/auth/logout'); } finally { location.href = '/login.html'; }
  });
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.tab = b.dataset.tab;
    $('#tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderList();
  });
  $('#lookup').addEventListener('submit', (e) => {
    e.preventDefault();
    const no = $('#lookup-no').value.trim().toUpperCase();
    if (!no) return;
    const mine = state.parcels.some((p) => p.trackingNo === no);
    select(no, !mine);
  });
  await clock.sync();
  await refresh();
  const first = state.parcels.find((p) => !isDone(p)) ?? state.parcels[0];
  if (first) select(first.trackingNo, false);
  setInterval(refresh, 10000);
  setInterval(() => {
    if (state.view && state.view.leg) $('#leg-text').textContent = legText(state.view);
  }, 1000);
}

boot();
