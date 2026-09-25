// Squish Island Lore Bible: renders the JSON files in content/ as a browsable site.
// No framework and no build step. Every value from content is HTML-escaped.

const FILES = {
  chapters: 'chapters',
  characters: 'characters',
  squishes: 'squishes',
  quests: 'quests',
  voiceLines: 'voice-lines',
  art: 'art',
  playtests: 'playtests',
  ideas: 'ideas',
  mechanics: 'mechanics',
};

const PIPELINE = ['not started', 'in progress', 'done'];
const PIPELINE_COLUMNS = [
  ['concept2d', '2D concept', 'ChatGPT'],
  ['runtime', 'Runtime', 'Claude Code'],
  ['model3d', '3D model', 'Blender'],
];
const QUEST_STATUSES = ['designed', 'coded', 'tested'];
const SQUISH_ART = ['concept', 'sprite', 'in-game'];

// Words that would suggest combat. Version 1 is combat-free, so the dashboard flags them.
const COMBAT_WORDS = /\b(combat|fight\w*|fought|battl\w*|attack\w*|weapons?|damage\w*|enem(?:y|ies)|defeat\w*|kill\w*|swords?|hit ?points)\b/i;

const db = {};
const loadErrors = [];
let searchIndex = [];

// ---------- HTML helpers ----------

class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function out(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(out).join('');
  return esc(v);
}
function html(strings, ...vals) {
  return raw(strings.reduce((acc, str, i) => acc + str + (i < vals.length ? out(vals[i]) : ''), ''));
}

const str = (x) => (typeof x === 'string' ? x.trim() : typeof x === 'number' ? String(x) : '');
const list = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);
const slug = (s) => str(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(str(c)) ? str(c) : '#9b8fb5');
const plural = (n, word, many = word + 's') => `${n} ${n === 1 ? word : many}`;

// ---------- Loading ----------

async function loadAll() {
  const rawData = {};
  await Promise.all(Object.entries(FILES).map(async ([key, file]) => {
    const path = `content/${file}.json`;
    try {
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`couldn't load it (HTTP ${res.status})`);
      const text = await res.text();
      try { rawData[key] = JSON.parse(text); } catch (e) { throw new Error(`the JSON has a typo: ${e.message}`); }
    } catch (e) {
      loadErrors.push({ path, message: e.message });
      rawData[key] = {};
    }
  }));
  normalize(rawData);
  buildSearchIndex();
}

// Accept either { "characters": [...] } or a bare array, and fill in missing fields.
function pick(obj, key) {
  return list(Array.isArray(obj) ? obj : obj && obj[key]);
}

function withIds(items, prefix, nameKey) {
  const seen = new Set();
  return items.map((it, i) => {
    let id = str(it.id) || slug(it[nameKey]) || `${prefix}-${i + 1}`;
    while (seen.has(id)) id += '-x';
    seen.add(id);
    return { ...it, id };
  });
}

function normalize(r) {
  db.chapters = withIds(pick(r.chapters, 'chapters'), 'chapter', 'name').map((c) => ({
    id: c.id, name: str(c.name) || 'Unnamed area', version: str(c.version), emoji: str(c.emoji) || '🏝️',
    color: safeColor(c.color), status: str(c.status), description: str(c.description), kennedysIdea: !!c.kennedysIdea,
  }));

  db.characters = withIds(pick(r.characters, 'characters'), 'character', 'name').map((c) => ({
    id: c.id, name: str(c.name) || 'Unnamed character', title: str(c.title), area: str(c.area),
    personality: str(c.personality), designNotes: str(c.designNotes), voiceLineStatus: str(c.voiceLineStatus),
    artStatus: str(c.artStatus), kennedysIdea: !!c.kennedysIdea,
  }));

  db.perArea = Number(r.squishes && r.squishes.perArea) || 20;
  const areaOrder = (a) => { const i = db.chapters.findIndex((c) => c.id === a); return i < 0 ? 999 : i; };
  db.squishes = withIds(pick(r.squishes, 'squishes'), 'squish', 'name').map((s, i) => ({
    id: s.id, area: str(s.area), slot: Number(s.slot) || i + 1, name: str(s.name), description: str(s.description),
    personality: str(s.personality), befriendingNotes: str(s.befriendingNotes), artStatus: str(s.artStatus),
    kennedysIdea: !!s.kennedysIdea,
  })).sort((a, b) => areaOrder(a.area) - areaOrder(b.area) || a.slot - b.slot);

  const t = (r.quests && r.quests.targets) || {};
  db.targets = { wake: Number(t.wake) || 9, island: Number(t.island) || 27 };
  db.quests = withIds(pick(r.quests, 'quests'), 'quest', 'title').map((q) => ({
    id: q.id, type: str(q.type).toLowerCase() === 'wake' ? 'wake' : 'island', title: str(q.title) || 'Untitled quest',
    chapter: str(q.chapter), giver: str(q.giver), objective: str(q.objective), status: str(q.status),
    notes: str(q.notes), kennedysIdea: !!q.kennedysIdea,
  }));

  db.voiceLines = withIds(pick(r.voiceLines, 'voiceLines'), 'line', 'text').map((v) => ({
    id: v.id, character: str(v.character), version: str(v.version), text: str(v.text), context: str(v.context),
    notes: str(v.notes), kennedysIdea: !!v.kennedysIdea,
  }));

  db.assets = withIds(pick(r.art, 'assets'), 'asset', 'name').map((a) => ({
    id: a.id, name: str(a.name) || 'Unnamed asset', kind: str(a.kind), linkedTo: str(a.linkedTo),
    concept2d: str(a.concept2d), runtime: str(a.runtime), model3d: str(a.model3d), notes: str(a.notes),
  }));

  db.testers = withIds(pick(r.playtests, 'testers'), 'tester', 'name').map((t2) => ({
    id: t2.id, name: str(t2.name) || 'Unnamed tester', about: str(t2.about),
  }));
  db.feedback = withIds(pick(r.playtests, 'feedback'), 'feedback', 'feedback').map((f) => ({
    id: f.id, tester: str(f.tester), date: str(f.date), linkedTo: str(f.linkedTo), feedback: str(f.feedback),
    status: str(f.status) || 'open', kennedysIdea: !!f.kennedysIdea,
  })).sort((a, b) => b.date.localeCompare(a.date));

  db.ideas = withIds(pick(r.ideas, 'ideas'), 'idea', 'title').map((i) => ({
    id: i.id, title: str(i.title) || 'Untitled idea', targetVersion: str(i.targetVersion), summary: str(i.summary),
    notes: str(i.notes), kennedysIdea: !!i.kennedysIdea,
  }));

  db.mechanics = withIds(pick(r.mechanics, 'mechanics'), 'mechanic', 'title').map((m) => ({
    id: m.id, title: str(m.title) || 'Untitled mechanic', summary: str(m.summary),
    rules: (Array.isArray(m.rules) ? m.rules : []).map(str).filter(Boolean), notes: str(m.notes), kennedysIdea: !!m.kennedysIdea,
  }));
}

