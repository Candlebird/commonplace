/** App state, kept outside React so any component can read it and call the actions. */
import { useSyncExternalStore } from 'react';
import * as cloud from './cloud';
import type { SyncState, User, Write } from './cloud';
import { access, derive, emptyDoc, nowIso, sinkChecked, toggleTask, type Doc, type Note, type Notebook, type PhotoRef, type Shares } from './model';

export interface State {
  user: User | null | undefined;
  notes: Map<string, Note>;
  notebooks: Map<string, Notebook>;
  loaded: boolean;
  denied: boolean;
  sync: SyncState;
  error: string;
  toast: { id: number; text: string; undo?: () => void } | null;
}

let state: State = {
  user: undefined,
  notes: new Map(),
  notebooks: new Map(),
  loaded: false,
  denied: false,
  sync: { pending: false, offline: false },
  error: '',
  toast: null,
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; listeners.forEach((f) => f()); };
export const getState = () => state;
export const useStore = <T,>(pick: (s: State) => T): T =>
  useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => pick(state));

const me = () => state.user?.email || '';
export const fail = (e: unknown) => {
  console.error(e);
  set({ error: e instanceof Error ? e.message : String(e) });
};
cloud.setErrorHandler(fail);
export const clearError = () => set({ error: '' });

let toastN = 0;
export function toast(text: string, undo?: () => void) {
  const id = ++toastN;
  set({ toast: { id, text, undo } });
  setTimeout(() => { if (state.toast?.id === id) set({ toast: null }); }, undo ? 7000 : 4000);
}
export const dismissToast = () => set({ toast: null });

// ---- Session ---------------------------------------------------------------------------------------

let unsubs: (() => void)[] = [];
cloud.watchUser((u) => {
  unsubs.forEach((f) => f());
  unsubs = [];
  set({ user: u, notes: new Map(), notebooks: new Map(), loaded: false, denied: false, error: '' });
  if (!u) return;
  let migrated = false;
  const denied = (e: Error & { code?: string }) => (e.code === 'permission-denied' ? set({ denied: true, loaded: true }) : fail(e));
  unsubs.push(cloud.watchNotebooks(u.email, (nbs) => {
    set({ notebooks: new Map(nbs.map((n) => [n.id, n])) });
    if (!migrated) {
      migrated = true;
      cloud.migrate(u.email, nbs).then((k) => { if (k) toast(`Brought ${k} older note${k === 1 ? '' : 's'} up to date.`); }).catch(fail);
    }
  }, denied));
  unsubs.push(cloud.watchNotes(u.email, (notes, sync) => set({ notes: new Map(notes.map((n) => [n.id, n])), sync, loaded: true, denied: false }), denied));
});

export const signIn = () => cloud.signIn().catch((e) => { if (!/popup-closed|cancelled-popup/.test(e?.code || '')) fail(e); });
export const signOut = () => cloud.signOutUser();

const run = (writes: Write[]) => { if (writes.length) cloud.commit(writes, me()).catch(() => {}); };

/** A notebook's shares, plus its owner: notes others add to a shared notebook stay editable by whoever owns the notebook. */
const nbShares = (nb?: Notebook): Shares | undefined => (nb ? { ...nb.shares, [nb.owner]: 'editor' } : undefined);

// ---- Notes ----------------------------------------------------------------------------------------

export function newNote(init: Partial<Note> = {}): Note {
  const nb = init.notebookId ? state.notebooks.get(init.notebookId) : undefined;
  const t = nowIso();
  const doc = init.doc || emptyDoc();
  const title = init.title || '';
  return {
    id: cloud.newId(),
    owner: me(),
    ...access(me(), init.shares, nbShares(nb)),
    shares: {},
    title,
    doc,
    ...derive(title, doc),
    notebookId: '',
    pinned: false,
    archived: false,
    trashed: false,
    color: '',
    due: '',
    dueDone: false,
    photos: [],
    photoText: '',
    createdAt: t,
    updatedAt: t,
    updatedBy: me(),
    ...init,
  };
}

