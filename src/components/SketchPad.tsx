import { useEffect, useRef, useState } from 'react';
import * as store from '../store';
import { compressImage } from '../photos';
import { Icon } from './Icon';

const INKS = ['#1f1d1a', '#c2410c', '#2563eb', '#15803d', '#a21caf', '#eab308'];
const SIZES = [3, 7, 16];

/** Finger or pen drawing. With `base`, draws on top of an existing sketch. */
export function SketchPad({ base, onSave, onCancel }: { base?: string; onSave: (data: string) => void; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ink, setInk] = useState(INKS[0]);
  const [size, setSize] = useState(1);
  const [erase, setErase] = useState(false);
  const [dirty, setDirty] = useState(false);
  const history = useRef<ImageData[]>([]);
  const [steps, setSteps] = useState(0);

  useEffect(() => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    if (base) {
      store.loadPhoto(base).then((src) => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(c.width / img.width, c.height / img.height);
          g.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k);
        };
        img.src = src;
      }).catch(() => {});
    }
  }, [base]);

  useEffect(() => {
    const c = canvas.current!;
    const g = c.getContext('2d')!;
    let drawing = false, lx = 0, ly = 0;
    const scale = () => c.width / c.getBoundingClientRect().width;
    const pt = (e: PointerEvent) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (c.width / r.width), (e.clientY - r.top) * (c.height / r.height)]; };
    const width = (e: PointerEvent) => SIZES[size] * scale() * (erase ? 3 : 1) * (e.pointerType === 'pen' && e.pressure ? 0.5 + e.pressure : 1);
    const down = (e: PointerEvent) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      history.current = [...history.current.slice(-19), g.getImageData(0, 0, c.width, c.height)];
      setSteps(history.current.length);
      drawing = true;
      [lx, ly] = pt(e);
      g.beginPath(); g.fillStyle = erase ? '#fff' : ink; g.arc(lx, ly, width(e) / 2, 0, Math.PI * 2); g.fill();
      setDirty(true);
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const evs = e.getCoalescedEvents?.() || [e];
      for (const ev of evs.length ? evs : [e]) {
        const [x, y] = pt(ev);
        g.strokeStyle = erase ? '#fff' : ink; g.lineWidth = width(ev); g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(lx, ly); g.lineTo(x, y); g.stroke();
        lx = x; ly = y;
      }
    };
    const up = () => { drawing = false; };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    return () => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
    };
  }, [ink, size, erase]);

  const undo = () => {
    const last = history.current.pop();
    if (last) canvas.current!.getContext('2d')!.putImageData(last, 0, 0);
    setSteps(history.current.length);
  };
  const clear = () => {
    const c = canvas.current!, g = c.getContext('2d')!;
    history.current = [...history.current.slice(-19), g.getImageData(0, 0, c.width, c.height)];
    setSteps(history.current.length);
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    setDirty(true);
  };
  const save = async () => onSave(await compressImage(canvas.current!.toDataURL('image/png'), '#fff'));

  return (
    <div className="sketch" role="dialog" aria-label="Sketch">
      <div className="sketch-bar">
        <button onClick={onCancel}>Cancel</button>
        <span className="spacer" />
        <button className="icon-btn" onClick={undo} disabled={!steps} aria-label="Undo"><Icon name="undo" /></button>
        <button onClick={clear}>Clear</button>
        <button className="primary" onClick={save} disabled={!dirty}>Save</button>
      </div>
      <canvas ref={canvas} className="sketch-canvas" />
      <div className="sketch-tools">
        {INKS.map((c) => <button key={c} className={`ink ${!erase && ink === c ? 'on' : ''}`} style={{ background: c }} aria-label="Ink color" onClick={() => { setInk(c); setErase(false); }} />)}
        <span className="sep" />
        {SIZES.map((s, i) => <button key={s} className={`size ${size === i ? 'on' : ''}`} aria-label={`Size ${i + 1}`} onClick={() => setSize(i)}><span style={{ width: s + 2, height: s + 2 }} /></button>)}
        <span className="sep" />
        <button className={`icon-btn ${erase ? 'on' : ''}`} onClick={() => setErase((x) => !x)} aria-label="Eraser"><Icon name="eraser" /></button>
      </div>
    </div>
  );
}
