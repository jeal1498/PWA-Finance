/* Compartir finanzas entre dos personas (Supabase: tablas hogares, miembros, invitaciones y funciones rpc).
   Las dos personas de un hogar ven y editan la misma copia (`copias`). La invitación no usa correo: aparece en la app de la otra
   persona cuando entra con ese correo de Google. */
import { nube } from './sync.js';

const rpc = (fn, args = {}) => nube('/rest/v1/rpc/' + fn, { method: 'POST', body: JSON.stringify(args) });
const json = async p => (await p).json();

/* { miembros: [{ user_id, email, nombre }], enviadas: [{ email }] } de mi cuenta compartida. */
export const miembros = () => json(nube('/rest/v1/miembros?select=user_id,email,nombre,alias,hogar_id&order=unido_at'));
export async function estado() {
  const miembros = await json(nube('/rest/v1/miembros?select=user_id,email,nombre,alias,hogar_id&order=unido_at'));
  const h = miembros[0] && miembros[0].hogar_id;
  const enviadas = h ? await json(nube(`/rest/v1/invitaciones?select=email&estado=eq.pendiente&hogar_id=eq.${h}`)) : [];
  return { miembros, enviadas };
}
export const ponerAlias = alias => rpc('poner_alias', { p_alias: alias });
export const invitar = email => rpc('invitar', { p_email: email });
export const quitarInvitacion = email => rpc('quitar_invitacion', { p_email: email });
export const misInvitaciones = () => json(rpc('mis_invitaciones'));
export const aceptar = id => rpc('aceptar_invitacion', { p_id: id });
export const rechazar = id => rpc('rechazar_invitacion', { p_id: id });
export const salir = () => rpc('salir_del_hogar');