/** Save a new note. Empty ones are dropped unless `force` (a photo or reminder is about to be attached). */
export function createNote(n: Note, force = false) {
  if (!force && !n.title.trim() && !n.text.trim() && !n.photos.length && !n.due) return;
  run([{ kind: 'note', id: n.id, data: n }]);
}

export function updateNote(id: string, patch: Partial<Note>) {
  const n = state.notes.get(id);
  const full = { ...patch };
  if (n && ('doc' in patch || 'title' in patch)) Object.assign(full, derive(patch.title ?? n.title, patch.doc ?? n.doc));
  run([{ kind: 'note', id, data: full }]);
}

export const updateNotes = (ids: string[], patch: Partial<Note>) => run(ids.map((id) => ({ kind: 'note' as const, id, data: { ...patch } })));

export function setBody(id: string, title: string, doc: Doc) {
  run([{ kind: 'note', id, data: { title, doc, ...derive(title, doc) } }]);
}

export function toggleTaskAt(n: Note, index: number) {
  if (!n.doc) return;
  const doc = toggleTask(n.doc, index);
  setBody(n.id, n.title, doc);
}

export function trash(ids: string[]) {
  updateNotes(ids, { trashed: true, pinned: false });
  toast(ids.length === 1 ? 'Moved to Trash.' : `Moved ${ids.length} notes to Trash.`, () => updateNotes(ids, { trashed: false }));
}
export function archive(ids: string[], on = true) {
  updateNotes(ids, { archived: on, pinned: false });
  if (on) toast(ids.length === 1 ? 'Archived.' : `Archived ${ids.length} notes.`, () => updateNotes(ids, { archived: false }));
}

export function deleteForever(notes: Note[]) {
  const writes: Write[] = [];
  for (const n of notes) {
    if (n.owner !== me()) continue;
    writes.push({ kind: 'delete', path: `notes/${n.id}` });
    for (const p of n.photos) writes.push({ kind: 'delete', path: `notePhotos/${p.id}` });
  }
  run(writes);
}

export function duplicate(n: Note) {
  const copy = newNote({ title: n.title ? `${n.title} (copy)` : '', doc: n.doc ? structuredClone(n.doc) : emptyDoc(), notebookId: n.owner === me() ? n.notebookId : '', color: n.color });
  createNote(copy);
  return copy.id;
}

// ---- Sharing and notebooks ------------------------------------------------------------------------

/** Writes that give a note (and its photos) the access its own and its notebook's shares call for. Owner only. */
function reshare(n: Note, shares: Shares, notebookId: string): Write[] {
  const nb = notebookId ? state.notebooks.get(notebookId) : undefined;
  const acc = access(n.owner, shares, nbShares(nb));
  return [
    { kind: 'note', id: n.id, data: { shares, notebookId, ...acc } },
    ...n.photos.map((p) => ({ kind: 'photo' as const, id: p.id, data: { members: acc.members, editors: acc.editors } })),
  ];
}

export function shareNote(n: Note, shares: Shares) {
  if (n.owner !== me()) return;
  run(reshare(n, shares, n.notebookId));
}

/** Move notes into a notebook (or out, with ""). Only the owner can, since it changes who can see them. */
export function moveNotes(ids: string[], notebookId: string) {
  const writes: Write[] = [];
  let skipped = 0;
  for (const id of ids) {
    const n = state.notes.get(id);
    if (!n) continue;
    if (n.owner !== me()) { skipped++; continue; }
    writes.push(...reshare(n, n.shares, notebookId));
  }
  run(writes);
  if (skipped) toast(`${skipped} note${skipped === 1 ? ' was' : 's were'} left where ${skipped === 1 ? 'it was' : 'they were'}: only the person who wrote a note can move it.`);
}

