import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Highlight from '@tiptap/extension-highlight';
import type { StartWith } from '../App';
import { calendarUrl, canEdit, derive, docMarkdown, dueState, fmtDate, fmtDue, noteLabel, removeChecked, taskCounts, type Doc, type Note } from '../model';
import * as store from '../store';
import { useStore } from '../store';
import { Hashtags, NoteLink, SinkChecked, type LinkOption } from '../editor/extensions';
import { canListen, listen, tidyDictation, type Listener } from '../voice';
import { Icon } from './Icon';
import { ColorMenu, MoveMenu, Popover, ReminderMenu } from './Menus';
import { Thumb } from './NoteCard';
import { SketchPad } from './SketchPad';
import { compressImage, readText } from '../photos';
import { ConfirmButton } from '../App';

type MenuName = 'remind' | 'color' | 'move' | 'more' | null;

export function NoteEditor({ note, isDraft, start, onClose, onOpenNote, onShare, onTag }: {
  note: Note; isDraft: boolean; start?: StartWith;
  onClose: () => void; onOpenNote: (id: string) => void; onShare: (n: Note) => void; onTag: (t: string) => void;
}) {
  const me = useStore((s) => s.user?.email || '');
  const notes = useStore((s) => s.notes);
  const notebooks = useStore((s) => s.notebooks);
  const editable = canEdit(note, me) && !note.trashed;
  const owner = note.owner === me;

  const [title, setTitle] = useState(note.title);
  const [menu, setMenu] = useState<MenuName>(null);
  const [sketch, setSketch] = useState<{ replace?: string } | null>(start === 'sketch' ? {} : null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [dictating, setDictating] = useState(false);
  const [interim, setInterim] = useState('');
  const [counts, setCounts] = useState(() => taskCounts(note.doc));

  const titleRef = useRef(note.title);
  const created = useRef(!isDraft);
  const lastSaved = useRef(JSON.stringify([note.title, note.doc]));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const dictation = useRef<Listener | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  /** Make sure the note exists before attaching anything to it. */
  const ensure = useCallback(() => {
    if (created.current) return;
    const doc = editorRef.current?.getJSON() as Doc | undefined || note.doc;
    store.createNote({ ...noteRef.current, title: titleRef.current, doc, ...derive(titleRef.current, doc || null) }, true);
    created.current = true;
    lastSaved.current = JSON.stringify([titleRef.current, doc]);
  }, [note.doc]);

  const save = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const ed = editorRef.current;
    if (!ed || !editable) return;
    const doc = ed.getJSON() as Doc;
    const key = JSON.stringify([titleRef.current, doc]);
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    if (!created.current) {
      const n = { ...noteRef.current, title: titleRef.current, doc, ...derive(titleRef.current, doc) };
      if (!n.title.trim() && !n.text.trim()) return;
      store.createNote(n);
      created.current = true;
    } else store.setBody(note.id, titleRef.current, doc);
  }, [editable, note.id]);
  const later = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(save, 600); }, [save]);

  // ---- [[links]] ----
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const findLinks = useCallback((q: string): LinkOption[] => {
    const query = q.trim().toLowerCase();
    const all = [...notesRef.current.values()].filter((n) => !n.trashed && n.id !== note.id);
    const hits: LinkOption[] = all
      .map((n) => ({ n, label: noteLabel(n), s: 0 }))
      .map((x) => ({ ...x, s: !query ? 1 : x.label.toLowerCase() === query ? 3 : x.label.toLowerCase().startsWith(query) ? 2 : x.label.toLowerCase().includes(query) ? 1 : 0 }))
      .filter((x) => x.s)
      .sort((a, b) => b.s - a.s || b.n.updatedAt.localeCompare(a.n.updatedAt))
      .slice(0, 6)
      .map((x) => ({ id: x.n.id, label: x.label }));
    if (query && !hits.some((h) => h.label.toLowerCase() === query)) hits.push({ id: '', label: q.trim(), create: true });
    return hits;
  }, [note.id]);
  const createLinked = useCallback((label: string) => {
    const n = store.newNote({ title: label, notebookId: noteRef.current.owner === me ? noteRef.current.notebookId : '' });
    store.createNote(n);
    return n.id;
  }, [me]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ autolink: true, openOnClick: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Placeholder.configure({ placeholder: ({ node }) => (node.type.name === 'heading' ? 'Heading' : 'Note. Type [[ to link a note, # for a tag') }),
      Highlight,
      Hashtags,
      SinkChecked,
      NoteLink.configure({ find: findLinks, create: createLinked }),
    ],
    content: note.doc || undefined,
    editable,
    autofocus: isDraft && start !== 'sketch' && start !== 'photo' ? (start === 'list' ? 'end' : 'start') : false,
    onUpdate: ({ editor: ed }) => { setCounts(taskCounts(ed.getJSON() as Doc)); later(); },
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true', 'aria-label': 'Note body' },
      handleClickOn: (_view, _pos, node, _nodePos, event) => {
        if (node.type.name === 'noteLink') { event.preventDefault(); save(); onOpenNote(node.attrs.id); return true; }
        return false;
      },
      handleDOMEvents: {
        click: (_view, e) => {
          const t = (e.target as HTMLElement).closest('.hashtag') as HTMLElement | null;
          if (t && (e.ctrlKey || e.metaKey || !editable)) { e.preventDefault(); save(); onTag(t.dataset.tag!); return true; }
          const a = (e.target as HTMLElement).closest('a[data-note-link]');
          if (a) { e.preventDefault(); return true; }
          return false;
        },
      },
    },
  });
  editorRef.current = editor;

  useEffect(() => { editor?.setEditable(editable); }, [editor, editable]);

  // Someone else (or another device) changed this note: show it, unless there's an unsaved local change.
  useEffect(() => {
    if (!editor || timer.current) return;
    const key = JSON.stringify([note.title, note.doc]);
    if (key === lastSaved.current) return;
    lastSaved.current = key;
    if (note.title !== titleRef.current) { titleRef.current = note.title; setTitle(note.title); }
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(note.doc)) {
      const { from, to } = editor.state.selection;
      editor.commands.setContent(note.doc || '', false);
      const max = editor.state.doc.content.size;
      try { editor.commands.setTextSelection({ from: Math.min(from, max), to: Math.min(to, max) }); } catch { /* fine */ }
      setCounts(taskCounts(note.doc));
    }
  }, [editor, note.title, note.doc]);

  // Save on close, tab switch, or leaving the page.
  useEffect(() => {
    const away = () => { if (document.visibilityState === 'hidden') save(); };
    document.addEventListener('visibilitychange', away);
    addEventListener('pagehide', save);
    return () => { document.removeEventListener('visibilitychange', away); removeEventListener('pagehide', save); save(); dictation.current?.stop(); };
  }, [save]);

  // ---- Dictation into the note ----
  const stopDictation = () => { dictation.current?.stop(); dictation.current = null; setDictating(false); setInterim(''); };
  const startDictation = () => {
    if (!editor) return;
    if (!canListen()) { store.toast("This browser can't take dictation. Try Chrome, or your keyboard's mic key."); return; }
    setDictating(true);
    dictation.current = listen({
      keepAlive: true,
      onInterim: setInterim,
      onFinal: (raw) => {
        const ed = editorRef.current;
        if (!ed) return;
        const text = tidyDictation(raw);
        const chain = ed.chain().focus();
        const before = ed.state.selection.$from.parent.textContent;
        text.split('\n').forEach((part, i) => {
          if (i) chain.splitBlock();
          if (part) chain.insertContent((i === 0 && before && !/\s$/.test(before) ? ' ' : '') + part);
        });
        chain.run();
      },
      onEnd: (err) => {
        setDictating(false); setInterim(''); dictation.current = null;
        if (err === 'not-allowed' || err === 'service-not-allowed') store.toast('Microphone access is blocked for this site.');
      },
    });
  };
  useEffect(() => { if (start === 'voice' && editor) startDictation(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [editor]);
  useEffect(() => { if (start === 'photo') fileRef.current?.click(); }, [start]);

  // ---- Photos ----
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    ensure();
    for (const f of [...files].filter((x) => x.type.startsWith('image/'))) {
      try {
        const data = await compressImage(f);
        const ref = store.addPhoto(noteRef.current, data, 'photo');
        noteRef.current = { ...noteRef.current, photos: [...noteRef.current.photos, ref] };
        readText(data).then((t) => {
          if (!t) return;
          const cur = store.getState().notes.get(note.id) || noteRef.current;
          store.updateNote(note.id, { photoText: [cur.photoText, t].filter(Boolean).join('\n\n').slice(0, 20000) });
        }).catch(() => {});
      } catch (e) { store.fail(e); }
    }
  };
  const saveSketch = (data: string) => {
    ensure();
    store.addPhoto(noteRef.current, data, 'sketch', sketch?.replace);
    setSketch(null);
  };

  const closeAll = () => { stopDictation(); save(); onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !menu && !sketch && !viewing && !document.querySelector('.suggest')) { e.preventDefault(); closeAll(); }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  });

  const backlinks = useMemo(() => [...notes.values()].filter((n) => !n.trashed && n.links.includes(note.id)), [notes, note.id]);
  const notebook = notebooks.get(note.notebookId);
  const due = dueState(note);
  const appUrl = location.origin + location.pathname;

  const exportMd = () => {
    const md = (title ? `# ${title}\n\n` : '') + docMarkdown(editor?.getJSON() as Doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${(title || noteLabel(note)).replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 60) || 'note'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="editor-wrap" onPointerDown={(e) => { if (e.target === e.currentTarget) closeAll(); }}>
      <div className="editor" data-color={note.color} role="dialog" aria-label={noteLabel(note)}>
        <header className="ed-top">
          <button className="icon-btn" onClick={closeAll} aria-label="Close"><Icon name="back" /></button>
          <span className="spacer" />
          {!editable && <span className="pill">{note.trashed ? 'In trash' : 'View only'}</span>}
          {editable && <>
            <button className={`icon-btn ${note.pinned ? 'on' : ''}`} title={note.pinned ? 'Unpin' : 'Pin'} aria-label="Pin" onClick={() => { ensure(); store.updateNote(note.id, { pinned: !note.pinned }); }}><Icon name="pin" /></button>
            <span className="menu-anchor">
              <button className={`icon-btn ${note.due ? 'on' : ''}`} title="Remind me" aria-label="Remind me" onClick={() => setMenu(menu === 'remind' ? null : 'remind')}><Icon name="bell" /></button>
              {menu === 'remind' && <ReminderMenu due={note.due} onPick={(d) => { ensure(); store.setDue([note.id], d); setMenu(null); }} onClose={() => setMenu(null)} />}
            </span>
            <span className="menu-anchor">
              <button className="icon-btn" title="Color" aria-label="Color" onClick={() => setMenu(menu === 'color' ? null : 'color')}><Icon name="palette" /></button>
              {menu === 'color' && <ColorMenu current={note.color} onPick={(c) => { ensure(); store.updateNote(note.id, { color: c }); }} onClose={() => setMenu(null)} />}
            </span>
          </>}
          {owner && !note.trashed && <button className="icon-btn" title="Share" aria-label="Share" onClick={() => { ensure(); onShare(noteRef.current); }}><Icon name="users" /></button>}
          <span className="menu-anchor">
            <button className="icon-btn" title="More" aria-label="More" onClick={() => setMenu(menu === 'more' ? null : 'more')}><Icon name="more" /></button>
            {menu === 'more' && (
              <Popover onClose={() => setMenu(null)} className="menu">
                {note.trashed ? <>
                  <button onClick={() => { store.updateNotes([note.id], { trashed: false }); setMenu(null); }}><Icon name="undo" size={16} /> Restore</button>
                  {owner && <ConfirmButton label="Delete forever" onConfirm={() => { store.deleteForever([note]); onClose(); }} />}
                </> : <>
                  {counts.done > 0 && editable && <button onClick={() => { editor?.commands.setContent(removeChecked(editor.getJSON() as Doc), true); setMenu(null); }}><Icon name="check-square" size={16} /> Clear {counts.done} ticked item{counts.done > 1 ? 's' : ''}</button>}
                  {editable && <button onClick={() => { setMenu(null); editor?.chain().focus('end').toggleTaskList().run(); }}><Icon name="check-square" size={16} /> Checkboxes on/off</button>}
                  {owner && <button onClick={() => setMenu('move')}><Icon name="folder" size={16} /> {notebook ? 'Move to another notebook' : 'Put in a notebook'}</button>}
                  <button onClick={() => { save(); const id = store.duplicate({ ...noteRef.current, title: titleRef.current, doc: editor?.getJSON() as Doc }); setMenu(null); if (id) onOpenNote(id); }}><Icon name="copy" size={16} /> Make a copy</button>
                  <button onClick={() => { navigator.clipboard?.writeText(`${appUrl}#note/${note.id}`).then(() => store.toast('Link copied. It opens for anyone this note is shared with.')); setMenu(null); }}><Icon name="link" size={16} /> Copy link</button>
                  <button onClick={() => { exportMd(); setMenu(null); }}><Icon name="download" size={16} /> Download as Markdown</button>
                  {editable && created.current && <button onClick={() => { store.archive([note.id], !note.archived); setMenu(null); closeAll(); }}><Icon name="archive" size={16} /> {note.archived ? 'Unarchive' : 'Archive'}</button>}
                  {owner && created.current && <button className="danger" onClick={() => { save(); store.trash([note.id]); onClose(); }}><Icon name="trash" size={16} /> Delete</button>}
                </>}
              </Popover>
            )}
            {menu === 'move' && <MoveMenu current={note.notebookId} onPick={(id) => { ensure(); store.moveNotes([note.id], id); setMenu(null); }} onClose={() => setMenu(null)} />}
          </span>
        </header>

        <div className="ed-scroll">
          {note.photos.length > 0 && (
            <div className="photos">
              {note.photos.map((p) => (
                <button key={p.id} className={`photo ${p.kind}`} onClick={() => setViewing(p.id)} aria-label={p.kind === 'sketch' ? 'Open sketch' : 'Open photo'}><Thumb id={p.id} /></button>
              ))}
            </div>
          )}

          <input className="ed-title" value={title} readOnly={!editable} placeholder="Title" aria-label="Title"
            onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; later(); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor?.commands.focus('start'); } }} />

          {(note.due || notebook) && (
            <div className="ed-meta">
              {note.due && (
                <span className={`chip due ${due}`}>
                  <button className="chip-btn" disabled={!editable} title={note.dueDone ? 'Mark not done' : 'Mark done'} onClick={() => store.setDueDone(note.id, !note.dueDone)}>
                    <Icon name={note.dueDone ? 'check' : 'bell'} size={14} />{fmtDue(note.due)}{note.dueDone ? ' · done' : ''}
                  </button>
                  <a href={calendarUrl({ ...note, title: titleRef.current }, appUrl)} target="_blank" rel="noopener noreferrer" title="Add to calendar"><Icon name="calendar" size={14} /></a>
                </span>
              )}
              {notebook && <span className="chip nb"><span className="dot" data-color={notebook.color} />{notebook.name}</span>}
            </div>
          )}

          <EditorContent editor={editor} className="ed-body" />

          {backlinks.length > 0 && (
            <section className="backlinks">
              <h4>Linked from</h4>
              {backlinks.map((b) => <button key={b.id} className="backlink" onClick={() => { save(); onOpenNote(b.id); }}>{noteLabel(b)}</button>)}
            </section>
          )}

          <p className="ed-foot muted small">
            {created.current ? <>Edited {fmtDate(note.updatedAt)}{note.updatedBy && note.updatedBy !== me ? ` by ${note.updatedBy.split('@')[0]}` : ''}</> : 'New note'}
            {!owner && <> · Shared by {note.owner}</>}
            {owner && note.members.length > 1 && <> · Shared with {note.members.length - 1} {note.members.length === 2 ? 'person' : 'people'}</>}
          </p>
        </div>

        {dictating && <div className="dictating"><span className="pulse" />{interim || 'Listening… say “new line” or “period”'}<button className="link" onClick={stopDictation}>Stop</button></div>}

        {editable && editor && (
          <div className="toolbar" role="toolbar" aria-label="Formatting">
            <button className={`icon-btn ${dictating ? 'rec' : ''}`} title="Dictate" aria-label="Dictate" onClick={() => (dictating ? stopDictation() : startDictation())}><Icon name="mic" /></button>
            <button className="icon-btn" title="Checklist" aria-label="Checklist" onClick={() => editor.chain().focus().toggleTaskList().run()} data-on={editor.isActive('taskList')}><Icon name="check-square" /></button>
            <button className="icon-btn" title="Bulleted list" aria-label="Bulleted list" onClick={() => editor.chain().focus().toggleBulletList().run()} data-on={editor.isActive('bulletList')}><Icon name="list" /></button>
            <button className="icon-btn hide-xs" title="Numbered list" aria-label="Numbered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} data-on={editor.isActive('orderedList')}><Icon name="list-ordered" /></button>
            <button className="icon-btn" title="Heading" aria-label="Heading" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} data-on={editor.isActive('heading')}><Icon name="heading" /></button>
            <button className="icon-btn" title="Bold" aria-label="Bold" onClick={() => editor.chain().focus().toggleBold().run()} data-on={editor.isActive('bold')}><Icon name="bold" /></button>
            <button className="icon-btn hide-xs" title="Italic" aria-label="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} data-on={editor.isActive('italic')}><Icon name="italic" /></button>
            <button className="icon-btn hide-sm" title="Strikethrough" aria-label="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} data-on={editor.isActive('strike')}><Icon name="strike" /></button>
            <button className="icon-btn hide-sm" title="Highlight" aria-label="Highlight" onClick={() => editor.chain().focus().toggleHighlight().run()} data-on={editor.isActive('highlight')}><Icon name="highlight" /></button>
            <button className="icon-btn hide-sm" title="Quote" aria-label="Quote" onClick={() => editor.chain().focus().toggleBlockquote().run()} data-on={editor.isActive('blockquote')}><Icon name="quote" /></button>
            <button className="icon-btn" title="Link a note" aria-label="Link a note" onClick={() => editor.chain().focus().insertContent('[[').run()}><Icon name="link" /></button>
            <button className="icon-btn" title="Add photo" aria-label="Add photo" onClick={() => fileRef.current?.click()}><Icon name="image" /></button>
            <button className="icon-btn" title="Sketch" aria-label="Sketch" onClick={() => setSketch({})}><Icon name="pen" /></button>
            <span className="spacer" />
            <button className="icon-btn hide-xs" title="Undo" aria-label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Icon name="undo" /></button>
            <button className="icon-btn hide-sm" title="Redo" aria-label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}><Icon name="redo" /></button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {sketch && <SketchPad base={sketch.replace} onSave={saveSketch} onCancel={() => setSketch(null)} />}
      {viewing && (
        <Lightbox id={viewing} note={note} editable={editable}
          onClose={() => setViewing(null)}
          onEdit={() => { setSketch({ replace: viewing }); setViewing(null); }}
          onRemove={() => { store.removePhoto(note, viewing); setViewing(null); }}
          onInsertText={(t) => { editor?.chain().focus('end').insertContent(t.split(/\n{2,}/).map((p) => ({ type: 'paragraph', content: p.trim() ? [{ type: 'text', text: p.trim() }] : [] }))).run(); setViewing(null); }} />
      )}
    </div>
  );
}

