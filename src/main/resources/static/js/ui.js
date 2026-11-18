
export const ZONE = 'Asia/Kuala_Lumpur';
export const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const DIR_LABEL = { N: 'North', NE: 'Northeast', E: 'East', SE: 'Southeast', S: 'South', SW: 'Southwest', W: 'West', NW: 'Northwest' };
export const DIR_ANGLE = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export const STATUS_LABEL = {
  CREATED: 'Awaiting dispatch', ASSIGNED: 'Loaded', IN_TRANSIT: 'In transit', AT_TRANSFER: 'Awaiting transfer', ARRIVED_HUB: 'At destination hub',
  OUT_FOR_DELIVERY: 'Out for delivery', DELIVERED: 'Delivered', EXCEPTION: 'Exception', CANCELLED: 'Cancelled'
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function dirColor(d) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--dir-${d}`).trim() || '#888';
}
export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const ARROW = '<svg viewBox="0 0 10 10"><path d="M5 .8 8.4 8.6 5 6.6 1.6 8.6z" fill="currentColor"/></svg>';
export function dirChip(d, label) {
  if (!d) return '';
  return `<span class="dir-chip" title="To ${esc(DIR_LABEL[d])}"><i style="background:var(--dir-${d})">`
    + `<span style="display:inline-grid;transform:rotate(${DIR_ANGLE[d]}deg)">${ARROW}</span></i>${esc(label ?? DIR_LABEL[d])}</span>`;
}

export const badge = (status, label) => `<span class="badge st-${esc(status)}">${esc(label ?? STATUS_LABEL[status] ?? status)}</span>`;
export const lane = (o, d) => `<span class="lane">${esc(o.code)}<span class="arrow">→</span>${esc(d.code)}</span>`;

const dtFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
const fullFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, month: 'numeric', day: 'numeric' });

export const fmtTime = (v) => (v ? dtFmt.format(new Date(v)).replace(/\//g, '-') : '—');
export const fmtHM = (v) => (v ? hmFmt.format(new Date(v)) : '—');
export const fmtFull = (v) => (v ? fullFmt.format(new Date(v)) : '—');
export const fmtDay = (isoDate) => dayFmt.format(new Date(`${isoDate}T12:00:00+08:00`));
export const fmtNum = (n, digits = 0) => Number(n ?? 0).toLocaleString('en-MY', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const fmtKg = (n) => `${fmtNum(n, n < 10 ? 1 : 0)} kg`;
export const fmtMoney = (n) => `RM ${fmtNum(n, 2)}`;
export const fmtPct = (r) => `${(Number(r ?? 0) * 100).toFixed(1)}%`;

export function fmtDuration(ms) {
  const minutes = Math.round(Math.abs(ms) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  const days = Math.floor(hours / 24);
  return `${days} d${hours % 24 ? ` ${hours % 24} hr` : ''}`;
}
export const ago = (iso, nowMs) => `${fmtDuration(nowMs - Date.parse(iso))} ago`;

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 1000) {
  let last = 0;
  let timer = null;
  return (...args) => {
    const wait = last + ms - Date.now();
    if (wait <= 0) {
      last = Date.now();
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        last = Date.now();
        fn(...args);
      }, wait);
    }
  };
}

export function toast(message, level = 'info', ms = 3800) {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}

let tipEl;
export function showTip(html, x, y) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.style.display = 'block';
  const r = tipEl.getBoundingClientRect();
  const left = Math.min(x + 14, window.innerWidth - r.width - 8);
  const top = y + 14 + r.height > window.innerHeight ? y - r.height - 10 : y + 14;
  tipEl.style.left = `${Math.max(8, left)}px`;
  tipEl.style.top = `${Math.max(8, top)}px`;
}
export function hideTip() {
  if (tipEl) tipEl.style.display = 'none';
}

function openLayer({ kind, title, body, foot = '', onMount }) {
  const overlay = document.createElement('div');
  overlay.className = kind === 'modal' ? 'overlay center' : 'overlay';
  overlay.innerHTML = `
    <div class="${kind}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="panel-head"><h3>${esc(title)}</h3><div class="spacer"></div>
        <button class="btn ghost small" data-close aria-label="Close">✕</button></div>
      <div class="panel-body">${body}</div>
      ${foot ? `<div class="panel-foot">${foot}</div>` : ''}
    </div>`;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  const panel = overlay.firstElementChild;
  onMount?.(panel, close);
  return { el: panel, close };
}
export const openModal = (opts) => openLayer({ ...opts, kind: 'modal' });
export const openDrawer = (opts) => openLayer({ ...opts, kind: 'drawer' });

export function promptText({ title, label, placeholder = '', required = false, confirmText = 'OK', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openModal({
      title,
      body: `<div class="field"><label for="prompt-input">${esc(label)}</label>
        <input class="input" id="prompt-input" maxlength="100" placeholder="${esc(placeholder)}"></div>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(confirmText)}</button>`,
      onMount: (panel) => setTimeout(() => panel.querySelector('input').focus(), 30)
    });
    const input = el.querySelector('input');
    const ok = () => {
      const v = input.value.trim();
      if (required && !v) { input.focus(); return; }
      done = true;
      close();
      resolve(v);
    };
    el.querySelector('[data-ok]').addEventListener('click', ok);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
    const observer = new MutationObserver(() => {
      if (!el.isConnected) { observer.disconnect(); if (!done) resolve(null); }
    });
    observer.observe(document.body, { childList: true });
  });
}

export function confirmDialog(title, message, confirmText = 'OK') {
  return new Promise((resolve) => {
    let done = false;
    const { el, close } = openModal({
      title,
      body: `<p style="margin:0">${esc(message)}</p>`,
      foot: `<button class="btn" data-close>Cancel</button><button class="btn primary" data-ok>${esc(confirmText)}</button>`
    });
    el.querySelector('[data-ok]').addEventListener('click', () => { done = true; close(); resolve(true); });
    const observer = new MutationObserver(() => {
      if (!el.isConnected) { observer.disconnect(); if (!done) resolve(false); }
    });
    observer.observe(document.body, { childList: true });
  });
}

export function hubOptions(hubs, selected, emptyLabel) {
  const opts = hubs.map((h) => `<option value="${h.id}" ${String(h.id) === String(selected ?? '') ? 'selected' : ''}>${esc(h.code)} · ${esc(h.name)}</option>`).join('');
  return (emptyLabel ? `<option value="">${esc(emptyLabel)}</option>` : '') + opts;
}

export const VEHICLE_SVG = {
  road: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"><path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/></svg>',
  air: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 00-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z"/></svg>'
};

const STEPS = ['Order placed', 'In transit', 'At destination hub', 'Out for delivery', 'Delivered'];
const STEP_OF = {
  CREATED: 0, ASSIGNED: 0, IN_TRANSIT: 1, AT_TRANSFER: 1, ARRIVED_HUB: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4
};

export function stepper(status, atDestination = false) {
  if (status === 'CANCELLED') return '<p class="muted" style="margin:4px 0 12px">Shipment cancelled</p>';
  const problem = status === 'EXCEPTION';
  const now = problem ? (atDestination ? 3 : 1) : (STEP_OF[status] ?? 0);
  return `<div class="stepper${problem ? ' problem' : ''}" role="list">${STEPS.map((label, i) =>
    `<div role="listitem" class="step${i < now || (i === now && status === 'DELIVERED') ? ' done' : ''}${i === now ? ' now' : ''}"><i></i>${
      i === now && problem ? 'Exception' : label}</div>`).join('')}</div>`;
}
