import {
  extractYouTubeId, ytThumb, ytWatch, safeUrl, countWords,
  buildBrainstormPrompt, buildScorePrompt, parseBrainstorm, parseScore, SCORE_KEYS,
} from './shared.js';

const SEED_TITLES = [
  'Vegas on a Budget (with Kennedy)',
  'St. Martin Trip Cost',
  'St. Martin Resort & Room Tour',
  'Maho Beach Airplane Experience',
  'Anguilla Day Trip',
  'French Side Day Trip',
  'Full St. Martin Trip Documentary',
  'Gatlinburg',
  'Bahia Principe Jamaica',
  'Sandals Ochi vs. Moon Palace: Back-to-Back Comparison',
  'Moon Palace Jamaica: Full Honest Resort Review',
  'The Group Trip Experience (Sandals Ochi)',
  'Is Sandals Ochi Club Level Worth the Upgrade?',
  'Moon Palace Jamaica with Kids',
  'What Our 8-Day Jamaica Trip ACTUALLY Cost',
  'Breathless Riviera Cancun',
  'Moon Palace Jamaica vs. Moon Palace Cancun: Side-by-Side',
];
const STATUSES = ['idea', 'drafted', 'designed', 'published'];
const NEW_VIDEO = '__new__';
const MAX_OVERLAY_WORDS = 4;

let vault = null;
let lastRev = null;

const ui = {
  view: 'list',          // 'list' | 'video' | 'capture'
  videoId: null,
  tab: 'ideas',          // 'ideas' | 'gallery'
  search: '',
  addingVideo: false,
  insertAfterId: null,   // position preset for the add-video form ('' = top)
  editingVideo: false,
  addingIdea: false,
  editingIdeaId: null,
  scoringIdeaId: null,
  showBrainstorm: false,
  editingNoteId: null,
  capture: null,
  captureFrom: null,     // video that was open when a capture arrived
};

const uid = () => crypto.randomUUID();
const $ = (sel) => document.querySelector(sel);

// ---------- Tiny DOM helper (never uses innerHTML, so pasted text is safe) ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'selected', 'disabled', 'draggable', 'hidden', 'open'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

const field = (label, control, hint) => h('label', { class: 'field' }, h('span', null, label), control, hint);

// ---------- Data ----------

function newVideo({ title, trip = '', notes = '' }) {
  return { id: uid(), title: title.trim(), trip: trip.trim(), notes: notes.trim(), ideas: [], gallery: [], createdAt: Date.now() };
}

function newIdea(fields) {
  return { id: uid(), concept: '', overlay: '', notes: '', status: 'idea', refImage: null, ai: false, score: null, createdAt: Date.now(), ...fields };
}

function seedVault() {
  return { version: 1, lastCaptureVideoId: null, videos: SEED_TITLES.map((title) => newVideo({ title, trip: 'Backlog' })) };
}

const str = (x) => (typeof x === 'string' ? x : '');
const arr = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);

function normalizeScore(s) {
  if (!s || typeof s !== 'object') return null;
  const out = { improvement: str(s.improvement), scoredAt: s.scoredAt || Date.now() };
  for (const [k] of SCORE_KEYS) if (typeof s[k] === 'number') out[k] = s[k];
  out.average = typeof s.average === 'number' ? s.average : null;
  return out;
}

// Used on load and on import so bad or older data can't break the UI.
function normalizeVault(v) {
  return {
    version: 1,
    rev: v.rev || null,
    lastCaptureVideoId: str(v.lastCaptureVideoId) || null,
    videos: arr(v.videos).map((x) => ({
      id: str(x.id) || uid(),
      title: str(x.title) || 'Untitled video',
      trip: str(x.trip),
      notes: str(x.notes),
      createdAt: x.createdAt || Date.now(),
      ideas: arr(x.ideas).map((i) => ({
        id: str(i.id) || uid(),
        concept: str(i.concept),
        overlay: str(i.overlay),
        notes: str(i.notes),
        status: STATUSES.includes(i.status) ? i.status : 'idea',
        refImage: /^data:image\//.test(str(i.refImage)) ? i.refImage : null,
        ai: !!i.ai,
        score: normalizeScore(i.score),
        createdAt: i.createdAt || Date.now(),
      })),
      gallery: arr(x.gallery).map((g) => ({
        id: str(g.id) || uid(),
        imageUrl: safeUrl(g.imageUrl),
        sourceUrl: safeUrl(g.sourceUrl),
        videoUrl: safeUrl(g.videoUrl),
        youtubeId: str(g.youtubeId) || null,
        pageTitle: str(g.pageTitle),
        note: str(g.note),
        createdAt: g.createdAt || Date.now(),
      })),
    })),
  };
}

