import { useEffect, useMemo, useRef, useState } from 'react';
import { checklistDoc, dueDate, dueHasTime, dueState, emptyDoc, fmtDue, isShared, noteLabel, textToDoc, type Note, type Notebook } from './model';
import { highlightTerms, isEmptyQuery, parseQuery, score } from './search';
import * as store from './store';
import { useStore } from './store';
import { Sidebar } from './components/Sidebar';
import { NoteCard } from './components/NoteCard';
import { NoteEditor } from './components/NoteEditor';
import { SharePanel } from './components/SharePanel';
import { DriveMode } from './components/DriveMode';
import { AccountMenu } from './components/AccountMenu';
import { Icon } from './components/Icon';
import { MoveMenu, ReminderMenu } from './components/Menus';

export type View = 'notes' | 'reminders' | 'shared' | 'archive' | 'trash';
export interface Filter { view: View; notebookId: string | null; tag: string | null }

/** How a new note should open: plain, as a checklist, straight into dictation, or with a photo or sketch. */
export type StartWith = 'text' | 'list' | 'voice' | 'photo' | 'sketch';

const VIEW_KEY = 'commonplace.view2';
const readView = () => { try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}'); } catch { return {}; } };

export function App() {
  const user = useStore((s) => s.user);
  if (user === undefined) return <div className="boot" />;
  if (!user) return <Gate />;
  return <Shell email={user.email} />;
}