// ---------- Lookups & small components ----------

const find = (coll, id) => db[coll].find((x) => x.id === id);
const chapter = (id) => find('chapters', id);
const characterName = (idOrName) => (find('characters', idOrName) || {}).name || idOrName;

function resolveLink(id) {
  if (!id) return null;
  const c = find('characters', id);
  if (c) return { label: c.name, href: `#/characters?focus=${c.id}`, kind: 'Character' };
  const q = find('quests', id);
  if (q) return { label: q.title, href: `#/quests?focus=${q.id}`, kind: 'Quest' };
  const s = find('squishes', id);
  if (s) return { label: s.name || `Squish #${s.slot}`, href: `#/squishes?focus=${s.id}`, kind: 'Squish' };
  const ch = chapter(id);
  if (ch) return { label: ch.name, href: '#/chapters', kind: 'Area' };
  return { label: id, href: null, kind: '' };
}

function areaChip(id) {
  if (!id) return html`<span class="chip st-not-set">No area yet</span>`;
  const c = chapter(id);
  if (!c) return html`<span class="chip">${id}</span>`;
  return html`<span class="chip area-chip" style="--area:${c.color}">${c.emoji} ${c.name}</span>`;
}

function statusChip(value, label) {
  const v = str(value);
  const cls = v ? 'st-' + slug(v) : 'st-not-set';
  return html`<span class="chip ${cls}">${label ? html`<span class="k">${label}:</span> ` : ''}${v || 'not set'}</span>`;
}

const kBadge = (item) => (item && item.kennedysIdea ? html`<span class="kennedy-badge" title="Kennedy is the design authority">⭐ Kennedy's idea</span>` : '');

function field(label, value, emptyText) {
  if (!value && !emptyText) return '';
  return html`<div class="field"><div class="field-label">${label}</div>${value
    ? html`<div class="field-value">${value}</div>`
    : html`<div class="todo">${emptyText}</div>`}</div>`;
}

function bar(parts, total) {
  const t = Math.max(total, 1);
  return html`<div class="bar">${parts.map(([n, cls]) => (n ? html`<span class="${cls}" style="width:${(n / t) * 100}%"></span>` : ''))}</div>`;
}

function emptyState(msg, file) {
  return html`<div class="empty">${msg}${file ? html`<br><span class="small">Add entries in <code>docs/content/${file}</code>. The README shows the format.</span>` : ''}</div>`;
}

