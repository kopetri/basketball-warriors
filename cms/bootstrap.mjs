// One-time (idempotent) Directus setup: CMS collections, relations, public file access, legal page drafts.
// Runs inside the Directus container, which already has ADMIN_EMAIL and ADMIN_PASSWORD:
//   docker compose exec -T cms node --input-type=module - < cms/bootstrap.mjs
const URL = 'http://127.0.0.1:8055';
let token;

async function api(method, path, body) {
  const res = await fetch(URL + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}
const exists = (path) => api('GET', path).then(() => true, () => false);

const pk = { field: 'id', type: 'integer', meta: { hidden: true, readonly: true, interface: 'input' }, schema: { is_primary_key: true, has_auto_increment: true } };
const status = {
  field: 'status', type: 'string',
  meta: { width: 'half', interface: 'select-dropdown', display: 'labels', options: { choices: [{ text: 'Veröffentlicht', value: 'published' }, { text: 'Entwurf', value: 'draft' }] } },
  schema: { default_value: 'draft', is_nullable: false },
};
const text = (field, meta = {}, schema = {}) => ({ field, type: 'string', meta: { interface: 'input', ...meta }, schema });
const html = (field, note) => ({ field, type: 'text', meta: { interface: 'input-rich-text-html', note }, schema: {} });
const image = (field) => ({ field, type: 'uuid', meta: { interface: 'file-image', special: ['file'] }, schema: {} });
const m2o = (field, template, note) => ({ field, type: 'integer', meta: { interface: 'select-dropdown-m2o', special: ['m2o'], options: { template }, display: 'related-values', display_options: { template }, note }, schema: {} });

const collections = [
  {
    collection: 'players',
    meta: { icon: 'sports_basketball', display_template: '{{first_name}} {{last_name}}', sort_field: 'sort', note: 'Kader. Name, Foto und Statistiken erscheinen nur mit Einwilligung.' },
    fields: [
      pk, status,
      { field: 'sort', type: 'integer', meta: { hidden: true, interface: 'input' }, schema: {} },
      text('first_name', { width: 'half', required: true }),
      text('last_name', { width: 'half', required: true }),
      text('slug', { width: 'half', required: true, note: 'Teil der URL, z. B. max-mustermann' }, { is_unique: true }),
      { field: 'jersey_number', type: 'integer', meta: { width: 'half', interface: 'input' }, schema: {} },
      text('position', { width: 'half', interface: 'select-dropdown', options: { choices: ['Guard', 'Forward', 'Center'].map((v) => ({ text: v, value: v })) } }),
      image('photo'),
      html('bio'),
      m2o('dbb_person', '{{first_name}} {{last_name}}', 'Verknüpfung mit den DBB-Spielstatistiken'),
      { field: 'consent', type: 'boolean', meta: { interface: 'boolean', note: 'Schriftliche Einwilligung für Name, Foto und Statistiken liegt vor', options: { label: 'Einwilligung liegt vor' } }, schema: { default_value: false, is_nullable: false } },
    ],
  },
  {
    collection: 'news',
    meta: { icon: 'newspaper', display_template: '{{title}}', sort_field: null, note: 'News-Beiträge' },
    fields: [
      pk, status,
      text('title', { required: true }),
      text('slug', { width: 'half', required: true, note: 'Teil der URL, z. B. sieg-gegen-stockach' }, { is_unique: true }),
      { field: 'date_published', type: 'timestamp', meta: { width: 'half', interface: 'datetime', required: true }, schema: {} },
      image('cover'),
      { field: 'summary', type: 'text', meta: { interface: 'input-multiline', note: 'Kurzer Teaser für die Übersicht' }, schema: {} },
      html('body'),
      m2o('game', '{{kickoff_date}} {{home_team_id.name}} – {{guest_team_id.name}}', 'Optional: zugehöriges Spiel, zeigt den Boxscore im Beitrag'),
    ],
  },
  {
    collection: 'pages',
    meta: { icon: 'description', display_template: '{{title}}', note: 'Feste Seiten (Impressum, Datenschutz)' },
    fields: [pk, text('slug', { width: 'half', required: true }, { is_unique: true }), text('title', { width: 'half', required: true }), html('body')],
  },
];

const relations = [
  ['players', 'photo', 'directus_files'],
  ['players', 'dbb_person', 'dbb_persons'],
  ['news', 'cover', 'directus_files'],
  ['news', 'game', 'dbb_games'],
];

const IMPRESSUM = `<h2>Angaben gemäß § 5 DDG</h2>
<p>Sebastian Hartwig<br>[Straße und Hausnummer]<br>[PLZ Ort]</p>
<h2>Kontakt</h2>
<p>E-Mail: [E-Mail-Adresse]</p>
<h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
<p>Sebastian Hartwig, Anschrift wie oben</p>
<h2>Hinweis</h2>
<p>Diese Website wird privat von Sebastian Hartwig betrieben. Sie ist kein Angebot der TG 1848 Bad Waldsee e.V.
Spielpläne, Ergebnisse, Tabellen und Statistiken stammen von basketball-bund.net (Deutscher Basketball Bund e.V.).</p>`;

const DATENSCHUTZ = `<h2>Verantwortlicher</h2>
<p>Sebastian Hartwig, [Anschrift], E-Mail: [E-Mail-Adresse]</p>
<h2>Hosting und Auslieferung</h2>
<p>Die Website läuft auf einem eigenen Server in Deutschland. Die Auslieferung erfolgt über Cloudflare, Inc., 101 Townsend St,
San Francisco, CA 94107, USA. Cloudflare verarbeitet dabei technisch notwendige Daten wie Ihre IP-Adresse, um die Website
sicher und schnell auszuliefern (Art. 6 Abs. 1 lit. f DSGVO). Cloudflare ist unter dem EU-US Data Privacy Framework zertifiziert.</p>
<h2>Cookies, Tracking, externe Inhalte</h2>
<p>Diese Website setzt keine Cookies, verwendet keine Analyse- oder Tracking-Werkzeuge und lädt keine Schriften oder Skripte
von fremden Servern.</p>
<h2>Daten der Spieler</h2>
<p>Namen, Fotos und Statistiken von Spielern werden nur mit deren Einwilligung veröffentlicht (Art. 6 Abs. 1 lit. a DSGVO).
Die Einwilligung kann jederzeit mit Wirkung für die Zukunft widerrufen werden. Spielstatistiken stammen von
basketball-bund.net. Ohne Einwilligung erscheinen Spieler nur anonym.</p>
<h2>Ihre Rechte</h2>
<p>Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und
Widerspruch. Sie können sich außerdem bei einer Datenschutz-Aufsichtsbehörde beschweren, zum Beispiel beim Landesbeauftragten
für den Datenschutz und die Informationsfreiheit Baden-Württemberg.</p>`;

const login = await api('POST', '/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
token = login.access_token;

for (const c of collections) {
  if (await exists(`/collections/${c.collection}`)) console.log('exists', c.collection);
  else console.log('created', (await api('POST', '/collections', { ...c, schema: {} })).collection);
}

for (const [collection, field, related] of relations) {
  if (await exists(`/relations/${collection}/${field}`)) console.log('exists', `${collection}.${field}`);
  else {
    await api('POST', '/relations', { collection, field, related_collection: related, schema: { on_delete: 'SET NULL' } });
    console.log('related', `${collection}.${field} -> ${related}`);
  }
}

// The website proxies images from /assets, so files must be readable without login.
// Directus itself is only reachable from the Docker network and through Cloudflare Access.
const [publicPolicy] = await api('GET', `/policies?filter[name][_eq]=${encodeURIComponent('$t:public_label')}&fields=id`);
const filePerms = await api('GET', `/permissions?filter[policy][_eq]=${publicPolicy.id}&filter[collection][_eq]=directus_files&filter[action][_eq]=read`);
if (filePerms.length) console.log('exists public read directus_files');
else {
  await api('POST', '/permissions', { policy: publicPolicy.id, collection: 'directus_files', action: 'read', fields: ['*'], permissions: {} });
  console.log('granted public read directus_files');
}

for (const [slug, title, body] of [['impressum', 'Impressum', IMPRESSUM], ['datenschutz', 'Datenschutzerklärung', DATENSCHUTZ]]) {
  const found = await api('GET', `/items/pages?filter[slug][_eq]=${slug}&fields=id`);
  if (found.length) console.log('exists page', slug);
  else {
    await api('POST', '/items/pages', { slug, title, body });
    console.log('seeded page', slug);
  }
}