function Gate() {
  const error = useStore((s) => s.error);
  return (
    <div className="gate">
      <img src="icon.svg" alt="" width={64} height={64} />
      <h1>Commonplace</h1>
      <p>A personal notebook. Write, make lists, dictate, sketch, link notes together, set reminders and share with the people you choose, on every device.</p>
      <button className="primary big" onClick={store.signIn}>Sign in</button>
      <p className="small">Notes are private to the account you sign in with, unless you share them.<br />
        A small open-source project by Candlebird · <a href="https://github.com/Candlebird/commonplace">source code</a> · <a href="https://candlebird.github.io/">other projects</a></p>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

function Shell({ email }: { email: string }) {
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const loaded = useStore((s) => s.loaded);
  const denied = useStore((s) => s.denied);
  const sync = useStore((s) => s.sync);
  const error = useStore((s) => s.error);
  const toast = useStore((s) => s.toast);

  const saved = readView();
  const [filter, setFilter] = useState<Filter>({ view: saved.view || 'notes', notebookId: saved.notebookId ?? null, tag: null });
  const [layout, setLayout] = useState<'grid' | 'list'>(saved.layout || 'grid');
  const [q, setQ] = useState('');
  const [navOpen, setNavOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ note: Note; start: StartWith } | null>(null);
  const [sharing, setSharing] = useState<{ note?: Note; notebook?: Notebook } | null>(null);
  const [driving, setDriving] = useState(false);
  const [bulkMenu, setBulkMenu] = useState<'move' | 'remind' | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, JSON.stringify({ view: filter.view, notebookId: filter.notebookId, layout })); } catch { /* private mode */ }
  }, [filter, layout]);

  // A notebook that was deleted (or unshared) stops being the current filter.
  useEffect(() => {
    if (loaded && filter.notebookId && !notebooks.has(filter.notebookId)) setFilter((f) => ({ ...f, notebookId: null }));
  }, [loaded, notebooks, filter.notebookId]);

  // ---- Routing: #note/<id> is the open note, so the phone's back button closes it. ----
  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#note\/(.+)$/);
      setOpenId(m ? decodeURIComponent(m[1]) : null);
      if (!m) setDraft(null);
    };
    read();
    addEventListener('hashchange', read);
    return () => removeEventListener('hashchange', read);
  }, []);
  const openNote = (id: string) => { history.pushState({ commonplace: true }, '', `#note/${encodeURIComponent(id)}`); setOpenId(id); };
  const closeNote = () => {
    if (history.state?.commonplace) history.back();
    else history.replaceState(null, '', location.pathname + location.search);
    setOpenId(null);
    setDraft(null);
  };
  const startNote = (start: StartWith = 'text', init: Partial<Note> = {}) => {
    const note = store.newNote({
      doc: start === 'list' ? checklistDoc() : emptyDoc(),
      notebookId: filter.notebookId && canAddTo(notebooks.get(filter.notebookId), email) ? filter.notebookId : '',
      ...init,
    });
    setDraft({ note, start });
    history.pushState({ commonplace: true }, '', `#note/${note.id}`);
    setOpenId(note.id);
  };

  // ---- Shared from another app, home-screen shortcuts ----
  useEffect(() => {
    if (!loaded) return;
    const p = new URLSearchParams(location.search);
    if (![...p.keys()].length) return;
    history.replaceState(null, '', location.pathname + location.hash);
    if (p.has('drive')) return setDriving(true);
    if (p.has('new')) return startNote((p.get('new') as StartWith) || 'text');
    const title = p.get('title') || '', text = p.get('text') || '', url = p.get('url') || '';
    if (title || text || url) {
      const body = [text, url && !text.includes(url) ? url : ''].filter(Boolean).join('\n');
      startNote('text', { title: title && !body.startsWith(title) ? title : '', doc: textToDoc(body) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (openId || driving || t.closest('input, textarea, select, [contenteditable=true], dialog')) return;
      if (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'c' || e.key === 'n') { e.preventDefault(); startNote('text'); }
      else if (e.key === 'l') { e.preventDefault(); startNote('list'); }
      else if (e.key === 'Escape' && selected.size) setSelected(new Set());
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  useReminderAlerts(notes, openNote);

  // ---- What to show ----
  const query = useMemo(() => parseQuery(q), [q]);
  const searching = !isEmptyQuery(query);
  const marks = useMemo(() => highlightTerms(query), [query]);
  const nbName = (id: string) => notebooks.get(id)?.name || '';

  const list = useMemo(() => {
    const out: { n: Note; s: number }[] = [];
    for (const n of notes.values()) {
      const v = filter.view;
      if (v === 'trash' ? !n.trashed : n.trashed) continue;
      if (!searching) {
        if (v === 'archive' ? !n.archived : n.archived && v !== 'trash' && v !== 'reminders') continue;
        if (v === 'reminders' && !n.due) continue;
        if (v === 'shared' && !isShared(n)) continue;
      }
      if (filter.notebookId && n.notebookId !== filter.notebookId) continue;
      if (filter.tag && !n.tags.includes(filter.tag)) continue;
      const s = searching ? score(n, query, nbName(n.notebookId)) : 1;
      if (s) out.push({ n, s });
    }
    if (searching) out.sort((a, b) => b.s - a.s || b.n.updatedAt.localeCompare(a.n.updatedAt));
    else if (filter.view === 'reminders') out.sort((a, b) => Number(a.n.dueDone) - Number(b.n.dueDone) || (dueDate(a.n.due)!.getTime() - dueDate(b.n.due)!.getTime()) * (a.n.dueDone ? -1 : 1));
    else out.sort((a, b) => b.n.updatedAt.localeCompare(a.n.updatedAt));
    return out.map((x) => x.n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, notebooks, filter, query, searching]);

  const groups = useMemo(() => groupNotes(list, filter.view, searching, email), [list, filter.view, searching, email]);

  const open = openId ? notes.get(openId) || (draft?.note.id === openId ? draft.note : null) : null;
  // A link to a note that isn't here (deleted, or not shared with you).
  useEffect(() => {
    if (openId && loaded && !open) { store.toast("That note isn't available. It may have been deleted, or it isn't shared with you."); closeNote(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, loaded, open]);

  const title = searching ? 'Search'
    : filter.notebookId ? nbName(filter.notebookId) || 'Notebook'
    : filter.tag ? '#' + filter.tag
    : { notes: 'Notes', reminders: 'Reminders', shared: 'Shared', archive: 'Archive', trash: 'Trash' }[filter.view];

  const sel = [...selected].map((id) => notes.get(id)).filter((n): n is Note => !!n);
  const toggleSel = (id: string) => setSelected((s) => { const x = new Set(s); x.has(id) ? x.delete(id) : x.add(id); return x; });
  const go = (f: Partial<Filter>) => { setFilter((old) => ({ ...old, tag: null, notebookId: null, ...f })); setNavOpen(false); setSelected(new Set()); setQ(''); scrollTo({ top: 0 }); };

  return (
    <div className="shell">
      <header className="top">
        <button className="icon-btn menu-btn" onClick={() => setNavOpen((o) => !o)} aria-label="Menu"><Icon name="menu" /></button>
        <a className="brand" href="./" onClick={(e) => { e.preventDefault(); go({ view: 'notes' }); }}><img src="icon.svg" alt="" /><span>Commonplace</span></a>
        <label className="search">
          <Icon name="search" />
          <input ref={searchRef} type="search" value={q} placeholder="Search" aria-label="Search notes"
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); e.currentTarget.blur(); } }} />
        </label>
        <span className="sync" title={sync.offline ? 'Offline: changes are kept on this device and sync later' : sync.pending ? 'Saving' : 'Saved'}>
          <Icon name={sync.offline ? 'cloud-off' : sync.pending ? 'cloud-up' : 'cloud'} />
        </span>
        <button className="icon-btn hide-sm" onClick={() => setLayout((l) => (l === 'grid' ? 'list' : 'grid'))} aria-label="Switch layout" title={layout === 'grid' ? 'List view' : 'Grid view'}>
          <Icon name={layout === 'grid' ? 'rows' : 'grid'} />
        </button>
        <button className="icon-btn" onClick={() => setDriving(true)} aria-label="Drive mode" title="Drive mode: hands-free notes"><Icon name="car" /></button>
        <AccountMenu />
      </header>

      <div className="layout">
        <Sidebar filter={filter} go={go} open={navOpen} onClose={() => setNavOpen(false)} onShareNotebook={(nb) => setSharing({ notebook: nb })} />
        <main className="main">
          {denied && <div className="banner err">Can't reach your notes. The database rules may still be publishing. Try again in a minute.</div>}
          {error && <div className="banner err"><span>{error}</span><button className="link" onClick={store.clearError}>Dismiss</button></div>}

          {filter.view !== 'trash' && filter.view !== 'archive' && <CaptureBar onStart={startNote} />}

          <div className="list-head">
            <h2>{title}</h2>
            <span className="muted">{list.length || ''}</span>
            {filter.notebookId && notebooks.get(filter.notebookId) && isShared(notebooks.get(filter.notebookId)!) && <span className="pill">Shared</span>}
            <span className="spacer" />
            {filter.view === 'trash' && list.length > 0 && !searching && <EmptyTrash notes={list} />}
          </div>

          {!loaded ? <div className="empty">Loading…</div>
            : !list.length ? <Empty view={filter.view} searching={searching} q={q} any={notes.size > 0} />
            : groups.map(([label, ns]) => (
              <section key={label || 'all'}>
                {label && <h3 className="group">{label}</h3>}
                <div className={layout === 'grid' ? 'cards grid' : 'cards'}>
                  {ns.map((n) => (
                    <NoteCard key={n.id} note={n} me={email} marks={marks} selected={selected.has(n.id)} selecting={selected.size > 0}
                      notebook={notebooks.get(n.notebookId)} onOpen={() => openNote(n.id)} onSelect={() => toggleSel(n.id)} onTag={(t) => go({ view: 'notes', tag: t })} />
                  ))}
                </div>
              </section>
            ))}
        </main>
      </div>

      {selected.size > 0 && (
        <div className="bulk">
          <button className="icon-btn" onClick={() => setSelected(new Set())} aria-label="Clear selection"><Icon name="x" /></button>
          <b>{selected.size} selected</b>
          <span className="spacer" />
          {filter.view === 'trash' ? <>
            <button onClick={() => { store.updateNotes([...selected], { trashed: false }); setSelected(new Set()); }}>Restore</button>
            <ConfirmButton label="Delete forever" onConfirm={() => { store.deleteForever(sel); setSelected(new Set()); }} />
          </> : <>
            <button className="icon-btn" title="Pin" onClick={() => { store.updateNotes([...selected], { pinned: !sel.every((n) => n.pinned) }); setSelected(new Set()); }}><Icon name="pin" /></button>
            <span className="menu-anchor">
              <button className="icon-btn" title="Remind me" onClick={() => setBulkMenu(bulkMenu === 'remind' ? null : 'remind')}><Icon name="bell" /></button>
              {bulkMenu === 'remind' && <ReminderMenu due="" onPick={(d) => { store.setDue([...selected], d); setBulkMenu(null); setSelected(new Set()); }} onClose={() => setBulkMenu(null)} />}
            </span>
            <span className="menu-anchor">
              <button className="icon-btn" title="Move to notebook" onClick={() => setBulkMenu(bulkMenu === 'move' ? null : 'move')}><Icon name="folder" /></button>
              {bulkMenu === 'move' && <MoveMenu current="" onPick={(id) => { store.moveNotes([...selected], id); setBulkMenu(null); setSelected(new Set()); }} onClose={() => setBulkMenu(null)} />}
            </span>
            <button className="icon-btn" title={filter.view === 'archive' ? 'Unarchive' : 'Archive'} onClick={() => { store.archive([...selected], filter.view !== 'archive'); setSelected(new Set()); }}><Icon name="archive" /></button>
            <button className="icon-btn" title="Delete" onClick={() => { store.trash(sel.filter((n) => n.owner === email).map((n) => n.id)); setSelected(new Set()); }}><Icon name="trash" /></button>
          </>}
        </div>
      )}

      <div className="fab-wrap">
        <button className="fab" onClick={() => startNote('text')} aria-label="New note"><Icon name="plus" /></button>
      </div>

      {open && (
        <NoteEditor key={open.id} note={open} isDraft={!notes.has(open.id)} start={draft?.note.id === open.id ? draft.start : undefined}
          onClose={closeNote} onOpenNote={openNote} onShare={(n) => setSharing({ note: n })} onTag={(t) => { closeNote(); go({ view: 'notes', tag: t }); }} />
      )}
      {sharing && <SharePanel note={sharing.note ? notes.get(sharing.note.id) || sharing.note : undefined} notebook={sharing.notebook} onClose={() => setSharing(null)} />}
      {driving && <DriveMode onClose={() => setDriving(false)} />}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && <button className="link" onClick={() => { toast.undo!(); store.dismissToast(); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}

export const canAddTo = (nb: Notebook | undefined, me: string) => !!nb && (nb.owner === me || nb.editors.includes(me));

function CaptureBar({ onStart }: { onStart: (s: StartWith) => void }) {
  return (
    <div className="capture">
      <button className="capture-main" onClick={() => onStart('text')}>Take a note…</button>
      <button className="icon-btn" title="New list" aria-label="New list" onClick={() => onStart('list')}><Icon name="check-square" /></button>
      <button className="icon-btn" title="Dictate a note" aria-label="Dictate a note" onClick={() => onStart('voice')}><Icon name="mic" /></button>
      <button className="icon-btn" title="Note with a photo" aria-label="Note with a photo" onClick={() => onStart('photo')}><Icon name="image" /></button>
      <button className="icon-btn" title="Sketch" aria-label="Sketch" onClick={() => onStart('sketch')}><Icon name="pen" /></button>
    </div>
  );
}

function Empty({ view, searching, q, any }: { view: View; searching: boolean; q: string; any: boolean }) {
  const msg = searching ? <>Nothing matches <b>{q}</b>.</>
    : !any ? <>Nothing here yet. Take a note above, press <kbd>C</kbd> for a note or <kbd>L</kbd> for a list, or try Drive mode <Icon name="car" /> for hands-free notes.</>
    : { notes: 'No notes here.', reminders: 'No reminders. Open a note and tap the bell to add one.', shared: 'Nothing shared yet. Open a note or notebook and tap Share.', archive: 'Nothing archived.', trash: 'Trash is empty.' }[view];
  return <div className="empty">{msg}</div>;
}

function EmptyTrash({ notes }: { notes: Note[] }) {
  return <ConfirmButton label="Empty trash" onConfirm={() => store.deleteForever(notes)} />;
}

export function ConfirmButton({ label, onConfirm, className = '' }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 4000); return () => clearTimeout(t); }, [armed]);
  return <button className={`${className} ${armed ? 'danger-solid' : 'danger'}`} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>{armed ? 'Sure? It can\'t be undone' : label}</button>;
}

function groupNotes(list: Note[], view: View, searching: boolean, me: string): [string, Note[]][] {
  if (searching) return [['', list]];
  if (view === 'reminders') {
    const g = new Map<string, Note[]>();
    for (const n of list) {
      const s = dueState(n);
      const k = s === 'overdue' ? 'Overdue' : s === 'today' ? 'Today' : s === 'done' ? 'Done' : 'Upcoming';
      g.set(k, [...(g.get(k) || []), n]);
    }
    return ['Overdue', 'Today', 'Upcoming', 'Done'].filter((k) => g.has(k)).map((k) => [k, g.get(k)!]);
  }
  if (view === 'shared') {
    const mine = list.filter((n) => n.owner === me), theirs = list.filter((n) => n.owner !== me);
    return [['Shared with you', theirs], ['You shared', mine]].filter(([, ns]) => ns.length) as [string, Note[]][];
  }
  if (view === 'trash') return [['', list]];
  const pinned = list.filter((n) => n.pinned), rest = list.filter((n) => !n.pinned);
  return pinned.length ? [['Pinned', pinned], ['Others', rest]].filter(([, ns]) => ns.length) as [string, Note[]][] : [['', rest]];
}

/** While the app is open: a notification (or a toast) when a timed reminder comes due, and the count on the app icon. */
function useReminderAlerts(notes: Map<string, Note>, openNote: (id: string) => void) {
  useEffect(() => {
    const KEY = 'commonplace.alerted';
    const check = () => {
      let alerted: string[] = [];
      try { alerted = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { /* none */ }
      const now = new Date();
      let overdue = 0;
      for (const n of notes.values()) {
        if (n.trashed || !n.due || n.dueDone) continue;
        const s = dueState(n, now);
        if (s === 'overdue' || s === 'today') overdue++;
        const key = `${n.id}@${n.due}`;
        if (!dueHasTime(n.due) || dueDate(n.due)! > now || alerted.includes(key)) continue;
        if (now.getTime() - dueDate(n.due)!.getTime() > 6 * 3600e3) { alerted.push(key); continue; } // long past: don't nag
        alerted.push(key);
        const body = `${fmtDue(n.due)}${n.text ? ' · ' + n.text.slice(0, 120) : ''}`;
        if ('Notification' in window && Notification.permission === 'granted') {
          navigator.serviceWorker?.getRegistration().then((r) => {
            if (r) r.showNotification(noteLabel(n), { body, tag: n.id, icon: 'icon-192.png', data: { id: n.id } });
            else new Notification(noteLabel(n), { body, tag: n.id }).onclick = () => openNote(n.id);
          });
        } else store.toast(`Reminder: ${noteLabel(n)}`);
      }
      try { localStorage.setItem(KEY, JSON.stringify(alerted.slice(-300))); } catch { /* full */ }
      const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      if (overdue) nav.setAppBadge?.(overdue).catch(() => {}); else nav.clearAppBadge?.().catch(() => {});
    };
    check();
    const t = setInterval(check, 30000);
    return () => clearInterval(t);
  }, [notes, openNote]);
}