async function loadVault() {
  const { vault: stored } = await chrome.storage.local.get('vault');
  if (stored && Array.isArray(stored.videos)) {
    vault = normalizeVault(stored);
    lastRev = vault.rev;
  } else {
    vault = seedVault();
    await save();
  }
}

async function save() {
  vault.rev = uid();
  vault.updatedAt = Date.now();
  lastRev = vault.rev;
  try {
    await chrome.storage.local.set({ vault });
  } catch (e) {
    toast('Could not save: ' + e.message);
  }
}

const getVideo = (id) => vault.videos.find((v) => v.id === id);
const indexOf = (id) => vault.videos.findIndex((v) => v.id === id);
const trips = () => [...new Set(vault.videos.map((v) => v.trip).filter(Boolean))];

function moveVideo(from, to) {
  if (from === to || from < 0 || to < 0 || to >= vault.videos.length) return;
  const [v] = vault.videos.splice(from, 1);
  vault.videos.splice(to, 0, v);
}

// ---------- Feedback ----------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2800);
}

function confirmDialog(message, okLabel = 'Delete') {
  const dlg = $('#confirm');
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

// Downscale uploaded reference images so the vault stays small.
function fileToDataUrl(file, max = 960) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s);
      c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image')); };
    img.src = url;
  });
}

function thumbImg(src, alt = '') {
  const img = h('img', { src, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(h('span', { class: 'muted small pad' }, 'Image unavailable')), { once: true });
  return img;
}

// ---------- Rendering ----------

function render() {
  if (ui.view === 'video' && !getVideo(ui.videoId)) ui.view = 'list';
  const app = $('#app');
  const view = ui.view === 'capture' ? captureView() : ui.view === 'video' ? videoView() : listView();
  app.replaceChildren(view);
}

function openVideo(id, tab = 'ideas') {
  Object.assign(ui, {
    view: 'video', videoId: id, tab, editingVideo: false, addingIdea: false,
    editingIdeaId: null, scoringIdeaId: null, showBrainstorm: false, editingNoteId: null,
  });
  render();
  window.scrollTo(0, 0);
}

// ----- List view -----

function listView() {
  const search = h('input', {
    type: 'search',
    placeholder: 'Search videos…',
    value: ui.search,
    oninput: (e) => { ui.search = e.target.value; renderVideoList(); },
  });

  const wrap = h('div', null,
    h('div', { class: 'header row between' },
      h('div', null, h('h1', null, 'Thumbnail Vault'), h('div', { class: 'brand-sub' }, 'Mays Family Travels')),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', title: 'Download the whole vault as JSON', onclick: exportVault }, 'Export'),
        h('button', { class: 'btn small', title: 'Replace the vault from a JSON export', onclick: () => $('#import-file').click() }, 'Import'),
      ),
    ),
    h('div', { class: 'toolbar row' },
      h('div', { class: 'grow' }, search),
      h('button', { class: 'btn primary', onclick: () => { ui.addingVideo = true; ui.insertAfterId = null; render(); } }, '+ Add video'),
    ),
    ui.addingVideo ? addVideoForm() : null,
    h('div', { id: 'video-list' }),
  );
  queueMicrotask(renderVideoList);
  return wrap;
}

function renderVideoList() {
  const list = $('#video-list');
  if (!list) return;
  const q = ui.search.trim().toLowerCase();
  const searching = !!q;
  const rows = [];
  let lastTrip = null;

  vault.videos.forEach((v, i) => {
    if (searching && !`${v.title} ${v.trip} ${v.notes}`.toLowerCase().includes(q)) return;
    const trip = v.trip || 'No trip';
    if (trip !== lastTrip) {
      rows.push(h('div', { class: 'trip-heading' }, trip));
      lastTrip = trip;
    }
    rows.push(videoRow(v, i, searching));
  });

  if (!vault.videos.length) rows.push(h('div', { class: 'empty' }, 'No videos yet. Add one to get started.'));
  else if (!rows.length) rows.push(h('div', { class: 'empty' }, `No videos match “${ui.search}”.`));
  list.replaceChildren(...rows);
}

let dragId = null;

