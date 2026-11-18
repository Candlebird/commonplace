import { useEffect, useRef, useState } from 'react';
import { fmtDue, noteLabel, textToDoc, type Doc, type Note } from '../model';
import * as store from '../store';
import { canListen, listen, parseCommand, parseWhen, say, tidyDictation, type Listener } from '../voice';
import { Icon } from './Icon';

interface Line { who: 'you' | 'app'; text: string }

const HELP = 'Just say your note. Or say: add eggs to groceries. Remind me to call Sam tomorrow at 5. Read my groceries list. Scratch that. Or stop.';

const listItems = (doc: Doc | null) => {
  const out: { text: string; checked: boolean }[] = [];
  const walk = (d: Doc) => {
    if (d.type === 'taskItem') {
      const t: string[] = [];
      const txt = (x: Doc) => { if (x.text) t.push(x.text); x.content?.forEach(txt); };
      txt(d);
      out.push({ text: t.join(''), checked: !!d.attrs?.checked });
      return;
    }
    d.content?.forEach(walk);
  };
  if (doc) walk(doc);
  return out;
};
const isList = (n: Note) => !!n.doc?.content?.some((c) => c.type === 'taskList');

/** Put a new open item at the end of the open part of the note's first checklist (or start one). */
function withItem(doc: Doc | null, item: string): Doc {
  const d: Doc = doc ? structuredClone(doc) : { type: 'doc', content: [] };
  const node: Doc = { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }] };
  const list = d.content?.find((c) => c.type === 'taskList');
  if (!list) { d.content = [...(d.content || []), { type: 'taskList', content: [node] }]; return d; }
  const items = (list.content || []).filter((c) => !(c.type === 'taskItem' && !c.attrs?.checked && !listItems(c).some((x) => x.text.trim())));
  const firstDone = items.findIndex((c) => c.attrs?.checked);
  items.splice(firstDone < 0 ? items.length : firstDone, 0, node);
  list.content = items;
  return d;
}

const words = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\b(the|my|a|list)\b/g, ' ').trim().replace(/\s+/g, ' ');

