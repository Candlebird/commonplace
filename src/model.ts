/** Notes, notebooks and everything that can be worked out from them without touching the network. */

export type Role = 'editor' | 'viewer';
export type Shares = Record<string, Role>;

/** A Tiptap / ProseMirror JSON node. */
export interface Doc {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Doc[];
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

export interface PhotoRef {
  id: string;
  kind: 'photo' | 'sketch';
}

export interface Note {
  id: string;
  owner: string;
  /** Everyone who can read it (owner, note shares, notebook shares). Firestore rules check this. */
  members: string[];
  /** Everyone who can change it. */
  editors: string[];
  /** People this note itself is shared with (notebook shares come on top). */
  shares: Shares;
  title: string;
  doc: Doc | null;
  /** Plain text of the body, for search and previews. */
  text: string;
  tags: string[];
  /** Ids of notes this one links to. */
  links: string[];
  notebookId: string;
  pinned: boolean;
  archived: boolean;
  trashed: boolean;
  color: string;
  /** Reminder: "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local time), or "". */
  due: string;
  dueDone: boolean;
  photos: PhotoRef[];
  /** Words read from photos, for search. */
  photoText: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Notebook {
  id: string;
  owner: string;
  name: string;
  color: string;
  shares: Shares;
  members: string[];
  editors: string[];
  createdAt: string;
}

export const COLORS = [
  { id: '', label: 'Default' },
  { id: 'red', label: 'Red' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'teal', label: 'Teal' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'gray', label: 'Gray' },
];

export const uniq = <T,>(a: T[]): T[] => [...new Set(a)];
export const nowIso = () => new Date().toISOString();
export const cleanEmail = (e: string) => e.trim().toLowerCase();
export const isEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

// ---- Access ---------------------------------------------------------------------------------------

/** Who can read and who can edit, given the owner and the note's and notebook's shares. Editor wins over viewer. */
export function access(owner: string, ...shareSets: (Shares | undefined)[]): { members: string[]; editors: string[] } {
  const role = new Map<string, Role>();
  for (const s of shareSets) {
    for (const [e, r] of Object.entries(s || {})) {
      const k = cleanEmail(e);
      if (k === owner) continue;
      if (role.get(k) !== 'editor') role.set(k, r);
    }
  }
  return {
    members: [owner, ...[...role.keys()].sort()],
    editors: [owner, ...[...role.entries()].filter(([, r]) => r === 'editor').map(([e]) => e).sort()],
  };
}

export const canEdit = (n: Pick<Note, 'owner' | 'editors'>, me: string) => n.owner === me || (n.editors || []).includes(me);
export const isShared = (n: Pick<Note, 'members'>) => (n.members || []).length > 1;

// ---- Body ----------------------------------------------------------------------------------------

export const emptyDoc = (): Doc => ({ type: 'doc', content: [{ type: 'paragraph' }] });

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'codeBlock', 'listItem', 'taskItem', 'bulletList', 'orderedList', 'taskList', 'horizontalRule']);

