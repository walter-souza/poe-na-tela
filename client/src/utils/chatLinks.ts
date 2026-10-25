export type ChatEmbed =
  | { kind: 'video'; url: string; host: string }
  | { kind: 'youtube'; id: string; url: string; host: string };

export type ChatSegment = { type: 'text'; value: string } | { type: 'link'; value: string };

const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;
const VIDEO_EXTENSION = /\.(mp4|webm|mov|m4v|ogv)$/i;
const YOUTUBE_ID = /^[\w-]{11}$/;
const MAX_EMBEDS = 3;

/** Splits message text into plain text and http(s) links, keeping trailing punctuation out of links. */
export function splitLinks(text: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(TRAILING_PUNCTUATION, '');
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: 'text', value: text.slice(last, start) });
    segments.push({ type: 'link', value: url });
    last = start + url.length;
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) });
  return segments;
}

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^(www|m)\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const [, kind, rest] = u.pathname.split('/');
    id = kind === 'shorts' || kind === 'embed' || kind === 'live' ? rest : u.searchParams.get('v');
  }
  return id && YOUTUBE_ID.test(id) ? id : null;
}

/** Recognizes direct video files and YouTube links; every other URL stays a plain link. */
export function getEmbed(link: string): ChatEmbed | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.replace(/^www\./, '');
  const id = youtubeId(u);
  if (id) return { kind: 'youtube', id, url: link, host };
  if (VIDEO_EXTENSION.test(u.pathname)) return { kind: 'video', url: link, host };
  return null;
}

export function getEmbeds(segments: ChatSegment[]): ChatEmbed[] {
  const seen = new Set<string>();
  const embeds: ChatEmbed[] = [];
  for (const s of segments) {
    if (s.type !== 'link' || seen.has(s.value)) continue;
    seen.add(s.value);
    const embed = getEmbed(s.value);
    if (embed) embeds.push(embed);
    if (embeds.length === MAX_EMBEDS) break;
  }
  return embeds;
}
