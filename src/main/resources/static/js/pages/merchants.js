import { api, get, post } from '../api.js';
import { $, esc, fmtMoney, fmtNum, hubOptions, openModal, toast } from '../ui.js';

let s = null;

async function load() {
  if (!s) return;
  const token = s;
  const list = await get('/api/merchants');
  if (s !== token) return;
  const el = $('#merchants');
  $('#merchant-sum').textContent = `${list.length} merchants · ${list.filter((m) => m.active).length} active`;
  el.innerHTML = `<table class="data"><thead><tr><th>ID</th><th>Merchant</th><th>Contact</th><th>Collection hub</th><th>Account</th>
      <th class="right">Total shipments</th><th class="right">Active</th><th class="right">30-day shipping fees</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody>
    ${list.map((m) => `<tr>
      <td class="mono">${esc(m.code)}</td><td><b>${esc(m.name)}</b></td>
      <td>${esc(m.contactName ?? '—')} <span class="muted">${esc(m.phone ?? '')}</span></td>
      <td>${esc(m.defaultHub.code)} ${esc(m.defaultHub.name)}</td>
      <td>${m.usernames.length ? m.usernames.map((u) => `<span class="mono">${esc(u)}</span>`).join(', ') : '<span class="muted">None</span>'}</td>
      <td class="right num">${fmtNum(m.shipments)}</td><td class="right num">${fmtNum(m.activeShipments)}</td>
      <td class="right num">${fmtMoney(m.revenue30d)}</td>
      <td>${m.active ? '<span class="badge st-IDLE">Active</span>' : '<span class="badge st-CANCELLED">Disabled</span>'}</td>
      <td class="right nowrap"><a class="btn small" href="#/shipments?merchantId=${m.id}">Shipments</a>
        <button class="btn small" data-toggle="${m.id}" data-active="${m.active}">${m.active ? 'Disable' : 'Enable'}</button></td>
    </tr>`).join('')}</tbody></table>`;
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/api/merchants/${b.dataset.toggle}`, { method: 'PATCH', body: { enabled: b.dataset.active !== 'true' } });
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

function openCreate() {
  const { el, close } = openModal({
    title: 'Add merchant',
    body: `<form class="form-grid" id="merchant-form" autocomplete="off">
      <div class="field full"><label>Merchant name</label><input class="input" name="name" maxlength="80" required></div>
      <div class="field"><label>Contact</label><input class="input" name="contactName" maxlength="60"></div>
      <div class="field"><label>Phone</label><input class="input" name="phone" maxlength="30"></div>
      <div class="field full"><label>Collection hub</label><select class="input" name="defaultHubId">${hubOptions(s.ctx.hubs, null)}</select></div>
      <div class="field"><label>Username</label><input class="input" name="username" maxlength="30" pattern="[A-Za-z0-9_.\\-]{3,30}" required></div>
      <div class="field"><label>Initial password (at least 6 characters)</label><input class="input" name="password" type="password" minlength="6" maxlength="64" autocomplete="new-password" required></div>
    </form><p class="text-2" style="font-size:13px;margin-bottom:0">The merchant can sign in to the “Merchant portal” to create and view shipments.</p>`,
    foot: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="merchant-ok">Create</button>'
  });
  el.querySelector('#merchant-ok').addEventListener('click', async () => {
    const form = el.querySelector('#merchant-form');
    if (!form.reportValidity()) return;
    const f = Object.fromEntries(new FormData(form));
    try {
      const m = await post('/api/merchants', { ...f, defaultHubId: Number(f.defaultHubId) });
      toast(`Merchant created: ${m.name} (${m.code}), username: ${f.username}`, 'success');
      close();
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  });
}

export default {
  title: 'Merchant',
  async mount(root, ctx) {
    s = { ctx };
    root.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Merchants</h2><span class="sub" id="merchant-sum"></span><div class="spacer"></div>
          <button class="btn primary" id="add">+ Add merchant</button></div>
        <div class="card-body flush" style="padding-top:12px"><div class="table-wrap" id="merchants"><div class="empty">Loading…</div></div></div>
      </section>`;
    $('#add').addEventListener('click', openCreate);
    await load();
  },
  unmount() {
    s = null;
  }
};
