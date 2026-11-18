import { useMemo, useState } from 'react';
import type { Filter, View } from '../App';
import { COLORS, dueState, isShared, type Notebook } from '../model';
import * as store from '../store';
import { useStore } from '../store';
import { Icon } from './Icon';
import { Popover } from './Menus';

export function Sidebar({ filter, go, open, onClose, onShareNotebook }: {
  filter: Filter;
  go: (f: Partial<Filter>) => void;
  open: boolean;
  onClose: () => void;
  onShareNotebook: (nb: Notebook) => void;
}) {
  const me = useStore((s) => s.user?.email || '');
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const [allTags, setAllTags] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [menu, setMenu] = useState<string | null>(null);

  const c = useMemo(() => {
    const k = { notes: 0, reminders: 0, shared: 0, archive: 0, trash: 0, nb: new Map<string, number>(), tags: new Map<string, number>() };
    for (const n of notes.values()) {
      if (n.trashed) { k.trash++; continue; }
      const s = dueState(n);
      if (s === 'overdue' || s === 'today') k.reminders++;
      if (n.archived) { k.archive++; continue; }
      k.notes++;
      if (isShared(n)) k.shared++;
      if (n.notebookId) k.nb.set(n.notebookId, (k.nb.get(n.notebookId) || 0) + 1);
      for (const t of n.tags) k.tags.set(t, (k.tags.get(t) || 0) + 1);
    }
    return k;
  }, [notes]);

  const plain = !filter.notebookId && !filter.tag;
  const item = (view: View, icon: string, label: string, n: number, alert = false) => (
    <button className={`nav-item ${plain && filter.view === view ? 'on' : ''}`} onClick={() => go({ view })}>
      <Icon name={icon} /><span className="label">{label}</span>{n ? <span className={alert ? 'n alert' : 'n'}>{n}</span> : null}
    </button>
  );
  const nbs = [...notebooks.values()].sort((a, b) => a.name.localeCompare(b.name));
  const tags = [...c.tags.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  return (
    <>
      {open && <div className="scrim" onClick={onClose} />}
      <nav className={`side ${open ? 'open' : ''}`} aria-label="Notebooks and views">
        {item('notes', 'notes', 'Notes', c.notes)}
        {item('reminders', 'bell', 'Reminders', c.reminders, true)}
        {item('shared', 'users', 'Shared', c.shared)}
        {item('archive', 'archive', 'Archive', 0)}
        {item('trash', 'trash', 'Trash', 0)}

        <h4>Notebooks <button className="icon-btn tiny" aria-label="New notebook" title="New notebook" onClick={() => setAdding(true)}><Icon name="plus" size={16} /></button></h4>
        {adding && (
          <form className="nb-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { const id = store.createNotebook(name); setName(''); setAdding(false); go({ view: 'notes', notebookId: id }); } }}>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} placeholder="Notebook name" aria-label="Notebook name" />
          </form>
        )}
        {nbs.map((nb) => (
          <div key={nb.id} className={`nav-item nb ${filter.notebookId === nb.id ? 'on' : ''}`}>
            <button className="nav-main" onClick={() => go({ view: 'notes', notebookId: nb.id })}>
              <span className="dot" data-color={nb.color} />
              <span className="label">{nb.name}</span>
              {isShared(nb) && <Icon name="users" size={14} />}
            </button>
            <span className="n">{c.nb.get(nb.id) || ''}</span>
            {nb.owner === me && (
              <span className="menu-anchor">
                <button className="icon-btn tiny nb-more" aria-label={`${nb.name} options`} onClick={() => setMenu(menu === nb.id ? null : nb.id)}><Icon name="more" size={16} /></button>
                {menu === nb.id && <NotebookMenu nb={nb} onClose={() => setMenu(null)} onShare={() => { setMenu(null); onShareNotebook(nb); }} />}
              </span>
            )}
          </div>
        ))}
        {!nbs.length && !adding && <p className="hint">Group notes into notebooks, like Work or Recipes.</p>}

        {tags.length > 0 && <h4>Tags</h4>}
        {(allTags ? tags : tags.slice(0, 12)).map(([t, n]) => (
          <button key={t} className={`nav-item ${filter.tag === t ? 'on' : ''}`} onClick={() => go({ view: 'notes', tag: t })}>
            <Icon name="tag" size={16} /><span className="label">{t}</span><span className="n">{n}</span>
          </button>
        ))}
        {tags.length > 12 && <button className="nav-item hint" onClick={() => setAllTags((a) => !a)}>{allTags ? 'Fewer tags' : `All ${tags.length} tags`}</button>}
      </nav>
    </>
  );
}

function NotebookMenu({ nb, onClose, onShare }: { nb: Notebook; onClose: () => void; onShare: () => void }) {
  const [name, setName] = useState(nb.name);
  const [armed, setArmed] = useState(false);
  return (
    <Popover onClose={onClose} className="menu">
      <form className="menu-custom" onSubmit={(e) => { e.preventDefault(); store.renameNotebook(nb.id, name); onClose(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Notebook name" />
        <button className="primary">Rename</button>
      </form>
      <div className="swatch-row">
        {COLORS.map((c) => <button key={c.id} className={`swatch small ${nb.color === c.id ? 'on' : ''}`} data-color={c.id} title={c.label} aria-label={c.label} onClick={() => store.colorNotebook(nb.id, c.id)} />)}
      </div>
      <button onClick={onShare}><Icon name="users" size={16} /> Share notebook…</button>
      <button className="danger" onClick={() => { if (!armed) return setArmed(true); store.deleteNotebook(nb); onClose(); }}>
        <Icon name="trash" size={16} /> {armed ? 'Sure? Its notes stay, without a notebook' : 'Delete notebook'}
      </button>
    </Popover>
  );
}