function videoRow(v, i, searching) {
  const last = vault.videos.length - 1;
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };
  const ideaCount = v.ideas.length;
  const shotCount = v.gallery.length;

  const row = h('div', {
    class: 'video-row',
    draggable: !searching,
    tabindex: '0',
    onclick: () => openVideo(v.id),
    onkeydown: (e) => { if (e.key === 'Enter' && e.target === row) openVideo(v.id); },
  },
    searching ? null : h('span', { class: 'handle', title: 'Drag to reorder' }, '⋮⋮'),
    h('span', { class: 'num' }, i + 1),
    h('span', { class: 'video-title' }, v.title),
    h('span', { class: 'counts' },
      h('span', { class: 'pill' + (ideaCount ? ' on' : ''), title: `${ideaCount} idea${ideaCount === 1 ? '' : 's'}` }, `💡 ${ideaCount}`),
      h('span', { class: 'pill' + (shotCount ? ' on' : ''), title: `${shotCount} saved thumbnail${shotCount === 1 ? '' : 's'}` }, `🖼 ${shotCount}`),
    ),
    searching ? null : h('span', { class: 'row-actions' },
      h('button', { class: 'btn icon small', title: 'Move up', disabled: i === 0, onclick: stop(() => { moveVideo(i, i - 1); save(); renderVideoList(); }) }, '↑'),
      h('button', { class: 'btn icon small', title: 'Move down', disabled: i === last, onclick: stop(() => { moveVideo(i, i + 1); save(); renderVideoList(); }) }, '↓'),
      h('button', { class: 'btn icon small', title: 'Insert a new video below this one', onclick: stop(() => { ui.addingVideo = true; ui.insertAfterId = v.id; render(); window.scrollTo(0, 0); }) }, '+'),
    ),
  );

  if (!searching) {
    row.addEventListener('dragstart', (e) => {
      dragId = v.id;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', v.id);
      requestAnimationFrame(() => row.classList.add('dragging'));
    });
    row.addEventListener('dragend', () => {
      dragId = null;
      document.querySelectorAll('.video-row').forEach((r) => r.classList.remove('dragging', 'drop-before', 'drop-after'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragId || dragId === v.id) return;
      e.preventDefault();
      const rect = row.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      row.classList.toggle('drop-after', after);
      row.classList.toggle('drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-before', 'drop-after'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = indexOf(dragId);
      if (from < 0 || dragId === v.id) return;
      const after = row.classList.contains('drop-after');
      let to = indexOf(v.id) + (after ? 1 : 0);
      if (from < to) to -= 1;
      moveVideo(from, to);
      save();
      renderVideoList();
    });
  }
  return row;
}

function tripInput(value) {
  const listId = 'trips-' + uid();
  return [
    h('input', { type: 'text', name: 'trip', value, list: listId, placeholder: 'e.g. Jamaica 2025' }),
    h('datalist', { id: listId }, trips().map((t) => h('option', { value: t }))),
  ];
}

function addVideoForm() {
  const preset = ui.insertAfterId ? ui.insertAfterId : 'end';
  const neighbor = ui.insertAfterId ? getVideo(ui.insertAfterId) : null;
  const position = h('select', { name: 'position' },
    h('option', { value: 'end', selected: preset === 'end' }, 'At the end'),
    h('option', { value: 'top' }, 'At the top'),
    vault.videos.map((v, i) => h('option', { value: v.id, selected: preset === v.id }, `After #${i + 1}: ${v.title}`)),
  );

  const form = h('form', { class: 'form stack', style: 'margin-bottom:12px' },
    h('h3', null, 'Add video'),
    field('Title', h('input', { type: 'text', name: 'title', required: true, placeholder: 'Video title' })),
    field('Trip', tripInput(neighbor ? neighbor.trip : '')),
    field('Notes', h('textarea', { name: 'notes', rows: '2', placeholder: 'Angle, key moments, anything to remember' })),
    field('Position', position),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.addingVideo = false; render(); } }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Add video'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = str(fd.get('title')).trim();
    if (!title) return;
    const video = newVideo({ title, trip: str(fd.get('trip')), notes: str(fd.get('notes')) });
    const pos = fd.get('position');
    if (pos === 'top') vault.videos.unshift(video);
    else if (pos === 'end') vault.videos.push(video);
    else vault.videos.splice(indexOf(pos) + 1, 0, video);
    save();
    ui.addingVideo = false;
    toast(`Added #${indexOf(video.id) + 1}: ${video.title}`);
    render();
  });
  queueMicrotask(() => form.querySelector('[name=title]').focus());
  return form;
}

// ----- Video detail view -----