export function createNotebook(name: string): string {
  const id = cloud.newId();
  run([{ kind: 'notebook', id, data: { owner: me(), name: name.trim() || 'Notebook', color: '', shares: {}, members: [me()], editors: [me()], createdAt: nowIso() } }]);
  return id;
}
export const renameNotebook = (id: string, name: string) => run([{ kind: 'notebook', id, data: { name: name.trim() || 'Notebook' } }]);
export const colorNotebook = (id: string, color: string) => run([{ kind: 'notebook', id, data: { color } }]);

export function shareNotebook(nb: Notebook, shares: Shares) {
  if (nb.owner !== me()) return;
  const acc = access(nb.owner, shares);
  const next = { ...nb, shares, ...acc };
  state.notebooks.set(nb.id, next); // so reshare() sees the new shares
  const writes: Write[] = [{ kind: 'notebook', id: nb.id, data: { shares, ...acc } }];
  for (const n of state.notes.values()) if (n.notebookId === nb.id && n.owner === me()) writes.push(...reshare(n, n.shares, nb.id));
  run(writes);
}

/** Notes in it go back to "no notebook" (and stop being shared through it). */
export function deleteNotebook(nb: Notebook) {
  if (nb.owner !== me()) return;
  state.notebooks.delete(nb.id);
  const writes: Write[] = [];
  for (const n of state.notes.values()) if (n.notebookId === nb.id && n.owner === me()) writes.push(...reshare(n, n.shares, ''));
  writes.push({ kind: 'delete', path: `notebooks/${nb.id}` });
  run(writes);
}

// ---- Photos, sketches, reminders ------------------------------------------------------------------

export function addPhoto(n: Note, data: string, kind: PhotoRef['kind'], replace?: string): PhotoRef {
  const id = replace || cloud.newId();
  cloud.rememberPhoto(id, data);
  const photos = replace ? n.photos : [...n.photos, { id, kind }];
  run([
    { kind: 'photo', id, data: { owner: me(), members: n.members, editors: n.editors, noteId: n.id, data } },
    { kind: 'note', id: n.id, data: { photos } },
  ]);
  return { id, kind };
}

export function removePhoto(n: Note, id: string) {
  run([
    { kind: 'note', id: n.id, data: { photos: n.photos.filter((p) => p.id !== id) } },
    { kind: 'delete', path: `notePhotos/${id}` },
  ]);
}

export const setDue = (ids: string[], due: string) => updateNotes(ids, { due, dueDone: false });
export const setDueDone = (id: string, done: boolean) => updateNotes([id], { dueDone: done });

// ---- Backup ---------------------------------------------------------------------------------------

export function restore(notes: Partial<Note>[], notebookNames: Record<string, string>) {
  const ids = new Map<string, string>();
  const writes: Write[] = [];
  for (const [oldId, name] of Object.entries(notebookNames)) {
    const existing = [...state.notebooks.values()].find((n) => n.owner === me() && n.name.toLowerCase() === name.toLowerCase());
    const id = existing?.id || cloud.newId();
    ids.set(oldId, id);
    if (!existing) writes.push({ kind: 'notebook', id, data: { owner: me(), name, color: '', shares: {}, members: [me()], editors: [me()], createdAt: nowIso() } });
  }
  const seen = new Set([...state.notes.values()].map((n) => `${n.title}\u0000${n.text}`));
  let added = 0;
  for (const raw of notes) {
    const doc = raw.doc ? sinkChecked(raw.doc) : emptyDoc();
    const n = newNote({ title: raw.title || '', doc, notebookId: ids.get(raw.notebookId || '') || '', pinned: !!raw.pinned, archived: !!raw.archived,
      color: raw.color || '', due: raw.due || '', dueDone: !!raw.dueDone, createdAt: raw.createdAt || nowIso(), updatedAt: raw.updatedAt || nowIso() });
    n.members = [me()]; n.editors = [me()];
    if (seen.has(`${n.title}\u0000${n.text}`)) continue;
    seen.add(`${n.title}\u0000${n.text}`);
    writes.push({ kind: 'note', id: n.id, data: n });
    added++;
  }
  run(writes);
  return added;
}

export const loadPhoto = (id: string) => cloud.loadPhoto(id);