function Lightbox({ id, note, editable, onClose, onEdit, onRemove, onInsertText }: {
  id: string; note: Note; editable: boolean; onClose: () => void; onEdit: () => void; onRemove: () => void; onInsertText: (t: string) => void;
}) {
  const ref = note.photos.find((p) => p.id === id);
  const [reading, setReading] = useState(false);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [onClose]);
  const grab = async () => {
    setReading(true);
    try {
      const t = await readText(await store.loadPhoto(id));
      if (t) onInsertText(t); else store.toast("Couldn't find any words in that picture.");
    } catch { store.toast("Couldn't read that picture."); }
    setReading(false);
  };
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lb-img" onClick={(e) => e.stopPropagation()}><Thumb id={id} /></div>
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose}><Icon name="x" size={16} /> Close</button>
        {editable && ref?.kind === 'photo' && <button onClick={grab} disabled={reading}><Icon name="text" size={16} /> {reading ? 'Reading…' : 'Copy text into note'}</button>}
        {editable && ref?.kind === 'sketch' && <button onClick={onEdit}><Icon name="pen" size={16} /> Draw on it</button>}
        {editable && <button className="danger" onClick={() => (armed ? onRemove() : setArmed(true))}><Icon name="trash" size={16} /> {armed ? 'Sure?' : 'Remove'}</button>}
      </div>
    </div>
  );
}