function videoView() {
  const v = getVideo(ui.videoId);
  const i = indexOf(v.id);

  return h('div', null,
    h('div', { class: 'back row between' },
      h('button', { class: 'linkbtn', onclick: () => { ui.view = 'list'; render(); } }, '← All videos'),
      h('span', { class: 'muted small' }, `#${i + 1} of ${vault.videos.length}`),
    ),
    ui.editingVideo ? editVideoForm(v) : h('div', { class: 'detail-head stack' },
      h('h2', null, v.title),
      h('div', { class: 'row wrap' },
        v.trip ? h('span', { class: 'trip-chip' }, v.trip) : h('span', { class: 'muted small' }, 'No trip'),
      ),
      v.notes ? h('p', { class: 'muted', style: 'margin:0;white-space:pre-wrap' }, v.notes) : null,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => { ui.editingVideo = true; render(); } }, 'Edit video'),
        h('button', { class: 'btn small danger', onclick: () => deleteVideo(v) }, 'Delete video'),
      ),
    ),
    h('div', { class: 'tabs' },
      h('button', { class: 'tab' + (ui.tab === 'ideas' ? ' active' : ''), onclick: () => { ui.tab = 'ideas'; render(); } }, `My ideas (${v.ideas.length})`),
      h('button', { class: 'tab' + (ui.tab === 'gallery' ? ' active' : ''), onclick: () => { ui.tab = 'gallery'; render(); } }, `Inspiration (${v.gallery.length})`),
    ),
    ui.tab === 'ideas' ? ideasSection(v) : gallerySection(v),
  );
}

function editVideoForm(v) {
  const form = h('form', { class: 'form stack', style: 'margin-bottom:12px' },
    field('Title', h('input', { type: 'text', name: 'title', value: v.title, required: true })),
    field('Trip', tripInput(v.trip)),
    field('Notes', h('textarea', { name: 'notes', rows: '3', value: v.notes })),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onclick: () => { ui.editingVideo = false; render(); } }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const title = str(fd.get('title')).trim();
    if (!title) return;
    Object.assign(v, { title, trip: str(fd.get('trip')).trim(), notes: str(fd.get('notes')).trim() });
    save();
    ui.editingVideo = false;
    render();
  });
  return form;
}

async function deleteVideo(v) {
  const extra = v.ideas.length + v.gallery.length
    ? ` Its ${v.ideas.length} idea(s) and ${v.gallery.length} saved thumbnail(s) will be deleted too.`
    : '';
  if (!(await confirmDialog(`Delete “${v.title}”?${extra}`))) return;
  vault.videos.splice(indexOf(v.id), 1);
  if (vault.lastCaptureVideoId === v.id) vault.lastCaptureVideoId = null;
  save();
  ui.view = 'list';
  toast('Video deleted');
  render();
}

// ----- Ideas -----

function ideasSection(v) {
  return h('div', { class: 'stack' },
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn primary', onclick: () => { ui.addingIdea = true; ui.editingIdeaId = null; render(); } }, '+ Add idea'),
      h('button', { class: 'btn', onclick: () => startBrainstorm(v) }, '✨ Get brainstorm prompt'),
    ),
    ui.showBrainstorm ? brainstormPanel(v) : null,
    ui.addingIdea ? ideaForm(v, null) : null,
    v.ideas.length || ui.addingIdea ? null : h('div', { class: 'empty' }, 'No ideas yet. Add one, or get a brainstorm prompt to paste into Claude.'),
    v.ideas.map((idea) => (ui.editingIdeaId === idea.id ? ideaForm(v, idea) : ideaCard(v, idea))),
  );
}

async function startBrainstorm(v) {
  const ok = await copyText(buildBrainstormPrompt(v));
  ui.showBrainstorm = true;
  render();
  toast(ok ? 'Brainstorm prompt copied. Paste it into Claude.' : 'Copy failed. Use the prompt text below.');
}

function brainstormPanel(v) {
  const reply = h('textarea', { rows: '7', placeholder: 'Paste Claude’s reply here…' });
  const status = h('div', { class: 'hint' });
  return h('div', { class: 'form stack' },
    h('div', { class: 'row between' },
      h('h3', null, 'Brainstorm with Claude'),
      h('button', { class: 'btn small', onclick: async () => toast((await copyText(buildBrainstormPrompt(v))) ? 'Copied again' : 'Copy failed') }, 'Copy again'),
    ),
    h('p', { class: 'small muted', style: 'margin:0' }, 'The prompt is on your clipboard. Paste it into Claude, then paste the reply below. Numbered concepts with OVERLAY / VISUAL / WHY lines become idea cards.'),
    h('details', null, h('summary', null, 'Show prompt'), h('pre', { class: 'prompt' }, buildBrainstormPrompt(v))),
    reply,
    status,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onclick: () => { ui.showBrainstorm = false; render(); } }, 'Close'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const concepts = parseBrainstorm(reply.value);
          if (!concepts.length) {
            status.textContent = 'Couldn’t find any concepts. Each one needs a number and OVERLAY / VISUAL / WHY lines.';
            status.classList.add('bad');
            return;
          }
          for (const c of concepts) {
            v.ideas.push(newIdea({
              concept: [c.name, c.visual].filter(Boolean).join(': '),
              overlay: c.overlay,
              notes: c.why ? `Why: ${c.why}` : '',
              ai: true,
            }));
          }
          save();
          ui.showBrainstorm = false;
          toast(`Added ${concepts.length} AI idea${concepts.length === 1 ? '' : 's'}`);
          render();
        },
      }, 'Add these ideas'),
    ),
  );
}

