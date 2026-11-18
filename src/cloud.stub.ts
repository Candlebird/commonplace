/** In-memory stand-in for cloud.ts (npm run dev:stub). Kept in localStorage so a reload keeps the notes. */
import { nowIso, type Note, type Notebook } from './model';
import type { SyncState, User, Write } from './cloud';
export type { SyncState, User, Write } from './cloud';

const KEY = 'commonplace.stub';
type Store = { notes: Record<string, Note>; notebooks: Record<string, Notebook>; photos: Record<string, Record<string, unknown>> };
const store: Store = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '') } catch { return { notes: {}, notebooks: {}, photos: {} }; } })();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* full */ } };
const subs = new Set<() => void>();
const ping = () => setTimeout(() => subs.forEach((f) => f()), 0);

const params = new URLSearchParams(location.search);
const me: User = { email: params.get('as') || 'me@example.com', name: 'Test Person', photo: '' };
let userCb: ((u: User | null) => void) | null = null;
let signedIn = params.get('signedout') === null;

export const setErrorHandler = (_f: (e: Error) => void) => {};
export const watchUser = (cb: (u: User | null) => void) => { userCb = cb; setTimeout(() => cb(signedIn ? me : null), 50); return () => {}; };
export const signIn = async () => { signedIn = true; userCb?.(me); };
export const signOutUser = async () => { signedIn = false; userCb?.(null); };

export function watchNotes(email: string, cb: (n: Note[], s: SyncState) => void, _e: (e: Error) => void) {
  const run = () => cb(Object.values(store.notes).filter((n) => n.members.includes(email)).map((n) => structuredClone(n)), { pending: false, offline: false });
  subs.add(run); run();
  return () => { subs.delete(run); };
}
export function watchNotebooks(email: string, cb: (n: Notebook[]) => void, _e: (e: Error) => void) {
  const run = () => cb(Object.values(store.notebooks).filter((n) => n.members.includes(email)).map((n) => structuredClone(n)));
  subs.add(run); run();
  return () => { subs.delete(run); };
}
let n = 0;
export const newId = () => `s${Date.now().toString(36)}${(n++).toString(36)}`;
export async function commit(writes: Write[], who: string) {
  for (const w of writes) {
    if (w.kind === 'delete') {
      const [col, id] = w.path.split('/');
      delete (store as unknown as Record<string, Record<string, unknown>>)[col === 'notePhotos' ? 'photos' : col][id];
    } else if (w.kind === 'note') store.notes[w.id] = { ...(w.replace ? {} : store.notes[w.id]), ...w.data, id: w.id, updatedAt: w.data.updatedAt || nowIso(), updatedBy: who } as Note;
    else if (w.kind === 'notebook') store.notebooks[w.id] = { ...store.notebooks[w.id], ...w.data, id: w.id } as Notebook;
    else store.photos[w.id] = { ...store.photos[w.id], ...w.data };
  }
  save(); ping();
}
export const loadPhoto = async (id: string) => String(store.photos[id]?.data || '');
export const rememberPhoto = (_id: string, _d: string) => {};
export const migrate = async (_e: string, _n: Notebook[]) => 0;
