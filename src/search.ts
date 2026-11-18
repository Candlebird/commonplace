import { dueState, isShared, taskCounts, type Note } from './model';

export const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Filter { v: string; neg: boolean }
export interface Query {
  terms: string[];
  not: string[];
  tags: Filter[];
  in: Filter[];
  is: Filter[];
  before: string | null;
  after: string | null;
}

/**
 * Words match anywhere (title, text, words in photos, notebook); "quoted phrases"; -word leaves out.
 * #tag, in:notebook, is:pinned|todo|done|shared|photo|sketch|reminder|overdue|archived, before:/after: YYYY-MM-DD.
 */
export function parseQuery(q: string): Query {
  const out: Query = { terms: [], not: [], tags: [], in: [], is: [], before: null, after: null };
  for (const m of q.matchAll(/(-?)(?:([a-z]+):)?(?:"([^"]*)"?|(\S+))/gi)) {
    const neg = m[1] === '-';
    const key = (m[2] || '').toLowerCase();
    const val = (m[3] ?? m[4] ?? '').trim();
    if (!val) continue;
    const v = norm(val);
    if (!key && v.startsWith('#') && v.length > 1) out.tags.push({ v: v.slice(1), neg });
    else if (key === 'tag') out.tags.push({ v: v.replace(/^#/, ''), neg });
    else if (key === 'in' || key === 'notebook') out.in.push({ v, neg });
    else if (key === 'is' || key === 'has') out.is.push({ v, neg });
    else if (key === 'before') out.before = val;
    else if (key === 'after') out.after = val;
    else (neg ? out.not : out.terms).push(key ? `${norm(key)}:${v}` : v);
  }
  return out;
}

export const isEmptyQuery = (q: Query) =>
  !q.terms.length && !q.not.length && !q.tags.length && !q.in.length && !q.is.length && !q.before && !q.after;

function flag(n: Note, f: string): boolean {
  switch (f) {
    case 'pinned': return n.pinned;
    case 'archived': return n.archived;
    case 'todo': case 'list': return taskCounts(n.doc).open > 0;
    case 'done': { const c = taskCounts(n.doc); return c.done > 0 && c.open === 0; }
    case 'shared': return isShared(n);
    case 'photo': case 'image': return n.photos.some((p) => p.kind === 'photo');
    case 'sketch': case 'drawing': return n.photos.some((p) => p.kind === 'sketch');
    case 'reminder': case 'due': return !!n.due && !n.dueDone;
    case 'overdue': return dueState(n) === 'overdue';
    case 'link': case 'linked': return n.links.length > 0;
    default: return false;
  }
}

const cache = new WeakMap<Note, { title: string; all: string }>();
function hay(n: Note, notebookName: string) {
  let h = cache.get(n);
  if (!h) {
    h = { title: norm(n.title), all: norm([n.title, n.text, n.photoText, notebookName].join('\n')) };
    cache.set(n, h);
  }
  return h;
}

/** 0 when the note doesn't match, otherwise higher is more relevant. */
export function score(n: Note, q: Query, notebookName = ''): number {
  for (const t of q.tags) if (n.tags.some((x) => x === t.v || x.startsWith(t.v + '/')) === t.neg) return 0;
  for (const t of q.in) if (norm(notebookName).includes(t.v) === t.neg) return 0;
  for (const t of q.is) if (flag(n, t.v) === t.neg) return 0;
  const day = n.createdAt.slice(0, 10);
  if (q.before && !(day < q.before)) return 0;
  if (q.after && !(day >= q.after)) return 0;
  const h = hay(n, notebookName);
  for (const t of q.not) if (h.all.includes(t)) return 0;
  let s = 1;
  for (const t of q.terms) {
    if (!h.all.includes(t)) return 0;
    if (h.title.includes(t)) s += 6;
    if (n.tags.includes(t)) s += 4;
    s += Math.min(5, h.all.split(t).length - 1);
  }
  return s;
}

/** Words to mark in results. */
export function highlightTerms(q: Query): string[] {
  return [...q.terms, ...q.tags.filter((t) => !t.neg).map((t) => '#' + t.v)].filter(Boolean).sort((a, b) => b.length - a.length);
}