/** Plain text of a document: one line per block, note links by their label. */
export function docText(doc: Doc | null | undefined): string {
  if (!doc) return '';
  const out: string[] = [];
  let line = '';
  const flush = () => { out.push(line); line = ''; };
  const walk = (n: Doc) => {
    if (n.type === 'text') { line += n.text || ''; return; }
    if (n.type === 'hardBreak') { flush(); return; }
    if (n.type === 'noteLink') { line += String(n.attrs?.label ?? ''); return; }
    if (n.type === 'taskItem') line += n.attrs?.checked ? '[x] ' : '[ ] ';
    for (const c of n.content || []) walk(c);
    if (BLOCKS.has(n.type) && line) flush();
  };
  walk(doc);
  if (line) flush();
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const HASHTAG = /(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
export const hashtags = (text: string) =>
  uniq([...String(text || '').matchAll(HASHTAG)].map((m) => m[1].toLowerCase().replace(/[/-]+$/, '')).filter((t) => /\p{L}/u.test(t)));

export function docLinks(doc: Doc | null | undefined): string[] {
  const ids: string[] = [];
  const walk = (n: Doc) => {
    if (n.type === 'noteLink' && n.attrs?.id) ids.push(String(n.attrs.id));
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return uniq(ids);
}

/** Text, tags and links that are stored alongside the document so search and backlinks don't parse every note. */
export function derive(title: string, doc: Doc | null) {
  const text = docText(doc);
  return { text, tags: hashtags(`${title}\n${text}`), links: docLinks(doc) };
}

export function taskCounts(doc: Doc | null | undefined) {
  let open = 0, done = 0;
  const walk = (n: Doc) => {
    if (n.type === 'taskItem') n.attrs?.checked ? done++ : open++;
    n.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return { open, done };
}

/** Checked items sink to the bottom of their list, keeping the order within each group. */
export function sinkChecked(doc: Doc): Doc {
  const fix = (n: Doc): Doc => {
    const content = n.content?.map(fix);
    if (n.type === 'taskList' && content) {
      return { ...n, content: [...content.filter((c) => !c.attrs?.checked), ...content.filter((c) => c.attrs?.checked)] };
    }
    return content ? { ...n, content } : n;
  };
  return fix(doc);
}

/** Drop ticked items (and lists left empty). */
export function removeChecked(doc: Doc): Doc {
  const fix = (n: Doc): Doc | null => {
    if (n.type === 'taskItem' && n.attrs?.checked) return null;
    if (!n.content) return n;
    const content = n.content.map(fix).filter((c): c is Doc => !!c);
    if ((n.type === 'taskList' || n.type === 'bulletList' || n.type === 'orderedList') && !content.length) return null;
    return { ...n, content };
  };
  const out = fix(doc) || emptyDoc();
  if (!out.content?.length) out.content = [{ type: 'paragraph' }];
  return out;
}

/** Toggle the i-th task item (in document order). */
export function toggleTask(doc: Doc, index: number): Doc {
  let i = 0;
  const fix = (n: Doc): Doc => {
    if (n.type === 'taskItem') {
      const mine = i++ === index;
      const content = n.content?.map(fix);
      return { ...n, attrs: { ...n.attrs, checked: mine ? !n.attrs?.checked : !!n.attrs?.checked }, ...(content ? { content } : {}) };
    }
    return n.content ? { ...n, content: n.content.map(fix) } : n;
  };
  return sinkChecked(fix(doc));
}

const para = (text: string): Doc => (text ? { type: 'paragraph', content: inlineText(text) } : { type: 'paragraph' });
function inlineText(text: string): Doc[] {
  // Bare URLs become links; everything else stays text.
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/);
  return parts.filter(Boolean).map((p, i) =>
    i % 2 && /^https?:\/\//.test(p) ? { type: 'text', text: p, marks: [{ type: 'link', attrs: { href: p } }] } : { type: 'text', text: p },
  );
}

/** Plain or Markdown-ish text (old notes, shared text, dictation) as a document. */
export function textToDoc(body: string): Doc {
  const lines = String(body || '').replace(/\r\n?/g, '\n').split('\n');
  const content: Doc[] = [];
  let list: Doc | null = null;
  const end = () => { if (list) content.push(list); list = null; };
  for (const raw of lines) {
    const task = raw.match(/^\s*[-*] \[( |x|X)\] ?(.*)$/);
    const bullet = !task && raw.match(/^\s*[-*•] (.*)$/);
    const numbered = !task && !bullet && raw.match(/^\s*\d+[.)] (.*)$/);
    const heading = raw.match(/^(#{1,3}) (.+)$/);
    const kind = task ? 'taskList' : bullet ? 'bulletList' : numbered ? 'orderedList' : null;
    if (kind) {
      if (!list || list.type !== kind) { end(); list = { type: kind, content: [] }; }
      const text = (task ? task[2] : bullet ? bullet[1] : (numbered as RegExpMatchArray)[1]).trim();
      list.content!.push(task
        ? { type: 'taskItem', attrs: { checked: task[1] !== ' ' }, content: [para(text)] }
        : { type: 'listItem', content: [para(text)] });
      continue;
    }
    end();
    if (heading) content.push({ type: 'heading', attrs: { level: heading[1].length }, content: inlineText(heading[2]) });
    else content.push(para(raw));
  }
  end();
  // Collapse runs of empty paragraphs left by blank lines.
  const tidy = content.filter((c, i) => !(c.type === 'paragraph' && !c.content && (i === 0 || (content[i - 1].type === 'paragraph' && !content[i - 1].content))));
  while (tidy.length > 1 && tidy[tidy.length - 1].type === 'paragraph' && !tidy[tidy.length - 1].content) tidy.pop();
  return { type: 'doc', content: tidy.length ? tidy : [{ type: 'paragraph' }] };
}

export const checklistDoc = (): Doc => ({ type: 'doc', content: [{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] });

// ---- Markdown export -------------------------------------------------------------------------------

export function docMarkdown(doc: Doc | null | undefined): string {
  if (!doc) return '';
  const inline = (nodes: Doc[] = []): string => nodes.map((n) => {
    if (n.type === 'hardBreak') return '  \n';
    if (n.type === 'noteLink') return `[[${n.attrs?.label ?? ''}]]`;
    let t = n.text || '';
    for (const m of n.marks || []) {
      if (m.type === 'bold') t = `**${t}**`;
      else if (m.type === 'italic') t = `*${t}*`;
      else if (m.type === 'strike') t = `~~${t}~~`;
      else if (m.type === 'code') t = '`' + t + '`';
      else if (m.type === 'highlight') t = `==${t}==`;
      else if (m.type === 'link') t = `[${t}](${m.attrs?.href})`;
    }
    return t;
  }).join('');
  const block = (n: Doc, indent = ''): string => {
    const kids = n.content || [];
    switch (n.type) {
      case 'paragraph': return indent + inline(kids);
      case 'heading': return '#'.repeat(Number(n.attrs?.level) || 1) + ' ' + inline(kids);
      case 'blockquote': return kids.map((k) => '> ' + block(k)).join('\n>\n');
      case 'codeBlock': return '```\n' + inline(kids) + '\n```';
      case 'horizontalRule': return '---';
      case 'bulletList':
      case 'orderedList':
      case 'taskList':
        return kids.map((item, i) => {
          const mark = n.type === 'bulletList' ? '- ' : n.type === 'orderedList' ? `${i + 1}. ` : `- [${item.attrs?.checked ? 'x' : ' '}] `;
          const [first, ...rest] = item.content || [];
          return indent + mark + (first ? inline(first.content) : '') + rest.map((r) => '\n' + block(r, indent + '  ')).join('');
        }).join('\n');
      default: return kids.map((k) => block(k, indent)).join('\n\n');
    }
  };
  return block(doc).trim();
}

// ---- Old (v1) notes --------------------------------------------------------------------------------

/** A v1 note as stored: plain-text body, notebook by name, one photo keyed by the note id. */
export interface LegacyNote {
  owner: string;
  title?: string;
  body?: string;
  labels?: string[];
  notebook?: string;
  pinned?: boolean;
  archived?: boolean;
  trashed?: boolean;
  hasPhoto?: boolean;
  ocr?: string;
  capturedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** The v2 fields for a v1 note. Labels become #tags at the end of the text. */
export function upgradeLegacy(id: string, v: LegacyNote, notebookId: string): Omit<Note, 'id'> {
  const labels = (v.labels || []).map((l) => '#' + l.replace(/^#/, '').trim().replace(/\s+/g, '-')).filter((l) => l.length > 1);
  const doc = textToDoc([v.body || '', labels.length ? labels.join(' ') : ''].filter(Boolean).join('\n\n'));
  const title = v.title || '';
  const t = v.createdAt || nowIso();
  return {
    owner: v.owner,
    members: [v.owner],
    editors: [v.owner],
    shares: {},
    title,
    doc,
    ...derive(title, doc),
    notebookId,
    pinned: !!v.pinned,
    archived: !!v.archived,
    trashed: !!v.trashed,
    color: '',
    due: '',
    dueDone: false,
    photos: v.hasPhoto ? [{ id, kind: 'photo' }] : [],
    photoText: v.ocr || '',
    createdAt: v.capturedAt && v.capturedAt < t.slice(0, 10) ? v.capturedAt + 'T12:00:00.000Z' : t,
    updatedAt: v.updatedAt || t,
    updatedBy: v.owner,
  };
}

// ---- Reminders ------------------------------------------------------------------------------------

export const dueDate = (due: string) => (due ? new Date(due.length === 10 ? due + 'T09:00' : due) : null);
export const dueHasTime = (due: string) => due.length > 10;

export function dueState(n: Pick<Note, 'due' | 'dueDone'>, now = new Date()): 'none' | 'done' | 'overdue' | 'today' | 'soon' | 'later' {
  if (!n.due) return 'none';
  if (n.dueDone) return 'done';
  const d = dueDate(n.due)!;
  const today = ymd(now);
  const day = n.due.slice(0, 10);
  if (day < today || (dueHasTime(n.due) && d < now)) return 'overdue';
  if (day === today) return 'today';
  return (d.getTime() - now.getTime()) / 864e5 < 7 ? 'soon' : 'later';
}

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const localDateTime = (d: Date) => `${ymd(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function fmtDue(due: string, now = new Date()): string {
  const d = dueDate(due);
  if (!d) return '';
  const day = due.slice(0, 10);
  const today = ymd(now);
  const tomorrow = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const yesterday = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const date = day === today ? 'Today' : day === tomorrow ? 'Tomorrow' : day === yesterday ? 'Yesterday'
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return dueHasTime(due) ? `${date}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : date;
}

/** A calendar "new event" link for a reminder, one hour long (or all day). */
export function calendarUrl(n: Pick<Note, 'title' | 'text' | 'due' | 'id'>, appUrl: string): string {
  const d = dueDate(n.due);
  if (!d) return '';
  const stamp = (x: Date) => x.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  let dates: string;
  if (dueHasTime(n.due)) dates = `${stamp(d)}/${stamp(new Date(d.getTime() + 3600e3))}`;
  else {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    dates = `${n.due.replace(/-/g, '')}/${ymd(next).replace(/-/g, '')}`;
  }
  const title = n.title || n.text.split('\n')[0].slice(0, 80) || 'Note';
  const details = `${n.text.slice(0, 800)}\n\n${appUrl}#note/${n.id}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}`;
}

// ---- Display ---------------------------------------------------------------------------------------

export function fmtDate(iso: string, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(+d)) return '';
  if (ymd(d) === ymd(now)) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

export const noteLabel = (n: Pick<Note, 'title' | 'text'>) => n.title || n.text.split('\n').find((l) => l.trim())?.replace(/^\[[ x]\] /, '').slice(0, 60) || 'Untitled';