// Deterministic squishy blob with a happy face, tinted per area.
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hexToHsl(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue * 60, s * 100, l * 100];
}
function blob(color, seed = 1, cls = 'blob') {
  const r = rng(seed * 9973);
  const [hue, sat, light] = hexToHsl(color);
  const fill = `hsl(${(hue + (r() - 0.5) * 36 + 360) % 360} ${Math.min(sat + 5, 90)}% ${Math.min(Math.max(light + (r() - 0.5) * 14, 45), 75)}%)`;
  const w = 32 + r() * 8, top = 22 + r() * 12, cx = 50, base = 80;
  const eyeY = 54 + r() * 4, gap = 9 + r() * 4;
  return html`<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">
    <ellipse cx="50" cy="88" rx="${w}" ry="6" fill="rgba(52,42,74,.12)"/>
    <path d="M${cx - w} ${base} C${cx - w - 4} ${top} ${cx + w + 4} ${top} ${cx + w} ${base} Q50 ${base + 8} ${cx - w} ${base} Z" fill="${fill}"/>
    <ellipse cx="${cx - w / 2}" cy="${top + 18}" rx="7" ry="4" fill="rgba(255,255,255,.55)" transform="rotate(-25 ${cx - w / 2} ${top + 18})"/>
    <circle cx="${cx - gap}" cy="${eyeY}" r="4" fill="#342a4a"/><circle cx="${cx + gap}" cy="${eyeY}" r="4" fill="#342a4a"/>
    <circle cx="${cx - gap + 1.3}" cy="${eyeY - 1.4}" r="1.3" fill="#fff"/><circle cx="${cx + gap + 1.3}" cy="${eyeY - 1.4}" r="1.3" fill="#fff"/>
    <ellipse cx="${cx - gap - 7}" cy="${eyeY + 7}" rx="5" ry="3" fill="rgba(255,120,150,.45)"/><ellipse cx="${cx + gap + 7}" cy="${eyeY + 7}" rx="5" ry="3" fill="rgba(255,120,150,.45)"/>
    <path d="M${cx - 5} ${eyeY + 8} Q50 ${eyeY + 14} ${cx + 5} ${eyeY + 8}" stroke="#342a4a" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// ---------- Search index ----------

function buildSearchIndex() {
  const idx = [];
  const add = (type, route, item, title, sub, parts) => idx.push({
    type, title, sub, href: `#/${route}?focus=${encodeURIComponent(item.id)}`, kennedy: !!item.kennedysIdea,
    text: parts.filter(Boolean).join(' · '),
  });
  const areaName = (id) => (chapter(id) || {}).name || id;

  db.chapters.forEach((c) => add('Area', 'chapters', c, c.name, [c.version, c.status].filter(Boolean).join(' · '), [c.description]));
  db.characters.forEach((c) => add('Character', 'characters', c, c.name, [c.title, areaName(c.area)].filter(Boolean).join(' · '), [c.personality, c.designNotes]));
  db.squishes.forEach((s) => add('Squish', 'squishes', s, s.name || `Unnamed squish #${s.slot}`, areaName(s.area), [s.description, s.personality, s.befriendingNotes]));
  db.quests.forEach((q) => add(q.type === 'wake' ? 'Wake quest' : 'Island quest', 'quests', q, q.title, [areaName(q.chapter), q.giver && characterName(q.giver)].filter(Boolean).join(' · '), [q.objective, q.notes]));
  db.voiceLines.forEach((v) => add('Voice line', 'voice-lines', v, `${characterName(v.character) || 'Someone'}${v.version ? ` (${v.version})` : ''}`, v.context, [v.text, v.notes]));
  db.ideas.forEach((i) => add('Parked idea', 'ideas', i, i.title, i.targetVersion, [i.summary, i.notes]));
  db.mechanics.forEach((m) => add('Mechanic', 'mechanics', m, m.title, '', [m.summary, ...m.rules, m.notes]));
  db.feedback.forEach((f) => add('Playtest note', 'playtests', f, `${(find('testers', f.tester) || {}).name || f.tester || 'Tester'}${f.date ? ` · ${f.date}` : ''}`, '', [f.feedback]));
  db.assets.forEach((a) => add('Art asset', 'art', a, a.name, a.kind, [a.notes]));
  searchIndex = idx;
}

function tokens(q) { return q.toLowerCase().split(/\s+/).filter(Boolean); }

