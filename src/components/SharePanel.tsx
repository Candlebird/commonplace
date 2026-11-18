import { useEffect, useState } from 'react';
import { cleanEmail, isEmail, noteLabel, type Note, type Notebook, type Role, type Shares } from '../model';
import * as store from '../store';
import { useStore } from '../store';
import { Icon } from './Icon';

/** Who can see a note or notebook. People open it by signing in with that email address. */
export function SharePanel({ note, notebook, onClose }: { note?: Note; notebook?: Notebook; onClose: () => void }) {
  const me = useStore((s) => s.user?.email || '');
  const notebooks = useStore((s) => s.notebooks);
  const target = note || notebook!;
  const [shares, setShares] = useState<Shares>({ ...target.shares });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [err, setErr] = useState('');
  const viaNotebook = note?.notebookId ? notebooks.get(note.notebookId) : undefined;
  const inherited = viaNotebook ? Object.entries(viaNotebook.shares).filter(([e]) => e !== me && !shares[e]) : [];

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);

  const add = () => {
    const list = email.split(/[\s,;]+/).map(cleanEmail).filter(Boolean);
    const bad = list.find((e) => !isEmail(e));
    if (bad) return setErr(`"${bad}" doesn't look like an email address.`);
    if (list.includes(me)) return setErr("That's you.");
    setShares((s) => ({ ...s, ...Object.fromEntries(list.map((e) => [e, role])) }));
    setEmail(''); setErr('');
  };
  const changed = JSON.stringify(Object.entries(shares).sort()) !== JSON.stringify(Object.entries(target.shares).sort());
  const save = () => {
    const pending = email.trim() ? (add(), null) : shares;
    if (!pending) return;
    if (note) store.shareNote(note, pending); else store.shareNotebook(notebook!, pending);
    const n = Object.keys(pending).length;
    store.toast(n ? `Shared with ${n} ${n === 1 ? 'person' : 'people'}. They'll find it under Shared after signing in.` : 'Only you can see it now.');
    onClose();
  };
  const link = `${location.origin}${location.pathname}${note ? `#note/${note.id}` : ''}`;

  return (
    <div className="modal-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label="Share">
        <h2><Icon name="users" /> Share {note ? `“${noteLabel(note)}”` : `notebook “${notebook!.name}”`}</h2>
        <p className="muted small">
          {note ? 'People you add can open this note when they sign in with that email address.' : 'People you add see every note in this notebook, including new ones, when they sign in with that email address.'}
        </p>
        <form className="share-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input type="email" inputMode="email" autoFocus value={email} onChange={(e) => { setEmail(e.target.value); setErr(''); }} placeholder="Email address" aria-label="Email address" />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} aria-label="Permission">
            <option value="editor">Can edit</option>
            <option value="viewer">Can view</option>
          </select>
          <button className="primary" disabled={!email.trim()}>Add</button>
        </form>
        {err && <p className="error-text">{err}</p>}
        <ul className="people">
          <li><span className="who">{me} <span className="muted">(you)</span></span><span className="muted">Owner</span></li>
          {Object.entries(shares).sort().map(([e, r]) => (
            <li key={e}>
              <span className="who">{e}</span>
              <select value={r} onChange={(ev) => setShares((s) => ({ ...s, [e]: ev.target.value as Role }))} aria-label={`Permission for ${e}`}>
                <option value="editor">Can edit</option>
                <option value="viewer">Can view</option>
              </select>
              <button className="icon-btn tiny" aria-label={`Remove ${e}`} onClick={() => setShares((s) => { const x = { ...s }; delete x[e]; return x; })}><Icon name="x" size={16} /></button>
            </li>
          ))}
          {inherited.map(([e, r]) => (
            <li key={e} className="muted"><span className="who">{e}</span><span>{r === 'editor' ? 'Can edit' : 'Can view'} · from notebook {viaNotebook!.name}</span></li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="link" onClick={() => navigator.clipboard?.writeText(link).then(() => store.toast('Link copied. Only people it is shared with can open it.'))}><Icon name="link" size={16} /> Copy link</button>
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={save} disabled={!changed && !email.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
