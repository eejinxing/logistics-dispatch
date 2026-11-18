import { api, get } from '../api.js';
import { $, esc, fmtTime, toast } from '../ui.js';

let s = null;

async function load() {
  if (!s) return;
  const token = s;
  const list = await get('/api/accounts');
  if (s !== token) return;
  const role = $('#a-role').value;
  const rows = list.filter((a) => !role || a.role === role);
  const count = (r) => list.filter((a) => a.role === r).length;
  $('#account-sum').textContent = `Administrator ${count('ADMIN')} · Merchant ${count('MERCHANT')} · Recipient ${count('CUSTOMER')}`;
  $('#accounts').innerHTML = rows.length ? `<table class="data"><thead><tr><th>Username</th><th>Role</th><th>Name</th><th>Linked to</th>
      <th>Registered</th><th>Last sign-in</th><th>Status</th><th class="right">Actions</th></tr></thead><tbody>
    ${rows.map((a) => `<tr>
      <td class="mono">${esc(a.username)}</td><td><span class="badge plain">${esc(a.roleLabel)}</span></td>
      <td>${esc(a.displayName)}</td>
      <td>${a.merchantName ? `Merchant ${esc(a.merchantName)}` : a.phone ? `Mobile ${esc(a.phone)}` : '—'}</td>
      <td class="nowrap">${fmtTime(a.createdAt)}</td><td class="nowrap">${a.lastLoginAt ? fmtTime(a.lastLoginAt) : '<span class="muted">Never</span>'}</td>
      <td>${a.enabled ? '<span class="badge st-IDLE">Active</span>' : '<span class="badge st-CANCELLED">Disabled</span>'}</td>
      <td class="right">${a.role === 'ADMIN' ? '' : `<button class="btn small" data-id="${a.id}" data-enabled="${a.enabled}">${a.enabled ? 'Disable' : 'Enable'}</button>`}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No accounts</div>';
  $('#accounts').querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const a = await api(`/api/accounts/${b.dataset.id}`, { method: 'PATCH', body: { enabled: b.dataset.enabled !== 'true' } });
      toast(`${a.username} ${a.enabled ? 'Enabled' : 'Disabled for the next sign-in'}`, 'success');
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
}

export default {
  title: 'Accounts',
  async mount(root) {
    s = {};
    root.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Accounts</h2><span class="sub" id="account-sum"></span><div class="spacer"></div>
          <select class="input" id="a-role" aria-label="Role"><option value="">All roles</option><option value="ADMIN">Administrator</option>
            <option value="MERCHANT">Merchant</option><option value="CUSTOMER">Recipient</option></select></div>
        <div class="card-body" style="padding-bottom:0"><p class="text-2" style="margin:0;font-size:13px">Create merchant accounts on the Merchants page. Recipients can register with their mobile number and a matching tracking number.</p></div>
        <div class="card-body flush" style="padding-top:12px"><div class="table-wrap" id="accounts"><div class="empty">Loading…</div></div></div>
      </section>`;
    $('#a-role').addEventListener('change', load);
    await load();
  },
  unmount() {
    s = null;
  }
};
