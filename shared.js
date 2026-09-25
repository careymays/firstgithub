// Pure helpers shared by the background service worker and the side panel.
// No chrome.* calls in here, so it can be unit-tested with plain Node.

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function extractYouTubeId(url) {
  if (!url || typeof url !== 'string') return null;
  let u;
  try { u = new URL(url.trim()); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = u.pathname.split('/')[1];
  } else if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v');
    else {
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v|e)\/([^/?#]+)/);
      if (m) id = m[1];
    }
  } else if (host === 'ytimg.com' || host.endsWith('.ytimg.com')) {
    // Thumbnail images themselves, e.g. i.ytimg.com/vi/ID/hqdefault.jpg?sqp=...
    const m = u.pathname.match(/^\/(?:vi|vi_webp)\/([^/]+)\//);
    if (m) id = m[1];
  }
  return id && YT_ID.test(id) ? id : null;
}

export const ytThumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
export const ytWatch = (id) => `https://www.youtube.com/watch?v=${id}`;

// Only allow URLs that are safe to put in <img src> / <a href>.
export function safeUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  if (/^data:image\//i.test(url)) return url;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch { return null; }
}

// Turn a context-menu click into { imageUrl, youtubeId, sourceUrl, videoUrl, error }.
// Priority: a YouTube link under the cursor, then a YouTube thumbnail image,
// then a plain image, then the YouTube page itself.
export function resolveCapture({ srcUrl, linkUrl, pageUrl }) {
  const linkId = extractYouTubeId(linkUrl);
  const srcId = extractYouTubeId(srcUrl);
  const pageId = extractYouTubeId(pageUrl);
  const sourceUrl = safeUrl(pageUrl);

  const youtubeId = linkId || srcId || (!srcUrl ? pageId : null);
  if (youtubeId) {
    return { imageUrl: ytThumb(youtubeId), youtubeId, sourceUrl, videoUrl: ytWatch(youtubeId), error: null };
  }
  const imageUrl = safeUrl(srcUrl);
  if (imageUrl) return { imageUrl, youtubeId: null, sourceUrl, videoUrl: null, error: null };

  let error = 'No thumbnail found there. Right-click an image, a YouTube video link, or a YouTube video page.';
  if (srcUrl && srcUrl.startsWith('blob:')) error = 'That image is a temporary in-page image (blob:) and can\'t be saved. Try right-clicking a regular thumbnail instead.';
  return { imageUrl: null, youtubeId: null, sourceUrl, videoUrl: null, error };
}

export const countWords = (s) => (s || '').trim().split(/\s+/).filter(Boolean).length;

// ---------- Prompts ----------

const CHANNEL_CONTEXT = `My channel is Mays Family Travels, a family travel channel about all-inclusive resorts and family trips: real trip costs, honest resort reviews, room tours, day trips, and side-by-side comparisons. Our viewers are parents planning family vacations.`;

const THUMBNAIL_RULES = `THUMBNAIL RULES FOR MY CHANNEL:
- It must read instantly at small sizes (phone feed, suggested-video sidebar): one clear focal point, high contrast, very little clutter.
- Overlay text is big, bold, and short: 4 words max, and it should add to the title rather than repeat it.
- Real human emotion: our family's genuine faces and reactions (surprise, joy, disbelief, relief), never generic stock-photo smiles.
- Create a curiosity gap that makes people want to click, but no clickbait: the video must deliver on whatever the thumbnail promises.`;

export function buildBrainstormPrompt(video, count = 5) {
  const lines = [
    'Help me brainstorm YouTube thumbnail concepts.',
    '',
    CHANNEL_CONTEXT,
    '',
    `VIDEO TITLE: "${video.title}"`,
  ];
  if (video.trip && video.trip !== 'Backlog') lines.push(`TRIP: ${video.trip}`);
  if (video.notes) lines.push(`VIDEO NOTES: ${video.notes}`);
  lines.push('', THUMBNAIL_RULES, '');

  lines.push('IDEAS I ALREADY HAVE (do not repeat or lightly reword these):');
  if (video.ideas.length) {
    video.ideas.forEach((i, n) => {
      const parts = [];
      if (i.overlay) parts.push(`overlay "${i.overlay}"`);
      if (i.concept) parts.push(i.concept);
      lines.push(`${n + 1}. ${parts.join(' - ') || '(untitled idea)'}`);
    });
  } else lines.push('None yet.');

  const notes = video.gallery.map((g) => g.note).filter(Boolean);
  if (notes.length) {
    lines.push('', 'WHAT CAUGHT MY EYE IN OTHER THUMBNAILS I SAVED:');
    notes.forEach((n) => lines.push(`- ${n}`));
  }

  lines.push(
    '',
    `Give me ${count} fresh, clearly different thumbnail concepts. Use exactly this format for each one, with no intro or closing commentary:`,
    '',
    '1. <short concept name>',
    'OVERLAY: <overlay text, 4 words max>',
    'VISUAL: <what is in the frame: who, their expression, the setting, the composition>',
    'WHY: <one sentence on why it earns the click at small size>',
  );
  return lines.join('\n');
}

export function buildScorePrompt(video, idea) {
  const lines = [
    'Score this YouTube thumbnail concept.',
    '',
    CHANNEL_CONTEXT,
    '',
    `VIDEO TITLE: "${video.title}"`,
    `CONCEPT: ${idea.concept || '(no description)'}`,
    `OVERLAY TEXT: "${idea.overlay || ''}"`,
  ];
  if (idea.notes) lines.push(`NOTES: ${idea.notes}`);
  lines.push(
    '',
    'Rate it from 1 to 10 on each of these:',
    '- Curiosity gap: makes people want to click, without clickbait.',
    '- Clarity at small size: reads instantly in a phone feed.',
    '- Emotion: real human emotion that connects.',
    '- Text brevity: the overlay is short, bold, and adds to the title.',
    '',
    'Then give ONE concrete, specific improvement.',
    '',
    'Reply in exactly this format and nothing else:',
    'CURIOSITY: <1-10>',
    'CLARITY: <1-10>',
    'EMOTION: <1-10>',
    'BREVITY: <1-10>',
    'IMPROVEMENT: <one concrete change>',
  );
  return lines.join('\n');
}

// ---------- Parsers ----------

const stripQuotes = (s) => s.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim();

// Parses numbered concepts with OVERLAY / VISUAL / WHY lines.
export function parseBrainstorm(text) {
  const clean = (text || '').replace(/\r/g, '').replace(/\*\*|__/g, '').replace(/^\s*#+\s*/gm, '');
  const numRe = /^\s*(?:concept\s*)?#?(\d{1,2})\s*[.):]\s*(.*)$/i;
  const fieldRe = /^\s*[-*•]?\s*(OVERLAY|VISUAL|WHY)(?:\s+TEXT)?\s*[:\-–—]\s*(.*)$/i;
  const blank = () => ({ name: '', overlay: '', visual: '', why: '' });
  const blocks = [];
  let cur = null;
  let last = null;

  const setField = (key, value) => {
    if (!cur || cur[key]) { cur = blank(); blocks.push(cur); }
    cur[key] = value.trim();
    last = key;
  };

  for (const line of clean.split('\n')) {
    if (!line.trim()) { last = null; continue; }
    const f = line.match(fieldRe);
    if (f) { setField(f[1].toLowerCase(), f[2]); continue; }
    const n = line.match(numRe);
    if (n) {
      cur = blank(); blocks.push(cur); last = null;
      const inner = n[2].match(fieldRe);
      if (inner) setField(inner[1].toLowerCase(), inner[2]);
      else cur.name = stripQuotes(n[2].replace(/[:\-–—]\s*$/, ''));
      continue;
    }
    if (cur && last) cur[last] += ' ' + line.trim();
  }

  return blocks
    .filter((b) => b.overlay || b.visual)
    .map((b) => ({ name: b.name, overlay: stripQuotes(b.overlay), visual: b.visual.trim(), why: b.why.trim() }));
}

export const SCORE_KEYS = [
  ['curiosity', 'Curiosity gap', /curiosity/],
  ['clarity', 'Clarity at small size', /clarity/],
  ['emotion', 'Emotion', /emotion/],
  ['brevity', 'Text brevity', /brevity/],
];

export function parseScore(text) {
  const clean = (text || '').replace(/\r/g, '').replace(/\*\*|__/g, '');
  const score = {};
  for (const [key, , word] of SCORE_KEYS) {
    const re = new RegExp(word.source + '[^\\n\\d]*?(\\d{1,2}(?:\\.\\d+)?)', 'i');
    const m = clean.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (v >= 0 && v <= 10) score[key] = v;
    }
  }
  const nums = SCORE_KEYS.map(([k]) => score[k]).filter((v) => typeof v === 'number');
  if (!nums.length) return null;
  score.average = Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10;
  const imp = clean.match(/improvement[^:\n]*:\s*([\s\S]*?)(?:\n\s*\n|$)/i);
  score.improvement = imp ? imp[1].replace(/\s+/g, ' ').trim() : '';
  return score;
}
