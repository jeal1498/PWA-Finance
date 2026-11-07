/* Sesión con Supabase Auth (Google) sin librerías: flujo implícito por redirección.
   Solo guarda la clave pública (publishable) del proyecto; la sesión vive en localStorage de este teléfono. */
export const SUPABASE_URL = 'https://cnesinlvrvsmeflaqjkr.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_ldPwztEZ2iDzdDyhBz_3ng_rydg_FDJ';
const LS = 'finanzas_sesion';
const REDIRECT = 'https://jeal1498.github.io/PWA-Finance/';

const leer = () => { try { return JSON.parse(localStorage.getItem(LS) || 'null'); } catch (e) { return null; } };
const guardar = s => { try { s ? localStorage.setItem(LS, JSON.stringify(s)) : localStorage.removeItem(LS); } catch (e) { /* sin almacenamiento */ } };
const api = (ruta, opts = {}) => fetch(SUPABASE_URL + ruta, { ...opts, headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

/* ¿Hay sesión guardada? (con refresh_token basta: sin internet la app sigue abriendo.) */
export const haySesion = () => { const s = leer(); return !!(s && s.refresh_token); };

export function usuario() {
  const s = leer(); if (!s || !s.access_token) return null;
  try {
    const p = JSON.parse(decodeURIComponent(escape(atob(s.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
    return { email: p.email || '', nombre: (p.user_metadata && (p.user_metadata.full_name || p.user_metadata.name)) || '' };
  } catch (e) { return null; }
}

/* Al volver de Google, Supabase manda la sesión en el #hash. La guarda y limpia la dirección. Devuelve un error (texto) o ''. */
export function procesarRetorno() {
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (h.get('error_description') || h.get('error')) {
    history.replaceState(null, '', location.pathname);
    return h.get('error_description') || h.get('error');
  }
  if (!h.get('access_token')) return '';
  guardar({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), expires_at: Date.now() + (+h.get('expires_in') || 3600) * 1000 });
  history.replaceState(null, '', location.pathname);
  return '';
}

export function iniciarGoogle() {
  location.href = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(REDIRECT)}`;
}

/* Renueva el token si venció. Sin internet no hace nada; solo si Supabase rechaza el refresh_token cierra la sesión. */
export async function renovar() {
  const s = leer(); if (!s || !s.refresh_token || s.expires_at > Date.now() + 60000) return;
  try {
    const r = await api('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) });
    if (r.ok) { const d = await r.json(); guardar({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + d.expires_in * 1000 }); }
    else if (r.status === 400 || r.status === 401) guardar(null);
  } catch (e) { /* sin red: se conserva la sesión */ }
}

export async function cerrarSesion() {
  const s = leer();
  try { if (s) await api('/auth/v1/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token } }); } catch (e) { /* igual se cierra aquí */ }
  guardar(null);
}
