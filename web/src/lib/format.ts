// Dates come as 'YYYY-MM-DD' strings in German local time; format them as UTC so no day shifts happen.
const dayFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const longFmt = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const newsFmt = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Berlin' });

export const day = (d: string | null) => (d ? dayFmt.format(new Date(`${d}T12:00:00Z`)) : 'Termin offen');
export const longDay = (d: string | null) => (d ? longFmt.format(new Date(`${d}T12:00:00Z`)) : 'Termin offen');
export const time = (t: string | null) => (t ? t.slice(0, 5) : '');
export const newsDate = (d: Date | string) => newsFmt.format(new Date(d));
export const pct = (made: number, att: number) => (att ? `${Math.round((100 * made) / att)} %` : '–');
export const avg = (total: number, games: number) => (games ? (total / games).toFixed(1).replace('.', ',') : '–');

// Editor HTML links images to Directus (behind Cloudflare Access); point them at the public /media proxy.
// shortcut: editor HTML is rendered unsanitised; editors are trusted and the site has no sessions. Sanitise if untrusted editors get access.
export const publicHtml = (html: string | null) =>
  (html ?? '').replace(/(?:https?:\/\/[^"'\s]+)?\/assets\/([0-9a-f-]{36})(?:\?[^"'\s]*)?/g, '/media/$1?w=960');

export const media = (id: string, w: 320 | 640 | 960 | 1600 = 640) => `/media/${id}?w=${w}`;
export const video = (id: string) => `/media/${id}`;