function overlayHint(text) {
  const n = countWords(text);
  const over = n > MAX_OVERLAY_WORDS;
  return { text: `${n}/${MAX_OVERLAY_WORDS} words${over ? ': too long' : ''}`, over };
}

function ideaForm(v, idea) {
  const editing = !!idea;
  let refImage = idea ? idea.refImage : null;

  const overlay = h('input', { type: 'text', name: 'overlay', value: idea ? idea.overlay : '', placeholder: 'e.g. WE SPENT HOW MUCH?' });
  const hint = h('div', { class: 'hint' });
  const updateHint = () => {
    const { text, over } = overlayHint(overlay.value);
    hint.textContent = text;
    hint.classList.toggle('bad', over);
  };
  overlay.addEventListener('input', updateHint);
  updateHint();

  const preview = h('div');
  const showPreview = () => preview.replaceChildren(refImage
    ? h('div', { class: 'row' },
        h('img', { src: refImage, class: 'ref-preview', alt: 'Reference' }),
        h('button', { type: 'button', class: 'btn small danger', onclick: () => { refImage = null; showPreview(); } }, 'Remove'))
    : []);
  showPreview();

  const file = h('input', { type: 'file', accept: 'image/*' });
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try { refImage = await fileToDataUrl(f); showPreview(); } catch (e) { toast(e.message); }
    file.value = '';
  });

  const cancel = () => { ui.addingIdea = false; ui.editingIdeaId = null; render(); };
  const form = h('form', { class: 'form stack' },
    h('h3', null, editing ? 'Edit idea' : 'New idea'),
    field('Concept', h('textarea', { name: 'concept', rows: '3', value: idea ? idea.concept : '', placeholder: 'What’s in the frame, who, what expression' })),
    field('Overlay text (4 words max)', overlay, hint),
    field('Notes', h('textarea', { name: 'notes', rows: '2', value: idea ? idea.notes : '' })),
    field('Status', h('select', { name: 'status' }, STATUSES.map((s) => h('option', { value: s, selected: (idea ? idea.status : 'idea') === s }, s)))),
    field('Reference image (optional)', file),
    preview,
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onclick: cancel }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, editing ? 'Save idea' : 'Add idea'),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (overlayHint(overlay.value).over) { overlay.focus(); toast('Overlay text must be 4 words or fewer'); return; }
    const fields = {
      concept: str(fd.get('concept')).trim(),
      overlay: overlay.value.trim(),
      notes: str(fd.get('notes')).trim(),
      status: str(fd.get('status')),
      refImage,
    };
    if (!fields.concept && !fields.overlay) { toast('Add a concept or overlay text'); return; }
    if (editing) {
      // Changing the concept makes an old score stale, but keep it visible until rescored.
      Object.assign(idea, fields);
    } else v.ideas.push(newIdea(fields));
    save();
    cancel();
  });
  return form;
}

