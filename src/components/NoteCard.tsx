import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { canEdit, dueState, fmtDue, isShared, taskCounts, type Doc, type Note, type Notebook } from '../model';
import * as store from '../store';
import { Icon } from './Icon';

/** Text with search words marked. */
export function Marked({ text, marks }: { text: string; marks: string[] }) {
  if (!marks.length || !text) return <>{text}</>;
  const esc = (m: string) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${marks.map(esc).join('|')})`, 'gi');
  return <>{text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export function Thumb({ id, alt = '' }: { id: string; alt?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => { let live = true; store.loadPhoto(id).then((d) => live && setSrc(d)).catch(() => {}); return () => { live = false; }; }, [id]);
  return src ? <img src={src} alt={alt} loading="lazy" /> : <span className="thumb-wait" />;
}

const MAX_BLOCKS = 10;

/** A short read-only rendering of a note's body, with tickable checklist items. */
function Preview({ note, marks, editable }: { note: Note; marks: string[]; editable: boolean }) {
  let taskIndex = 0, blocks = 0, hiddenTasks = 0;
  const inline = (d: Doc, k: number): ReactNode => {
    if (d.type === 'text') {
      let el: ReactNode = <Marked text={d.text || ''} marks={marks} />;
      for (const m of d.marks || []) {
        if (m.type === 'bold') el = <b>{el}</b>;
        else if (m.type === 'italic') el = <i>{el}</i>;
        else if (m.type === 'strike') el = <s>{el}</s>;
        else if (m.type === 'code') el = <code>{el}</code>;
        else if (m.type === 'highlight') el = <mark className="hl">{el}</mark>;
      }
      return <Fragment key={k}>{el}</Fragment>;
    }
    if (d.type === 'noteLink') return <span key={k} className="note-link">{String(d.attrs?.label || '')}</span>;
    if (d.type === 'hardBreak') return <br key={k} />;
    return null;
  };
  const block = (d: Doc, k: number): ReactNode => {
    if (blocks >= MAX_BLOCKS) { if (d.type === 'taskItem') { hiddenTasks++; taskIndex++; } return null; }
    switch (d.type) {
      case 'paragraph': blocks++; return d.content?.length ? <p key={k}>{d.content.map(inline)}</p> : null;
      case 'heading': blocks++; return <p key={k} className="h">{d.content?.map(inline)}</p>;
      case 'blockquote': return <blockquote key={k}>{d.content?.map(block)}</blockquote>;
      case 'codeBlock': blocks++; return <pre key={k}>{d.content?.map(inline)}</pre>;
      case 'bulletList': return <ul key={k}>{d.content?.map(block)}</ul>;
      case 'orderedList': return <ol key={k}>{d.content?.map(block)}</ol>;
      case 'listItem': return <li key={k}>{d.content?.map(block)}</li>;
      case 'taskList': return <ul key={k} className="tasks">{d.content?.map(block)}</ul>;
      case 'taskItem': {
        const i = taskIndex++;
        const checked = !!d.attrs?.checked;
        blocks++;
        return (
          <li key={k} className={checked ? 'done' : ''}>
            <input type="checkbox" checked={checked} disabled={!editable} aria-label="Done"
              onClick={(e) => e.stopPropagation()} onChange={() => store.toggleTaskAt(note, i)} />
            <span>{d.content?.map((c, j) => (c.type === 'paragraph' ? <Fragment key={j}>{c.content?.map(inline)}</Fragment> : block(c, j)))}</span>
          </li>
        );
      }
      case 'horizontalRule': return <hr key={k} />;
      default: return d.content ? <Fragment key={k}>{d.content.map(block)}</Fragment> : null;
    }
  };
  const body = note.doc?.content?.map(block);
  const more = hiddenTasks ? `+ ${hiddenTasks} more item${hiddenTasks > 1 ? 's' : ''}` : '';
  return <div className="preview">{body}{more && <p className="muted small">{more}</p>}</div>;
}

export function NoteCard({ note, me, marks, notebook, selected, selecting, onOpen, onSelect, onTag }: {
  note: Note; me: string; marks: string[]; notebook?: Notebook; selected: boolean; selecting: boolean;
  onOpen: () => void; onSelect: () => void; onTag: (t: string) => void;
}) {
  const due = dueState(note);
  const tasks = taskCounts(note.doc);
  const editable = canEdit(note, me);
  const photo = note.photos[0];
  return (
    <article className={`card ${selected ? 'selected' : ''}`} data-color={note.color} tabIndex={0}
      onClick={() => (selecting ? onSelect() : onOpen())}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      onContextMenu={(e) => { e.preventDefault(); onSelect(); }}>
      <button className={`card-select ${selected ? 'on' : ''}`} aria-label={selected ? 'Deselect' : 'Select'} onClick={(e) => { e.stopPropagation(); onSelect(); }}>
        <Icon name="check" size={14} />
      </button>
      {note.pinned && <span className="card-pin" title="Pinned"><Icon name="pin" size={16} /></span>}
      {photo && <div className="card-photo"><Thumb id={photo.id} />{note.photos.length > 1 && <span className="count">+{note.photos.length - 1}</span>}</div>}
      {note.title && <h3><Marked text={note.title} marks={marks} /></h3>}
      <Preview note={note} marks={marks} editable={editable} />
      {!note.title && !note.text.trim() && !photo && <p className="muted">Empty note</p>}
      <footer>
        {note.due && <span className={`chip due ${due}`}><Icon name={due === 'done' ? 'check' : 'bell'} size={13} />{fmtDue(note.due)}</span>}
        {tasks.open + tasks.done > 0 && tasks.done > 0 && <span className="chip">{tasks.done}/{tasks.open + tasks.done}</span>}
        {notebook && <span className="chip nb"><span className="dot" data-color={notebook.color} />{notebook.name}</span>}
        {note.tags.slice(0, 4).map((t) => <button key={t} className="chip tag" onClick={(e) => { e.stopPropagation(); onTag(t); }}>#{t}</button>)}
        {isShared(note) && <span className="chip" title={note.owner === me ? 'You shared this' : `Shared by ${note.owner}`}><Icon name="users" size={13} />{note.owner === me ? '' : note.owner.split('@')[0]}</span>}
      </footer>
    </article>
  );
}
