export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const listeners = { unauthorized: () => {}, offline: () => {} };
export function onApiEvent(name, fn) {
  listeners[name] = fn;
}

export async function api(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
    });
  } catch {
    throw new ApiError(0, 'Keine Verbindung – bist du offline?');
  }
  // Antwort kommt aus dem Offline-Cache des Service Workers
  listeners.offline(res.headers.get('X-Offline') === '1');

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) listeners.unauthorized();
    throw new ApiError(res.status, data?.error || `Fehler ${res.status}`);
  }
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body);
export const put = (path, body) => api('PUT', path, body);
export const del = (path, body) => api('DELETE', path, body);