function ideaCard(v, idea) {
  const words = countWords(idea.overlay);
  return h('div', { class: `card idea stack status-${idea.status}` },
    idea.refImage ? h('img', { class: 'ref', src: idea.refImage, alt: 'Reference image' }) : null,
    idea.overlay ? h('div', { class: 'overlay' }, idea.overlay) : null,
    words > MAX_OVERLAY_WORDS ? h('div', { class: 'hint bad' }, `Overlay is ${words} words. Trim it to ${MAX_OVERLAY_WORDS}.`) : null,
    idea.concept ? h('div', { style: 'white-space:pre-wrap' }, idea.concept) : null,
    idea.notes ? h('div', { class: 'muted small', style: 'white-space:pre-wrap' }, idea.notes) : null,
    h('div', { class: 'row wrap' },
      h('select', {
        class: 'status-select',
        title: 'Status',
        onchange: (e) => { idea.status = e.target.value; save(); render(); },
      }, STATUSES.map((s) => h('option', { value: s, selected: idea.status === s }, s))),
      idea.ai ? h('span', { class: 'badge ai' }, 'AI-generated') : null,
      idea.score && idea.score.average != null ? h('span', { class: 'pill on' }, `Score ${idea.score.average}/10`) : null,
    ),
    idea.score ? scoreBlock(idea.score) : null,
    ui.scoringIdeaId === idea.id ? scorePanel(v, idea) : null,
    h('div', { class: 'row wrap' },
      h('button', { class: 'btn small', onclick: () => startScore(v, idea) }, idea.score ? 'Rescore via Claude' : 'Score via Claude'),
      h('button', { class: 'btn small', onclick: () => { ui.editingIdeaId = idea.id; ui.addingIdea = false; render(); } }, 'Edit'),
      h('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!(await confirmDialog('Delete this idea?'))) return;
          v.ideas = v.ideas.filter((i) => i.id !== idea.id);
          save();
          render();
        },
      }, 'Delete'),
    ),
  );
}

function scoreBlock(s) {
  return h('div', { class: 'score' },
    h('div', { class: 'score-grid' },
      SCORE_KEYS.flatMap(([k, label]) => [h('span', null, label), h('strong', null, s[k] != null ? `${s[k]}/10` : '–')]),
    ),
    s.improvement ? h('div', null, h('strong', null, 'Improve: '), s.improvement) : null,
  );
}

async function startScore(v, idea) {
  const ok = await copyText(buildScorePrompt(v, idea));
  ui.scoringIdeaId = idea.id;
  render();
  toast(ok ? 'Scoring prompt copied. Paste it into Claude.' : 'Copy failed. Use the prompt text below.');
}

function scorePanel(v, idea) {
  const reply = h('textarea', { rows: '6', placeholder: 'Paste Claude’s score reply here…' });
  const status = h('div', { class: 'hint' });
  return h('div', { class: 'form stack' },
    h('p', { class: 'small muted', style: 'margin:0' }, 'Scoring prompt copied. Paste it into Claude, then paste the reply here.'),
    h('details', null, h('summary', null, 'Show prompt'), h('pre', { class: 'prompt' }, buildScorePrompt(v, idea))),
    reply,
    status,
    h('div', { class: 'row end' },
      h('button', { class: 'btn', onclick: () => { ui.scoringIdeaId = null; render(); } }, 'Cancel'),
      h('button', {
        class: 'btn primary',
        onclick: () => {
          const score = parseScore(reply.value);
          if (!score) {
            status.textContent = 'Couldn’t find any scores. Expected lines like “CURIOSITY: 8”.';
            status.classList.add('bad');
            return;
          }
          idea.score = { ...score, scoredAt: Date.now() };
          save();
          ui.scoringIdeaId = null;
          toast(`Saved score: ${score.average}/10`);
          render();
        },
      }, 'Save score'),
    ),
  );
}

// ----- Inspiration gallery -----

function gallerySection(v) {
  const url = h('input', { type: 'url', placeholder: 'Paste a YouTube video URL' });
  const note = h('input', { type: 'text', placeholder: 'What caught your eye? (optional)' });
  const form = h('form', { class: 'card stack' },
    h('h3', null, 'Add from a YouTube URL'),
    url,
    note,
    h('div', { class: 'row end' }, h('button', { type: 'submit', class: 'btn primary' }, 'Add to gallery')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = extractYouTubeId(url.value);
    if (!id) { toast('That doesn’t look like a YouTube video URL'); url.focus(); return; }
    v.gallery.push({
      id: uid(), imageUrl: ytThumb(id), youtubeId: id, videoUrl: ytWatch(id),
      sourceUrl: safeUrl(url.value.trim()), pageTitle: '', note: note.value.trim(), createdAt: Date.now(),
    });
    save();
    toast('Added to gallery');
    render();
  });

  return h('div', { class: 'stack' },
    form,
    v.gallery.length
      ? h('div', { class: 'gallery' }, [...v.gallery].reverse().map((g) => shotCard(v, g)))
      : h('div', { class: 'empty' }, 'Nothing saved yet. Right-click any thumbnail on the web and choose “Save thumbnail to Vault”.'),
  );
}