function highlight(text, toks) {
  if (!toks.length) return esc(text);
  const re = new RegExp(`(${toks.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

function snippet(text, toks) {
  if (!text) return '';
  const lower = text.toLowerCase();
  const pos = Math.min(...toks.map((t) => { const p = lower.indexOf(t); return p < 0 ? Infinity : p; }));
  if (!isFinite(pos) || text.length <= 160) return text.slice(0, 160) + (text.length > 160 ? '…' : '');
  const start = Math.max(0, pos - 60);
  return (start ? '…' : '') + text.slice(start, start + 160) + (start + 160 < text.length ? '…' : '');
}

function combatFlags() {
  return searchIndex.flatMap((it) => {
    const m = `${it.title} ${it.sub} ${it.text}`.match(COMBAT_WORDS);
    return m ? [{ ...it, word: m[1] }] : [];
  });
}

// ---------- Views ----------

function pageHead(title, lede) {
  return html`<div class="page-head"><h1>${title}</h1>${lede ? html`<p class="lede">${lede}</p>` : ''}</div>`;
}

function dashboard() {
  const named = db.squishes.filter((s) => s.name).length;
  const totalSlots = Math.max(db.squishes.length, 1);
  const wake = db.quests.filter((q) => q.type === 'wake');
  const island = db.quests.filter((q) => q.type === 'island');
  const openFeedback = db.feedback.filter((f) => f.status !== 'addressed').length;
  const kennedyCount = searchIndex.filter((i) => i.kennedy).length;
  const flags = combatFlags();

  const tile = (href, ico, num, label, sub) => html`<a class="tile" href="${href}"><div class="tile-ico">${ico}</div><div class="tile-num">${num}</div><div class="tile-label">${label}</div>${sub ? html`<div class="tile-sub">${sub}</div>` : ''}</a>`;

  const questBar = (qs, target, label) => {
    const n = (s) => qs.filter((q) => q.status === s).length;
    return html`<div class="field">
      <div class="row" style="justify-content:space-between"><strong>${label}</strong><span class="subtitle">${qs.length} of ${target} written</span></div>
      ${bar([[n('tested'), 'done'], [n('coded'), 'fill'], [n('designed'), 'prog']], Math.max(target, qs.length))}
      <div class="legend"><span><i style="background:#ffc93c"></i>${n('designed')} designed</span><span><i style="background:#1f9ea8"></i>${n('coded')} coded</span><span><i style="background:#58c47c"></i>${n('tested')} tested</span></div>
    </div>`;
  };

  const artBar = ([key, label, tool]) => {
    const n = (s) => db.assets.filter((a) => a[key] === s).length;
    return html`<div class="field">
      <div class="row" style="justify-content:space-between"><strong>${label} <span class="subtitle">(${tool})</span></strong><span class="subtitle">${n('done')} of ${db.assets.length} done</span></div>
      ${bar([[n('done'), 'done'], [n('in progress'), 'prog']], db.assets.length)}
      <div class="legend"><span><i style="background:#58c47c"></i>${n('done')} done</span><span><i style="background:#ffc93c"></i>${n('in progress')} in progress</span><span><i style="background:#f1eadc"></i>${db.assets.length - n('done') - n('in progress')} not started or not set</span></div>
    </div>`;
  };

  const heroColors = db.chapters.length ? db.chapters.map((c) => c.color) : ['#ff9fb8', '#5fb2e6', '#46ad68'];

  return html`
    <section class="hero">
      <div class="blobs">${heroColors.slice(0, 3).map((c, i) => blob(c, i + 3))}</div>
      <div>
        <h1>Welcome to Squish Island!</h1>
        <p class="lede" style="margin:0">This is the one true book of everything on the island: every area, friend, squish, and quest. Kennedy is the design authority, so anything with a <span class="kennedy-badge">⭐ Kennedy's idea</span> badge came from her.</p>
      </div>
    </section>

    <div class="tiles">
      ${tile('#/chapters', '🗺️', db.chapters.length, 'Chapters & areas', db.chapters.map((c) => c.version).filter(Boolean).join(' · '))}
      ${tile('#/characters', '🎭', db.characters.length, 'Characters', '')}
      ${tile('#/squishes', '🫧', `${named}/${db.squishes.length}`, 'Squishes named', `${db.perArea} per area`)}
      ${tile('#/quests', '🌅', `${wake.length}/${db.targets.wake}`, 'Wake quests', `${wake.filter((q) => q.status === 'tested').length} tested`)}
      ${tile('#/quests?type=island', '🧭', `${island.length}/${db.targets.island}`, 'Island quests', `${island.filter((q) => q.status === 'tested').length} tested`)}
      ${tile('#/voice-lines', '🎙️', db.voiceLines.length, 'Voice lines', '')}
      ${tile('#/art', '🎨', db.assets.length, 'Art assets', '')}
      ${tile('#/playtests', '🧪', openFeedback, 'Open playtest notes', plural(db.testers.length, 'tester'))}
      ${tile('#/ideas', '💭', db.ideas.length, 'Parked ideas', 'Not in scope yet')}
      ${tile('#/kennedy', '⭐', kennedyCount, "Kennedy's ideas", '')}
    </div>

    <div class="two-col" style="margin-top:20px">
      <section class="card">
        <h3>🧭 Quest progress</h3>
        ${questBar(wake, db.targets.wake, 'Wake quests')}
        ${questBar(island, db.targets.island, 'Island quests')}
      </section>
      <section class="card">
        <h3>🎨 Art pipeline</h3>
        ${db.assets.length ? PIPELINE_COLUMNS.map(artBar) : html`<p class="todo" style="margin-top:10px">No art assets listed yet.</p>`}
      </section>
      <section class="card">
        <h3>🗺️ Chapters</h3>
        ${db.chapters.map((c) => {
          const sq = db.squishes.filter((s) => s.area === c.id);
          return html`<div class="field"><div class="row"><strong>${c.emoji} ${c.name}</strong>${c.version ? html`<span class="chip version-chip">${c.version}</span>` : ''}${statusChip(c.status)}</div>
            ${sq.length ? html`${bar([[sq.filter((s) => s.name).length, 'fill']], sq.length)}<div class="legend">${sq.filter((s) => s.name).length} of ${sq.length} squishes named</div>` : ''}</div>`;
        })}
      </section>
      <section class="card">
        <h3>🌈 Island rules</h3>
        <ul class="rules" style="padding-left:20px;margin:10px 0">
          <li><strong>Kennedy is the design authority.</strong> Her ideas get the ⭐ badge everywhere they appear.</li>
          <li><strong>Version 1 has no combat.</strong> Squishes are befriended, and the island is cozy all the way through.</li>
          <li><strong>The JSON files are the source of truth.</strong> Change <code>docs/content/</code>, and this site follows.</li>
        </ul>
        ${flags.length
          ? html`<div class="warn"><strong>Cozy check:</strong> these entries use words that sound like combat. Take a look:
              <ul style="margin:6px 0 0;padding-left:20px">${flags.map((f) => html`<li><a href="${f.href}">${f.type}: ${f.title}</a> (“${f.word}”)</li>`)}</ul></div>`
          : html`<div class="chip st-done">✓ Cozy check passed: no combat words found</div>`}
      </section>
    </div>`;
}

function chaptersView() {
  return html`${pageHead('Chapters & Areas', 'Each chapter of Squish Island is its own area, with its own friends and squishes to meet.')}
    ${db.chapters.length ? html`<div class="grid wide">${db.chapters.map((c) => {
      const chars = db.characters.filter((x) => x.area === c.id);
      const sq = db.squishes.filter((s) => s.area === c.id);
      const qs = db.quests.filter((q) => q.chapter === c.id);
      return html`<article class="card ${c.kennedysIdea ? 'kennedy' : ''}" id="item-${c.id}" style="border-top:8px solid ${c.color}">
        <div class="card-top"><div style="font-size:40px;line-height:1">${c.emoji}</div>
          <div class="grow"><h3>${c.name}</h3><div class="meta">${c.version ? html`<span class="chip version-chip">${c.version}</span>` : ''}${statusChip(c.status, 'Status')}</div></div>
          ${kBadge(c)}</div>
        ${field('Description', c.description, 'No description yet.')}
        <div class="meta" style="margin-top:12px">
          <a class="chip" href="#/characters">${plural(chars.length, 'character')}</a>
          <a class="chip" href="#/squishes?area=${c.id}">${sq.filter((s) => s.name).length}/${sq.length || db.perArea} squishes named</a>
          <a class="chip" href="#/quests">${plural(qs.length, 'quest')}</a>
        </div>
      </article>`;
    })}</div>` : emptyState('No chapters yet.', 'chapters.json')}`;
}

function charactersView() {
  return html`${pageHead('Characters', 'The friends and elders who live around the island.')}
    ${db.characters.length ? html`<div class="grid wide">${db.characters.map((c) => {
      const lines = db.voiceLines.filter((v) => v.character === c.id || v.character === c.name).length;
      const color = (chapter(c.area) || {}).color || '#ff9fb8';
      return html`<article class="card ${c.kennedysIdea ? 'kennedy' : ''}" id="item-${c.id}">
        <div class="card-top">${blob(color, c.name.length * 7 + 1, 'blob')}
          <div class="grow"><h3>${c.name}</h3>${c.title ? html`<div class="subtitle">${c.title}</div>` : ''}<div class="meta">${areaChip(c.area)}${kBadge(c)}</div></div>
        </div>
        <div class="meta">${statusChip(c.voiceLineStatus, 'Voice lines')}${statusChip(c.artStatus, 'Art')}</div>
        ${field('Personality', c.personality, 'Not written yet.')}
        ${field('Design notes', c.designNotes, 'Not written yet.')}
        <div class="field"><a href="#/voice-lines?character=${encodeURIComponent(c.id)}">${plural(lines, 'voice line')} →</a></div>
      </article>`;
    })}</div>` : emptyState('No characters yet.', 'characters.json')}`;
}

function squishesView(params) {
  const areaIds = [...new Set([...db.chapters.map((c) => c.id).filter((id) => db.squishes.some((s) => s.area === id)), ...db.squishes.map((s) => s.area)])];
  const active = areaIds.includes(params.get('area')) ? params.get('area') : 'all';
  const shown = active === 'all' ? areaIds : [active];

  const card = (s) => {
    const c = chapter(s.area);
    const empty = !s.name && !s.description && !s.personality && !s.befriendingNotes;
    return html`<article class="card squish ${empty ? 'placeholder' : ''} ${s.kennedysIdea ? 'kennedy' : ''}" id="item-${s.id}">
      <span class="slot">#${String(s.slot).padStart(2, '0')}</span>
      ${blob(c ? c.color : '#ff9fb8', s.slot + (c ? c.name.length * 31 : 0))}
      <h3>${s.name || html`<span class="todo">Unnamed squish</span>`}</h3>
      <div class="meta" style="justify-content:center">${statusChip(s.artStatus, 'Art')}${kBadge(s)}</div>
      ${empty ? html`<p class="todo small">Waiting for a name and a story.</p>` : html`
        ${field('Description', s.description)}
        ${field('Personality', s.personality)}
        ${field('How to befriend', s.befriendingNotes)}`}
    </article>`;
  };

  return html`${pageHead('Squishes', `The squishy creatures you befriend on the island, ${db.perArea} in each area.`)}
    <div class="tabs">
      <a class="tab ${active === 'all' ? 'active' : ''}" href="#/squishes">All areas</a>
      ${areaIds.map((id) => html`<a class="tab ${active === id ? 'active' : ''}" href="#/squishes?area=${id}">${(chapter(id) || {}).emoji || ''} ${(chapter(id) || {}).name || id || 'No area'}</a>`)}
    </div>
    ${db.squishes.length ? shown.map((id) => {
      const sq = db.squishes.filter((s) => s.area === id);
      const namedCount = sq.filter((s) => s.name).length;
      const c = chapter(id);
      return html`<div class="area-head"><h2>${c ? `${c.emoji} ${c.name}` : id || 'No area'}</h2>${bar([[namedCount, 'fill']], Math.max(db.perArea, sq.length))}<span class="subtitle">${namedCount}/${Math.max(db.perArea, sq.length)} named</span></div>
        <div class="squish-grid">${sq.map(card)}</div>`;
    }) : emptyState('No squishes yet.', 'squishes.json')}`;
}

function questsView(params) {
  const type = params.get('type') === 'island' ? 'island' : params.get('type') === 'wake' ? 'wake' : 'all';
  const status = params.get('status') || '';
  const qs = db.quests.filter((q) => (type === 'all' || q.type === type) && (!status || q.status === status));
  const link = (t, s) => `#/quests?${new URLSearchParams({ ...(t !== 'all' && { type: t }), ...(s && { status: s }) })}`;

  const card = (q) => {
    const giver = q.giver ? resolveLink(q.giver) : null;
    return html`<article class="card ${q.kennedysIdea ? 'kennedy' : ''}" id="item-${q.id}">
      <div class="card-top"><div class="grow"><h3>${q.title}</h3><div class="meta">${areaChip(q.chapter)}${statusChip(q.status)}${kBadge(q)}</div></div></div>
      <div class="field"><div class="field-label">Quest giver</div>${giver ? (giver.href ? html`<a href="${giver.href}">${giver.label}</a>` : giver.label) : html`<span class="todo">Not decided yet.</span>`}</div>
      ${field('Objective', q.objective, 'Not written yet.')}
      ${field('Notes', q.notes)}
    </article>`;
  };

  const section = (t, label, target, blurb) => {
    const items = qs.filter((q) => q.type === t);
    const all = db.quests.filter((q) => q.type === t);
    return html`<div class="area-head"><h2>${label}</h2>${bar([[all.length, 'fill']], Math.max(target, all.length))}<span class="subtitle">${all.length} of ${target}</span></div>
      <p class="subtitle" style="margin-top:-6px">${blurb}</p>
      ${items.length ? html`<div class="grid wide">${items.map(card)}</div>`
        : all.length ? html`<div class="empty">No ${label.toLowerCase()} match this filter.</div>` : emptyState(`No ${label.toLowerCase()} written yet.`, 'quests.json')}`;
  };

  return html`${pageHead('Quests', `${db.targets.wake} wake quests and about ${db.targets.island} island quests make up the adventure.`)}
    <div class="tabs">
      <a class="tab ${type === 'all' ? 'active' : ''}" href="${link('all', status)}">All quests</a>
      <a class="tab ${type === 'wake' ? 'active' : ''}" href="${link('wake', status)}">🌅 Wake quests</a>
      <a class="tab ${type === 'island' ? 'active' : ''}" href="${link('island', status)}">🧭 Island quests</a>
    </div>
    <div class="tabs">
      <a class="tab ${!status ? 'active' : ''}" href="${link(type, '')}">Any status</a>
      ${QUEST_STATUSES.map((s) => html`<a class="tab ${status === s ? 'active' : ''}" href="${link(type, s)}">${s}</a>`)}
    </div>
    ${type !== 'island' ? section('wake', 'Wake quests', db.targets.wake, 'The main path.') : ''}
    ${type !== 'wake' ? section('island', 'Island quests', db.targets.island, 'Side adventures around the island.') : ''}`;
}

function voiceLinesView(params) {
  const chars = [...new Map([
    ...db.characters.map((c) => [c.id, c.name]),
    ...db.voiceLines.filter((v) => v.character && !find('characters', v.character)).map((v) => [v.character, v.character]),
  ]).entries()];
  const versions = [...new Set([...db.chapters.map((c) => c.version), ...db.voiceLines.map((v) => v.version)].filter(Boolean))].sort();
  const initialChar = params.get('character') || '';

  queueMicrotask(() => {
    const q = document.getElementById('vl-q');
    const c = document.getElementById('vl-char');
    const v = document.getElementById('vl-ver');
    if (!q) return;
    const update = () => {
      const toks = tokens(q.value);
      const rows = db.voiceLines.filter((l) => {
        const who = find('characters', l.character);
        if (c.value && l.character !== c.value && !(who && who.id === c.value)) return false;
        if (v.value && l.version !== v.value) return false;
        const hay = `${l.text} ${l.context} ${l.notes} ${characterName(l.character)} ${l.version}`.toLowerCase();
        return toks.every((t) => hay.includes(t));
      });
      document.getElementById('vl-count').textContent = `${plural(rows.length, 'line')} shown`;
      document.getElementById('vl-list').innerHTML = rows.length
        ? rows.map((l) => html`<article class="card line-card ${l.kennedysIdea ? 'kennedy' : ''}" id="item-${l.id}">
            <div style="min-width:130px"><strong>${characterName(l.character) || 'Unknown'}</strong><div class="meta">${l.version ? html`<span class="chip version-chip">${l.version}</span>` : ''}${kBadge(l)}</div></div>
            <div class="grow"><div class="bubble">${raw(highlight(l.text, toks))}</div>${l.context ? html`<div class="subtitle" style="margin-top:6px">${l.context}</div>` : ''}${l.notes ? html`<div class="small todo">${l.notes}</div>` : ''}</div>
          </article>`.s).join('<div style="height:10px"></div>')
        : (db.voiceLines.length ? html`<div class="empty">No lines match.</div>` : emptyState('No voice lines yet.', 'voice-lines.json')).s;
    };
    [q, c, v].forEach((el) => el.addEventListener('input', update));
    update();
    focusItem();
  });

  return html`${pageHead('Voice lines', 'Everything the characters say, searchable by who says it and which version it belongs to.')}
    <div class="filters">
      <input id="vl-q" type="search" placeholder="Search the lines…" aria-label="Search voice lines">
      <select id="vl-char" aria-label="Character"><option value="">All characters</option>${chars.map(([id, name]) => html`<option value="${id}" ${id === initialChar ? 'selected' : ''}>${name}</option>`)}</select>
      <select id="vl-ver" aria-label="Version"><option value="">All versions</option>${versions.map((v) => html`<option value="${v}">${v}</option>`)}</select>
    </div>
    <p class="subtitle" id="vl-count"></p>
    <div id="vl-list"></div>`;
}

function artView() {
  const linkCell = (a) => {
    const l = resolveLink(a.linkedTo);
    return html`<strong>${a.name}</strong>${a.kind ? html`<div class="subtitle">${a.kind}</div>` : ''}${l && l.href ? html`<div class="small"><a href="${l.href}">${l.kind || 'Open'} →</a></div>` : ''}`;
  };
  return html`${pageHead('Art pipeline', 'Every asset goes through three steps: a 2D concept, the runtime version in the game, and a 3D model.')}
    <div class="two-col" style="margin-bottom:18px">${PIPELINE_COLUMNS.map(([key, label, tool]) => {
      const n = (s) => db.assets.filter((a) => a[key] === s).length;
      return html`<div class="card"><h3>${label}</h3><div class="subtitle">${tool}</div>${bar([[n('done'), 'done'], [n('in progress'), 'prog']], db.assets.length)}<div class="legend"><span>${n('done')} done</span><span>${n('in progress')} in progress</span><span>${n('not started')} not started</span></div></div>`;
    })}</div>
    ${db.assets.length ? html`<div class="table-wrap"><table>
      <thead><tr><th>Asset</th>${PIPELINE_COLUMNS.map(([, label, tool]) => html`<th>${label}<small>${tool}</small></th>`)}<th>Notes</th></tr></thead>
      <tbody>${db.assets.map((a) => html`<tr id="item-${a.id}"><td>${linkCell(a)}</td>${PIPELINE_COLUMNS.map(([key]) => html`<td>${statusChip(a[key])}</td>`)}<td>${a.notes || html`<span class="todo">–</span>`}</td></tr>`)}</tbody>
    </table></div>` : emptyState('No art assets yet.', 'art.json')}`;
}

function playtestsView(params) {
  const filter = ['open', 'addressed'].includes(params.get('status')) ? params.get('status') : 'all';
  const items = db.feedback.filter((f) => filter === 'all' || f.status === filter);
  return html`${pageHead('Playtest feedback', 'What our playtesters noticed, and whether we have handled it yet.')}
    <h2 style="margin-top:0">Playtesters</h2>
    ${db.testers.length ? html`<div class="grid">${db.testers.map((t) => html`<article class="card" id="item-${t.id}">
      <h3>🧪 ${t.name}</h3>${t.about ? html`<p class="subtitle" style="margin-top:4px">${t.about}</p>` : ''}
      <div class="meta">${html`<span class="chip">${plural(db.feedback.filter((f) => f.tester === t.id).length, 'note')}</span>`}</div>
    </article>`)}</div>` : emptyState('No playtesters yet.', 'playtests.json')}
    <h2>Feedback log</h2>
    <div class="tabs">${['all', 'open', 'addressed'].map((s) => html`<a class="tab ${filter === s ? 'active' : ''}" href="#/playtests${s === 'all' ? '' : `?status=${s}`}">${s === 'all' ? 'Everything' : s}</a>`)}</div>
    ${items.length ? html`<div class="grid wide">${items.map((f) => {
      const t = find('testers', f.tester);
      const l = resolveLink(f.linkedTo);
      return html`<article class="card ${f.kennedysIdea ? 'kennedy' : ''}" id="item-${f.id}">
        <div class="card-top"><div class="grow"><h3>${t ? t.name : f.tester || 'Unknown tester'}</h3><div class="subtitle">${f.date || 'No date'}</div></div>${statusChip(f.status)}</div>
        ${l ? html`<div class="meta"><span class="chip">${l.kind ? `${l.kind}: ` : ''}${l.href ? html`<a href="${l.href}">${l.label}</a>` : l.label}</span>${kBadge(f)}</div>` : kBadge(f)}
        ${field('Feedback', f.feedback, 'No feedback text.')}
      </article>`;
    })}</div>` : db.feedback.length ? html`<div class="empty">Nothing ${filter} right now.</div>` : emptyState('No feedback logged yet.', 'playtests.json')}`;
}

function ideasView() {
  return html`${pageHead('Ideas parking lot', 'Future ideas that are not part of the current version. Parked here so they are not forgotten.')}
    ${db.ideas.length ? html`<div class="grid wide">${db.ideas.map((i) => html`<article class="card ${i.kennedysIdea ? 'kennedy' : ''}" id="item-${i.id}">
      <div class="card-top"><div style="font-size:30px">💭</div><div class="grow"><h3>${i.title}</h3><div class="meta">${i.targetVersion ? html`<span class="chip version-chip">${i.targetVersion}</span>` : html`<span class="chip">Someday</span>`}${kBadge(i)}</div></div></div>
      ${field('The idea', i.summary, 'Not written yet.')}
      ${field('Notes', i.notes)}
    </article>`)}</div>` : emptyState('No parked ideas yet.', 'ideas.json')}`;
}

function mechanicsView() {
  return html`${pageHead('Mechanics notes', 'Short reference pages for how the core systems work.')}
    ${db.mechanics.length ? html`<div class="grid wide">${db.mechanics.map((m) => html`<article class="card ${m.kennedysIdea ? 'kennedy' : ''}" id="item-${m.id}">
      <div class="card-top"><div style="font-size:30px">⚙️</div><div class="grow"><h3>${m.title}</h3>${kBadge(m)}</div></div>
      ${m.summary ? html`<p>${m.summary}</p>` : ''}
      ${m.rules.length ? html`<div class="field-label">Rules</div><ul class="rule-list">${m.rules.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
      ${field('Notes', m.notes)}
    </article>`)}</div>` : emptyState('No mechanics notes yet.', 'mechanics.json')}`;
}

function resultsList(items, toks) {
  return items.map((it) => html`<a class="card result" href="${it.href}">
    <div class="row"><span class="type">${it.type}</span>${it.kennedy ? html`<span class="kennedy-badge">⭐ Kennedy's idea</span>` : ''}</div>
    <h3>${raw(highlight(it.title, toks))}</h3>
    ${it.sub ? html`<div class="subtitle">${raw(highlight(it.sub, toks))}</div>` : ''}
    ${it.text ? html`<div class="snippet">${raw(highlight(snippet(it.text, toks), toks))}</div>` : ''}
  </a>`);
}

function searchView(params) {
  const q = params.get('q') || '';
  const toks = tokens(q);
  if (!toks.length) return html`${pageHead('Search', 'Type in the search box at the top to look through characters, squishes, quests, voice lines, ideas, and notes.')}`;
  const hits = searchIndex
    .filter((it) => { const hay = `${it.type} ${it.title} ${it.sub} ${it.text}`.toLowerCase(); return toks.every((t) => hay.includes(t)); })
    .sort((a, b) => Number(toks.some((t) => b.title.toLowerCase().includes(t))) - Number(toks.some((t) => a.title.toLowerCase().includes(t))));
  return html`${pageHead(`Search: “${q}”`, hits.length ? `${plural(hits.length, 'match', 'matches')} found.` : 'Nothing found. Try a shorter word.')}
    ${resultsList(hits, toks)}`;
}

function kennedyView() {
  const items = searchIndex.filter((i) => i.kennedy);
  return html`${pageHead("⭐ Kennedy's ideas", 'Kennedy is the design authority on Squish Island. Here is everything that came from her.')}
    ${items.length ? resultsList(items, []) : html`<div class="empty">Nothing is marked yet. Add <code>"kennedysIdea": true</code> to any entry in the content files and it will show up here with her badge.</div>`}`;
}

// ---------- Router ----------

const ROUTES = [
  { path: '', label: 'Dashboard', ico: '🏝️', view: dashboard },
  { path: 'chapters', label: 'Chapters & Areas', ico: '🗺️', view: chaptersView, count: () => db.chapters.length },
  { path: 'characters', label: 'Characters', ico: '🎭', view: charactersView, count: () => db.characters.length },
  { path: 'squishes', label: 'Squishes', ico: '🫧', view: squishesView, count: () => db.squishes.length },
  { path: 'quests', label: 'Quests', ico: '🧭', view: questsView, count: () => db.quests.length },
  { path: 'voice-lines', label: 'Voice lines', ico: '🎙️', view: voiceLinesView, count: () => db.voiceLines.length },
  { path: 'art', label: 'Art pipeline', ico: '🎨', view: artView, count: () => db.assets.length },
  { path: 'playtests', label: 'Playtests', ico: '🧪', view: playtestsView, count: () => db.feedback.length },
  { path: 'ideas', label: 'Ideas parking lot', ico: '💭', view: ideasView, count: () => db.ideas.length },
  { path: 'mechanics', label: 'Mechanics', ico: '⚙️', view: mechanicsView, count: () => db.mechanics.length },
  { path: 'kennedy', label: "Kennedy's ideas", ico: '⭐', view: kennedyView, count: () => searchIndex.filter((i) => i.kennedy).length, cls: 'kennedy-link' },
  { path: 'search', label: 'Search', ico: '🔎', view: searchView, hidden: true },
];

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  return { path, params: new URLSearchParams(query) };
}

function renderNav(active) {
  document.getElementById('nav').innerHTML = ROUTES.filter((r) => !r.hidden).map((r) => html`<a href="#/${r.path}" class="${r.path === active ? 'active' : ''} ${r.cls || ''}">
    <span class="ico">${r.ico}</span><span>${r.label}</span>${r.count ? html`<span class="count">${r.count()}</span>` : ''}</a>`.s).join('');
}

function errorBanner() {
  if (!loadErrors.length) return '';
  return html`<div class="errors"><strong>Some content couldn't be read.</strong> The rest of the bible still works. Fix these files and reload:
    <ul style="margin:6px 0 0;padding-left:20px">${loadErrors.map((e) => html`<li><code>${e.path}</code>: ${e.message}</li>`)}</ul></div>`;
}

function focusItem() {
  const id = parseHash().params.get('focus');
  if (!id) return;
  const el = document.getElementById(`item-${id}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center' });
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

let lastPath = null;
function render() {
  const { path, params } = parseHash();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  renderNav(route.path);
  const main = document.getElementById('main');
  main.innerHTML = out(errorBanner()) + route.view(params).s;
  document.title = route.path ? `${route.label} · Squish Island Lore Bible` : 'Squish Island Lore Bible';
  const input = document.getElementById('search-input');
  if (route.path === 'search') { if (document.activeElement !== input) input.value = params.get('q') || ''; } else input.value = '';
  if (params.get('focus')) requestAnimationFrame(focusItem);
  else if (route.path !== lastPath) window.scrollTo(0, 0);
  lastPath = route.path;
}

let searchTimer;
function wireSearch() {
  const input = document.getElementById('search-input');
  const go = () => {
    const q = input.value.trim();
    const target = q ? `#/search?q=${encodeURIComponent(q)}` : '#/search';
    if (parseHash().path === 'search') history.replaceState(null, '', target);
    else history.pushState(null, '', target);
    render();
  };
  input.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(go, 150); });
  document.getElementById('search-form').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); go(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
  });
}

(async () => {
  await loadAll();
  wireSearch();
  window.addEventListener('hashchange', render);
  render();
})();
