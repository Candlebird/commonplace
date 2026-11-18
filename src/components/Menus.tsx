import { useEffect, useRef, useState, type ReactNode } from 'react';
import { COLORS, localDateTime, ymd } from '../model';
import * as store from '../store';
import { useStore } from '../store';
import { canAddTo } from '../App';
import { Icon } from './Icon';

/** A small pop-up that closes on outside click or Escape. */
export function Popover({ onClose, children, className = '' }: { onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.menu-anchor')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); };
  }, [onClose]);
  // Keep the menu on screen.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth - 8) el.style.left = `${Math.min(0, innerWidth - 8 - r.right)}px`;
    if (r.bottom > innerHeight - 8 && r.top > r.height) { el.style.top = 'auto'; el.style.bottom = '100%'; }
  }, []);
  return <div ref={ref} className={`popover ${className}`} onClick={(e) => e.stopPropagation()}>{children}</div>;
}

export function ReminderMenu({ due, onPick, onClose }: { due: string; onPick: (due: string) => void; onClose: () => void }) {
  const now = new Date();
  const at = (days: number, h: number) => localDateTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h));
  const laterToday = now.getHours() < 17 ? at(0, 18) : now.getHours() < 20 ? at(0, 21) : null;
  const monday = (8 - now.getDay()) % 7 || 7;
  const [custom, setCustom] = useState(due || at(1, 9));
  const [allDay, setAllDay] = useState(due.length === 10);
  const pick = (d: string) => {
    onPick(d);
    if (d.length > 10 && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
  };
  return (
    <Popover onClose={onClose} className="menu">
      <div className="menu-title">Remind me</div>
      {laterToday && <button onClick={() => pick(laterToday)}>Later today <span>{laterToday.slice(11)}</span></button>}
      <button onClick={() => pick(at(1, 9))}>Tomorrow <span>9:00</span></button>
      <button onClick={() => pick(at(monday, 9))}>Next week <span>Mon 9:00</span></button>
      <div className="menu-custom">
        {allDay
          ? <input type="date" value={custom.slice(0, 10)} onChange={(e) => setCustom(e.target.value)} aria-label="Date" />
          : <input type="datetime-local" value={custom.length === 10 ? custom + 'T09:00' : custom} onChange={(e) => setCustom(e.target.value)} aria-label="Date and time" />}
        <label className="check"><input type="checkbox" checked={allDay} onChange={(e) => { setAllDay(e.target.checked); setCustom((c) => (e.target.checked ? c.slice(0, 10) : c.length === 10 ? c + 'T09:00' : c)); }} /> All day</label>
        <button className="primary" onClick={() => custom && pick(allDay ? custom.slice(0, 10) : custom)}>Set</button>
      </div>
      {due && <button className="danger" onClick={() => onPick('')}>Remove reminder</button>}
      <p className="menu-note">Alerts pop up while Commonplace is open on that device. Add to calendar for a phone alarm.</p>
    </Popover>
  );
}

export function MoveMenu({ current, onPick, onClose }: { current: string; onPick: (notebookId: string) => void; onClose: () => void }) {
  const me = useStore((s) => s.user?.email || '');
  const notebooks = useStore((s) => s.notebooks);
  const [name, setName] = useState('');
  const list = [...notebooks.values()].filter((n) => canAddTo(n, me)).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Popover onClose={onClose} className="menu">
      <div className="menu-title">Notebook</div>
      <button className={current === '' ? 'on' : ''} onClick={() => onPick('')}>No notebook</button>
      {list.map((n) => <button key={n.id} className={current === n.id ? 'on' : ''} onClick={() => onPick(n.id)}><span className="dot" data-color={n.color} />{n.name}{n.owner !== me ? <span>shared</span> : null}</button>)}
      <form className="menu-custom" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onPick(store.createNotebook(name)); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New notebook" aria-label="New notebook name" />
        <button className="primary" disabled={!name.trim()}>Add</button>
      </form>
    </Popover>
  );
}

export function ColorMenu({ current, onPick, onClose }: { current: string; onPick: (c: string) => void; onClose: () => void }) {
  return (
    <Popover onClose={onClose} className="menu swatches">
      {COLORS.map((c) => (
        <button key={c.id} className={`swatch ${current === c.id ? 'on' : ''}`} data-color={c.id} title={c.label} aria-label={c.label} onClick={() => onPick(c.id)}>
          {current === c.id && <Icon name="check" size={16} />}
        </button>
      ))}
    </Popover>
  );
}

export const todayYmd = () => ymd(new Date());