function findList(name: string): Note | undefined {
  const want = words(name);
  const lists = [...store.getState().notes.values()].filter((n) => !n.trashed && isList(n)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const plural = (s: string) => s.replace(/s$/, '');
  return lists.find((n) => words(noteLabel(n)) === want)
    || lists.find((n) => plural(words(noteLabel(n))) === plural(want))
    || lists.find((n) => words(noteLabel(n)).includes(want) || want.includes(words(noteLabel(n))));
}

export function DriveMode({ onClose }: { onClose: () => void }) {
  const [on, setOn] = useState(false);
  const [interim, setInterim] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [problem, setProblem] = useState('');
  const listener = useRef<Listener | null>(null);
  const muted = useRef(false);
  const greeted = useRef(false);
  const undoStack = useRef<(() => void)[]>([]);
  const lock = useRef<{ release: () => Promise<void> } | null>(null);

  const log = (who: Line['who'], text: string) => setLines((l) => [...l.slice(-30), { who, text }]);
  const reply = async (text: string) => {
    log('app', text);
    muted.current = true;
    await say(text);
    setTimeout(() => { muted.current = false; }, 350);
  };

  const handle = async (raw: string) => {
    if (muted.current) return;
    log('you', raw);
    const c = parseCommand(raw);
    switch (c.kind) {
      case 'stop': await reply('Drive mode off.'); stop(); onClose(); return;
      case 'help': return reply(HELP);
      case 'undo': {
        const u = undoStack.current.pop();
        if (!u) return reply('Nothing to undo.');
        u();
        return reply('Removed.');
      }
      case 'add': {
        let n = findList(c.list);
        if (!n) {
          const title = c.list.replace(/^\p{L}/u, (x) => x.toUpperCase());
          n = store.newNote({ title, doc: withItem(null, c.item) });
          store.createNote(n);
          const id = n.id;
          undoStack.current.push(() => store.trash([id]));
          return reply(`Started a ${title} list with ${c.item}.`);
        }
        const before = n.doc;
        store.updateNote(n.id, { doc: withItem(n.doc, c.item) });
        const id = n.id;
        undoStack.current.push(() => store.updateNote(id, { doc: before }));
        return reply(`Added ${c.item} to ${noteLabel(n)}.`);
      }
      case 'read': {
        const n = findList(c.list);
        if (!n) return reply(`I can't find a ${c.list} list.`);
        const open = listItems(n.doc).filter((x) => !x.checked && x.text.trim()).map((x) => x.text);
        return reply(open.length ? `${noteLabel(n)}: ${open.join(', ')}.` : `${noteLabel(n)} has nothing left on it.`);
      }
      case 'remind': {
        const due = c.when ? parseWhen(c.when) : parseWhen('today');
        const text = c.text.replace(/^\p{L}/u, (x) => x.toUpperCase());
        const n = store.newNote({ title: text, due });
        store.createNote(n);
        undoStack.current.push(() => store.trash([n.id]));
        return reply(`Reminder set for ${fmtDue(due)}: ${text}.`);
      }
      case 'note':
      case 'unknown': {
        const body = tidyDictation(c.text);
        const n = store.newNote({ doc: textToDoc(body) });
        store.createNote(n);
        undoStack.current.push(() => store.trash([n.id]));
        return reply('Saved.');
      }
    }
  };
  const handleRef = useRef(handle);
  handleRef.current = handle;
  // Lets tests speak to Drive mode by typing.
  if (import.meta.env.DEV) (window as unknown as { __drive?: (t: string) => Promise<void> }).__drive = (t) => handleRef.current(t);

  const start = async () => {
    setProblem('');
    if (!canListen()) { setProblem("This browser can't listen. Use Chrome on Android, or Safari on iPhone."); return; }
    try { lock.current = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') || null; } catch { /* no wake lock */ }
    setOn(true);
    listener.current = listen({
      keepAlive: true,
      onFinal: (t) => { void handleRef.current(t); },
      onInterim: (t) => { if (!muted.current) setInterim(t); },
      onEnd: (err) => {
        setOn(false);
        setInterim('');
        if (err === 'not-allowed' || err === 'service-not-allowed') setProblem('Microphone access is blocked. Allow it for this site in the browser settings, then tap Start.');
        else if (err && err !== 'unsupported') setProblem('Listening stopped. Tap Start to go again.');
      },
    });
    if (!greeted.current) { greeted.current = true; void reply('Listening. Say help for ideas.'); }
  };
  const stop = () => {
    listener.current?.stop();
    listener.current = null;
    lock.current?.release().catch(() => {});
    lock.current = null;
    setOn(false);
  };

  // Start right away: the tap that opened Drive mode counts as the go-ahead for the microphone.
  useEffect(() => {
    void start();
    const vis = async () => {
      if (document.visibilityState === 'visible' && lock.current === null && listener.current) {
        try { lock.current = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') || null; } catch { /* none */ }
      }
    };
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); stop(); speechSynthesis?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const last = [...lines].reverse().slice(0, 6).reverse();
  return (
    <div className="drive" role="dialog" aria-label="Drive mode">
      <header>
        <b><Icon name="car" /> Drive mode</b>
        <button className="drive-close" onClick={() => { stop(); onClose(); }}>Done</button>
      </header>
      <button className={`drive-mic ${on ? 'on' : ''}`} onClick={() => (on ? stop() : start())} aria-label={on ? 'Stop listening' : 'Start listening'}>
        <Icon name="mic" size={72} />
        <span>{on ? 'Listening' : 'Start'}</span>
      </button>
      <div className="drive-interim">{interim || (on ? 'Say a note, or “help”' : problem || 'Paused')}</div>
      <div className="drive-log">
        {last.map((l, i) => <p key={i} className={l.who}>{l.text}</p>)}
      </div>
      <p className="drive-tips">“Add milk to groceries” · “Read my groceries list” · “Remind me to call Sam tomorrow at 5” · “Scratch that” · “Stop”</p>
    </div>
  );
}