function shotCard(v, g) {
  let host = '';
  try { host = g.sourceUrl ? new URL(g.sourceUrl).hostname.replace(/^www\./, '') : ''; } catch { /* ignore */ }

  const noteArea = ui.editingNoteId === g.id
    ? (() => {
        const ta = h('textarea', { rows: '3', value: g.note });
        queueMicrotask(() => ta.focus());
        return h('div', { class: 'stack' }, ta, h('div', { class: 'row end' },
          h('button', { class: 'btn small', onclick: () => { ui.editingNoteId = null; render(); } }, 'Cancel'),
          h('button', { class: 'btn small primary', onclick: () => { g.note = ta.value.trim(); ui.editingNoteId = null; save(); render(); } }, 'Save'),
        ));
      })()
    : g.note ? h('div', { class: 'note' }, g.note) : h('div', { class: 'muted small' }, 'No note');

  const move = h('select', {
    class: 'status-select',
    title: 'Move to another video',
    onchange: (e) => {
      const target = getVideo(e.target.value);
      if (!target) return;
      v.gallery = v.gallery.filter((x) => x.id !== g.id);
      target.gallery.push(g);
      save();
      toast(`Moved to “${target.title}”`);
      render();
    },
  }, h('option', { value: '' }, 'Move to…'),
    vault.videos.filter((x) => x.id !== v.id).map((x) => h('option', { value: x.id }, `#${indexOf(x.id) + 1} ${x.title}`)));

  return h('div', { class: 'card shot' },
    h('div', { class: 'img-wrap' }, g.imageUrl ? thumbImg(g.imageUrl, g.note || 'Saved thumbnail') : h('span', { class: 'muted small' }, 'No image')),
    h('div', { class: 'body stack' },
      noteArea,
      h('div', { class: 'row wrap small' },
        g.sourceUrl ? h('a', { href: g.sourceUrl, target: '_blank', rel: 'noopener', title: g.pageTitle || g.sourceUrl }, `Source${host ? ` (${host})` : ''} ↗`) : null,
        g.videoUrl && g.videoUrl !== g.sourceUrl ? h('a', { href: g.videoUrl, target: '_blank', rel: 'noopener' }, 'Watch ↗') : null,
        h('span', { class: 'muted' }, new Date(g.createdAt).toLocaleDateString()),
      ),
      h('div', { class: 'row wrap' },
        ui.editingNoteId === g.id ? null : h('button', { class: 'btn small', onclick: () => { ui.editingNoteId = g.id; render(); } }, 'Edit note'),
        move,
        h('button', {
          class: 'btn small danger',
          onclick: async () => {
            if (!(await confirmDialog('Remove this thumbnail from the gallery?', 'Remove'))) return;
            v.gallery = v.gallery.filter((x) => x.id !== g.id);
            save();
            render();
          },
        }, 'Remove'),
      ),
    ),
  );
}

// ----- Capture (right-click save form) -----

