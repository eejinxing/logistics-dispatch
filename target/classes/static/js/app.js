import { get, patch, post } from './api.js';
import { $, $$, ZONE, toast } from './ui.js';
import dashboard from './pages/dashboard.js';
import shipments from './pages/shipments.js';
import dispatch from './pages/dispatch.js';
import fleet from './pages/fleet.js';
import hubs from './pages/hubs.js';

const PAGES = { dashboard, shipments, dispatch, fleet, hubs };
const PAGE_TITLES = { dashboard: dashboard.title, shipments: 'Shipments', dispatch: 'Dispatch', fleet: 'Fleet', hubs: 'Hubs' };
const LIVE_TYPES = ['shipment', 'trip', 'alert', 'dispatch', 'clock', 'fleet'];
const simDate = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const ctx = {
  hubs: [],
  hubsById: new Map(),
  sim: { nowMs: Date.now(), scale: 1, paused: false, at: performance.now() },
  simNow() {
    const s = ctx.sim;
    return s.paused ? s.nowMs : s.nowMs + (performance.now() - s.at) * s.scale;
  },
  async refreshHubs() {
    ctx.hubs = await get('/api/hubs');
    ctx.hubsById = new Map(ctx.hubs.map((h) => [h.id, h]));
    return ctx.hubs;
  },
  go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }
};

let current = null;
let routeToken = 0;

async function route() {
  const token = ++routeToken;
  const [path, qs] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?');
  const name = PAGES[path] ? path : 'dashboard';
  const page = PAGES[name];
  const changedPage = current?.name !== name;
  try { current?.page.unmount?.(); } catch (e) { console.error(e); }
  current = { name, page };
  $$('#nav a').forEach((a) => {
    const selected = a.dataset.route === name;
    a.classList.toggle('active', selected);
    if (selected) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  $('.rail-account').open = false;
  $('#page-title').textContent = PAGE_TITLES[name];
  document.title = `${PAGE_TITLES[name]} · Freight Dispatch`;
  const view = $('#view');
  view.innerHTML = '';
  if (changedPage) {
    view.closest('.main').scrollTop = 0;
    window.scrollTo(0, 0);
  }
  try {
    await page.mount(view, ctx, new URLSearchParams(qs || ''));
  } catch (e) {
    if (token === routeToken) {
      view.innerHTML = '<div class="card"><div class="empty" lang="en">This page could not load. Try refreshing.</div></div>';
    }
    console.error(e);
  }
}


async function syncSim() {
  try {
    const s = await get('/api/simulation');
    ctx.sim = { nowMs: Date.parse(s.now), scale: s.scale, paused: s.paused, at: performance.now(), engine: s.engineEnabled };
    $$('#sim-speed button').forEach((b) => {
      const on = b.dataset.pause ? s.paused : !s.paused && Number(b.dataset.scale) === Math.round(s.scale);
      b.classList.toggle('on', on);
    });
    $('#sim-autogen').checked = s.autoGenerate;
    $('#sim-autodispatch').checked = s.autoDispatch;
    $('#sim-controls').classList.toggle('hidden', !s.engineEnabled);
  } catch (e) {
    console.warn('sim sync failed', e);
  }
}

function tickClock() {
  $('#sim-now').textContent = simDate.format(ctx.simNow());
}

async function updateSim(body) {
  try {
    await patch('/api/simulation', body);
    await syncSim();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function wireSimControls() {
  $('#sim-speed').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pause) updateSim({ paused: !ctx.sim.paused });
    else updateSim({ scale: Number(b.dataset.scale), paused: false });
  });
  $('#sim-skip').addEventListener('click', () => updateSim({ advanceMinutes: 60 }));
  $('#sim-autogen').addEventListener('change', (e) => updateSim({ autoGenerate: e.target.checked }));
  $('#sim-autodispatch').addEventListener('change', (e) => updateSim({ autoDispatch: e.target.checked }));
}


function connectLive() {
  const dot = $('#live-dot');
  const text = $('#live-text');
  const source = new EventSource('/api/live');
  source.addEventListener('open', () => {
    dot.classList.add('on');
    text.textContent = 'Live updates connected';
  });
  source.addEventListener('error', () => {
    dot.classList.remove('on');
    text.textContent = 'Reconnecting…';
  });
  for (const type of LIVE_TYPES) {
    source.addEventListener(type, (e) => {
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }
      if (type === 'clock') syncSim();
      try { current?.page.onEvent?.(evt); } catch (err) { console.error(err); }
    });
  }
  return source;
}

async function refreshBadges() {
  try {
    const d = await get('/api/dashboard');
    const counts = Object.fromEntries((d.statuses ?? []).map((s) => [s.status, s.count]));
    setBadge('#nav-exceptions', counts.EXCEPTION ?? 0, 'shipment exceptions');
    setBadge('#nav-pending', (counts.CREATED ?? 0) + (counts.AT_TRANSFER ?? 0), 'shipments awaiting dispatch');
  } catch { }
}

function setBadge(sel, n, title) {
  const el = $(sel);
  el.textContent = n > 99 ? '99+' : String(n);
  el.title = `${n} ${title}`;
  el.classList.toggle('hidden', !n);
  const link = el.closest('a');
  const label = PAGE_TITLES[link.dataset.route];
  link.title = n ? `${label} · ${el.title}` : label;
  link.setAttribute('aria-label', n ? `${label}, ${el.title}` : label);
}

function wireNavigation() {
  const toggle = $('#nav-toggle');
  const shell = $('.shell');
  toggle.addEventListener('click', () => {
    const expanded = shell.classList.toggle('nav-expanded');
    const label = expanded ? 'Collapse navigation' : 'Expand navigation';
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  });
  const finder = $('#nav-finder');
  const input = $('#finder-search');
  const list = $('#finder-results');
  const empty = $('#finder-empty');
  const entries = $$('#nav a').map(item => {
    const link = document.createElement('a');
    link.href = item.getAttribute('href');
    link.textContent = PAGE_TITLES[item.dataset.route];
    link.addEventListener('click', () => finder.close());
    return link;
  });
  list.append(...entries);
  function filterPages() {
    const query = input.value.trim().toLowerCase();
    for (const link of entries) link.hidden = !link.textContent.toLowerCase().includes(query);
    empty.hidden = entries.some(link => !link.hidden);
  }
  function openFinder() {
    if (finder.open) return;
    input.value = '';
    filterPages();
    finder.showModal();
    input.focus();
  }
  input.addEventListener('input', filterPages);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') entries.find(link => !link.hidden)?.click();
  });
  $('#nav-search').addEventListener('click', openFinder);
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openFinder();
    }
  });
}

async function boot() {
  try {
    const me = await get('/api/me');
    $('#me').textContent = me.username;
    $('#rail-avatar').textContent = me.username.slice(0, 2).toUpperCase();
  } catch {
    return;
  }
  wireSimControls();
  wireNavigation();
  await Promise.all([syncSim(), ctx.refreshHubs()]);
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(syncSim, 15000);
  refreshBadges();
  setInterval(refreshBadges, 10000);
  const live = connectLive();
  $('#logout').addEventListener('click', async () => {
    live.close();
    try { await post('/api/auth/logout'); } finally { location.href = '/login.html'; }
  });
  window.addEventListener('hashchange', route);
  route();
}

boot();
