import { useRef, useState } from 'react';
import { docMarkdown, noteLabel, type Note } from '../model';
import * as store from '../store';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Popover } from './Menus';

const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
};
const stamp = () => new Date().toISOString().slice(0, 10);

export function AccountMenu() {
  const user = useStore((s) => s.user)!;
  const [open, setOpen] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const mine = () => [...store.getState().notes.values()].filter((n) => n.owner === user.email && !n.trashed);
  const backup = () => {
    const notes = mine();
    const notebooks = Object.fromEntries([...store.getState().notebooks.values()].filter((n) => n.owner === user.email).map((n) => [n.id, n.name]));
    const strip = (n: Note) => ({ title: n.title, doc: n.doc, notebookId: n.notebookId, pinned: n.pinned, archived: n.archived, color: n.color, due: n.due, dueDone: n.dueDone, createdAt: n.createdAt, updatedAt: n.updatedAt });
    download(`commonplace-backup-${stamp()}.json`, JSON.stringify({ app: 'commonplace', version: 2, notebooks, notes: notes.map(strip) }, null, 1), 'application/json');
    setOpen(false);
  };
  const markdown = () => {
    const nbs = store.getState().notebooks;
    const md = mine().map((n) => `# ${noteLabel(n)}\n\n${[nbs.get(n.notebookId)?.name && `Notebook: ${nbs.get(n.notebookId)!.name}`, n.tags.length && `Tags: ${n.tags.map((t) => '#' + t).join(' ')}`, `Updated: ${n.updatedAt.slice(0, 10)}`].filter(Boolean).join(' · ')}\n\n${docMarkdown(n.doc)}`).join('\n\n---\n\n');
    download(`commonplace-notes-${stamp()}.md`, md, 'text/markdown');
    setOpen(false);
  };
  const restore = async (f: File | undefined) => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data?.notes)) throw new Error('not a backup');
      const added = store.restore(data.notes, data.notebooks || {});
      store.toast(added ? `Restored ${added} note${added > 1 ? 's' : ''}.` : 'Everything in that backup is already here.');
    } catch { store.toast("That file isn't a Commonplace backup."); }
    setOpen(false);
  };

  return (
    <span className="menu-anchor">
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-label="Account">
        {user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" /> : <span>{(user.name || user.email)[0].toUpperCase()}</span>}
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} className="menu right">
          <div className="menu-title">{user.name || 'Signed in'}<br /><span className="muted small">{user.email}</span></div>
          <button onClick={backup}><Icon name="download" size={16} /> Back up everything (JSON)</button>
          <button onClick={markdown}><Icon name="download" size={16} /> Export all as Markdown</button>
          <button onClick={() => file.current?.click()}><Icon name="upload" size={16} /> Restore a backup…</button>
          <p className="menu-note">Tip: add Commonplace to your home screen. Long-press its icon for New list, Voice note and Drive mode shortcuts, and share from other apps straight into a note.</p>
          <button onClick={() => { setOpen(false); store.signOut(); }}><Icon name="logout" size={16} /> Sign out</button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => { void restore(e.target.files?.[0]); e.target.value = ''; }} />
        </Popover>
      )}
    </span>
  );
}