function captureView() {
  const c = ui.capture;
  const cancel = () => { ui.capture = null; if (ui.captureFrom && getVideo(ui.captureFrom)) openVideo(ui.captureFrom, 'gallery'); else { ui.view = 'list'; render(); } };

  if (c.error) {
    return h('div', { class: 'stack' },
      h('h2', null, 'Save thumbnail'),
      h('div', { class: 'card' }, c.error),
      h('div', { class: 'row end' }, h('button', { class: 'btn', onclick: cancel }, 'OK')),
    );
  }

  const defaultId = [ui.captureFrom, vault.lastCaptureVideoId].find((id) => id && getVideo(id)) || (vault.videos[0] && vault.videos[0].id) || NEW_VIDEO;

  const newFields = h('div', { class: 'stack' },
    field('New video title', h('input', { type: 'text', name: 'newTitle', placeholder: 'Video title' })),
    field('Trip', tripInput('')),
  );

  const select = h('select', { name: 'video' });
  let group = null;
  let lastTrip = null;
  vault.videos.forEach((v, i) => {
    const trip = v.trip || 'No trip';
    if (trip !== lastTrip) { group = h('optgroup', { label: trip }); select.append(group); lastTrip = trip; }
    group.append(h('option', { value: v.id, selected: v.id === defaultId }, `#${i + 1} ${v.title}`));
  });
  select.append(h('option', { value: NEW_VIDEO, selected: defaultId === NEW_VIDEO }, '+ Add new video…'));
  const syncNew = () => newFields.classList.toggle('hidden', select.value !== NEW_VIDEO);
  select.addEventListener('change', () => { syncNew(); if (select.value === NEW_VIDEO) newFields.querySelector('input').focus(); });
  syncNew();

  let host = '';
  try { host = c.sourceUrl ? new URL(c.sourceUrl).hostname.replace(/^www\./, '') : ''; } catch { /* ignore */ }

  const note = h('textarea', { name: 'note', rows: '3', placeholder: 'What caught your eye? Text, face, colors, composition…' });
  const form = h('form', { class: 'stack' },
    h('div', { class: 'row between' }, h('h2', null, 'Save thumbnail'), h('button', { type: 'button', class: 'linkbtn', onclick: cancel }, 'Cancel')),
    h('div', { class: 'capture-preview' }, thumbImg(c.imageUrl, 'Captured thumbnail')),
    h('div', { class: 'small muted' },
      c.youtubeId ? 'YouTube video thumbnail' : 'Image',
      host ? ` from ${host}` : '',
      c.pageTitle ? h('div', null, c.pageTitle) : null,
    ),
    field('For which video?', select),
    newFields,
    field('What caught your eye?', note),
    h('div', { class: 'row end' },
      h('button', { type: 'button', class: 'btn', onclick: cancel }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, 'Save to Vault'),
    ),
  );

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    let video;
    if (select.value === NEW_VIDEO) {
      const title = str(fd.get('newTitle')).trim();
      if (!title) { toast('Give the new video a title'); newFields.querySelector('input').focus(); return; }
      video = newVideo({ title, trip: str(fd.get('trip')) });
      vault.videos.push(video);
    } else video = getVideo(select.value);
    if (!video) return;

    video.gallery.push({
      id: uid(),
      imageUrl: c.imageUrl,
      sourceUrl: c.sourceUrl,
      videoUrl: c.videoUrl,
      youtubeId: c.youtubeId,
      pageTitle: c.pageTitle || '',
      note: note.value.trim(),
      createdAt: Date.now(),
    });
    vault.lastCaptureVideoId = video.id;
    save();
    ui.capture = null;
    toast(`Saved to #${indexOf(video.id) + 1}: ${video.title}`);
    openVideo(video.id, 'gallery');
  });
  queueMicrotask(() => note.focus());
  return form;
}

async function consumePendingCapture() {
  const { pendingCapture: p } = await chrome.storage.session.get('pendingCapture');
  if (!p) return;
  // With side panels open in several windows, only the clicked window takes it.
  if (p.windowId != null && myWindowId != null && p.windowId !== myWindowId) return;
  await chrome.storage.session.remove('pendingCapture');
  if (Date.now() - (p.at || 0) > 10 * 60 * 1000) return; // ignore stale clicks
  const imageUrl = safeUrl(p.imageUrl);
  ui.capture = {
    imageUrl,
    sourceUrl: safeUrl(p.sourceUrl),
    videoUrl: safeUrl(p.videoUrl),
    youtubeId: typeof p.youtubeId === 'string' ? p.youtubeId : null,
    pageTitle: str(p.pageTitle),
    error: imageUrl ? null : (p.error || 'No image found.'),
  };
  if (ui.view === 'video') ui.captureFrom = ui.videoId;
  else if (ui.view !== 'capture') ui.captureFrom = null;
  ui.view = 'capture';
  render();
  window.scrollTo(0, 0);
}

// ---------- Export / import ----------

function exportVault() {
  const data = { app: 'thumbnail-vault', exportedAt: new Date().toISOString(), vault };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `thumbnail-vault-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Vault exported');
}

async function importVault(file) {
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    toast('That file isn’t valid JSON');
    return;
  }
  const incoming = parsed && parsed.vault ? parsed.vault : parsed;
  if (!incoming || !Array.isArray(incoming.videos)) {
    toast('That file isn’t a Thumbnail Vault export');
    return;
  }
  const ok = await confirmDialog(
    `Replace your whole vault (${vault.videos.length} videos) with this file (${incoming.videos.length} videos)? Export first if you want a backup.`,
    'Replace',
  );
  if (!ok) return;
  vault = normalizeVault(incoming);
  await save();
  ui.view = 'list';
  toast(`Imported ${vault.videos.length} videos`);
  render();
}

// ---------- Boot ----------

$('#import-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) importVault(f);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.pendingCapture && changes.pendingCapture.newValue) {
    consumePendingCapture();
  }
  // Another side panel window (or an import elsewhere) changed the vault.
  if (area === 'local' && changes.vault && changes.vault.newValue && changes.vault.newValue.rev !== lastRev) {
    vault = normalizeVault(changes.vault.newValue);
    lastRev = vault.rev;
    render();
  }
});

let myWindowId = null;

(async () => {
  try { myWindowId = (await chrome.windows.getCurrent()).id; } catch { /* ignore */ }
  await loadVault();
  render();
  await consumePendingCapture();
})();
