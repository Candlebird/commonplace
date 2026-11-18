/** Everything that touches Firebase. `npm run dev:stub` swaps this file for cloud.stub.ts. */
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import {
  collection, doc, getDoc, getDocs, initializeFirestore, onSnapshot, persistentLocalCache, persistentMultipleTabManager,
  query, where, writeBatch, type DocumentData, type Firestore,
} from 'firebase/firestore';
import { nowIso, upgradeLegacy, type LegacyNote, type Note, type Notebook } from './model';

// Shared Candlebird Firebase project (not secret: firestore.rules in the crusade-dataslate repo protects the data).
const app = initializeApp({
  apiKey: 'AIzaSyBHBFpcIP-S9m7hp6nEa07Y7aTlaE01cRA',
  authDomain: 'crusade-dataslate.firebaseapp.com',
  projectId: 'crusade-dataslate',
  storageBucket: 'crusade-dataslate.firebasestorage.app',
  messagingSenderId: '765607704790',
  appId: '1:765607704790:web:cc6bc5539e268daacdb177',
});
const auth = getAuth(app);
let db: Firestore;
try {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true, localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, { ignoreUndefinedProperties: true });
}

export interface User { email: string; name: string; photo: string }
export interface SyncState { pending: boolean; offline: boolean }

let onFail: (e: Error) => void = (e) => console.error(e);
export const setErrorHandler = (f: (e: Error) => void) => { onFail = f; };

export const watchUser = (cb: (u: User | null) => void) =>
  onAuthStateChanged(auth, (u) => cb(u?.email ? { email: u.email.toLowerCase(), name: u.displayName || '', photo: u.photoURL || '' } : null));
export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider()).then(() => undefined);
export const signOutUser = () => signOut(auth);

const asNote = (id: string, v: DocumentData): Note => ({
  id,
  owner: v.owner,
  members: v.members || [v.owner],
  editors: v.editors || [v.owner],
  shares: v.shares || {},
  title: v.title || '',
  doc: v.doc || null,
  text: v.text || '',
  tags: v.tags || [],
  links: v.links || [],
  notebookId: v.notebookId || '',
  pinned: !!v.pinned,
  archived: !!v.archived,
  trashed: !!v.trashed,
  color: v.color || '',
  due: v.due || '',
  dueDone: !!v.dueDone,
  photos: v.photos || [],
  photoText: v.photoText || '',
  createdAt: v.createdAt || '',
  updatedAt: v.updatedAt || '',
  updatedBy: v.updatedBy || v.owner,
});

export function watchNotes(email: string, cb: (notes: Note[], s: SyncState) => void, onError: (e: Error & { code?: string }) => void) {
  return onSnapshot(
    query(collection(db, 'notes'), where('members', 'array-contains', email)),
    { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => asNote(d.id, d.data())), { pending: snap.metadata.hasPendingWrites, offline: snap.metadata.fromCache }),
    onError,
  );
}

export function watchNotebooks(email: string, cb: (nbs: Notebook[]) => void, onError: (e: Error) => void) {
  return onSnapshot(
    query(collection(db, 'notebooks'), where('members', 'array-contains', email)),
    (snap) => cb(snap.docs.map((d) => {
      const v = d.data();
      return { id: d.id, owner: v.owner, name: v.name || 'Untitled', color: v.color || '', shares: v.shares || {}, members: v.members || [v.owner], editors: v.editors || [v.owner], createdAt: v.createdAt || '' };
    })),
    onError,
  );
}

export const newId = () => doc(collection(db, 'notes')).id;

type Write =
  | { kind: 'note'; id: string; data: Partial<Note>; replace?: boolean }
  | { kind: 'notebook'; id: string; data: Partial<Notebook> }
  | { kind: 'photo'; id: string; data: Record<string, unknown> }
  | { kind: 'delete'; path: string };

/** Apply writes in batches. Not awaited by callers: offline writes queue up and the snapshot shows them at once. */
export function commit(writes: Write[], me: string): Promise<void> {
  const t = nowIso();
  const jobs: Promise<void>[] = [];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = writeBatch(db);
    for (const w of writes.slice(i, i + 400)) {
      if (w.kind === 'delete') batch.delete(doc(db, w.path));
      else if (w.kind === 'note') {
        const { id: _, ...data } = w.data as Note;
        batch.set(doc(db, 'notes', w.id), { ...data, updatedAt: data.updatedAt || t, updatedBy: me }, { merge: !w.replace });
      } else if (w.kind === 'notebook') {
        const { id: _, ...data } = w.data as Notebook;
        batch.set(doc(db, 'notebooks', w.id), data, { merge: true });
      } else batch.set(doc(db, 'notePhotos', w.id), w.data, { merge: true });
    }
    jobs.push(batch.commit().catch((e) => { onFail(e); throw e; }));
  }
  return Promise.all(jobs).then(() => undefined);
}

const photoCache = new Map<string, Promise<string>>();
export function loadPhoto(id: string): Promise<string> {
  let p = photoCache.get(id);
  if (!p) {
    p = getDoc(doc(db, 'notePhotos', id)).then((s) => (s.exists() ? String(s.data().data || '') : ''));
    p.catch(() => photoCache.delete(id));
    photoCache.set(id, p);
  }
  return p;
}
export const rememberPhoto = (id: string, data: string) => { photoCache.set(id, Promise.resolve(data)); };

/**
 * Bring this person's v1 notes (plain text, notebooks by name, no sharing fields) up to date.
 * Runs once per sign-in; quick when there's nothing to do.
 */
export async function migrate(email: string, notebooks: Notebook[]): Promise<number> {
  const snap = await getDocs(query(collection(db, 'notes'), where('owner', '==', email)));
  const legacy = snap.docs.filter((d) => !Array.isArray(d.data().members));
  if (!legacy.length) return 0;
  const writes: Write[] = [];
  const byName = new Map(notebooks.filter((n) => n.owner === email).map((n) => [n.name.toLowerCase(), n.id]));
  for (const d of legacy) {
    const v = d.data() as LegacyNote;
    let nb = '';
    if (v.notebook) {
      nb = byName.get(v.notebook.toLowerCase()) || '';
      if (!nb) {
        nb = newId();
        byName.set(v.notebook.toLowerCase(), nb);
        writes.push({ kind: 'notebook', id: nb, data: { owner: email, name: v.notebook, color: '', shares: {}, members: [email], editors: [email], createdAt: nowIso() } });
      }
    }
    const up = upgradeLegacy(d.id, v, nb);
    // A full replace, so the v1-only fields (body, labels, source…) go.
    writes.push({ kind: 'note', id: d.id, data: up, replace: true });
    if (v.hasPhoto) writes.push({ kind: 'photo', id: d.id, data: { owner: email, members: [email], editors: [email], noteId: d.id } });
  }
  await commit(writes, email);
  return legacy.length;
}

export type { Write };
