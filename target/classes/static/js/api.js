export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function csrfToken() {
  const m = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (method !== 'GET') {
    const token = csrfToken();
    if (token) headers['X-XSRF-TOKEN'] = token;
  }
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError('Could not connect to the server.', 0);
  }
  if (res.status === 401) {
    location.href = '/login.html';
    throw new ApiError('Sign-in required', 401);
  }
  if (res.status === 204) return null;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = (data && (data.detail || data.title)) || `Request failed (${res.status})`;
    throw new ApiError(res.status === 403 ? 'Your session expired. Refresh the page.' : message, res.status);
  }
  return data;
}

export const get = (path) => api(path);
export const post = (path, body) => api(path, { method: 'POST', body: body ?? {} });
export const patch = (path, body) => api(path, { method: 'PATCH', body });

export function query(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '' && v !== false) q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
