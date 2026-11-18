/** Speech in (browser speech recognition) and out (speech synthesis). */

interface Recognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

const Ctor = (): RecognitionCtor | undefined =>
  (window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition
  || (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition;

export const canListen = () => !!Ctor();

export interface Listener { stop: () => void }

/**
 * Listen until stopped. `onFinal` gets each finished phrase, `onInterim` the words so far.
 * With `keepAlive`, it restarts itself after pauses (phones stop listening after a few seconds of silence).
 */
export function listen(opts: {
  onFinal: (text: string) => void;
  onInterim?: (text: string) => void;
  onEnd?: (error?: string) => void;
  keepAlive?: boolean;
}): Listener {
  const C = Ctor();
  if (!C) { opts.onEnd?.('unsupported'); return { stop: () => {} }; }
  let stopped = false;
  let rec: Recognition | null = null;
  let failures = 0;
  const begin = () => {
    rec = new C();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      failures = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript;
        if (r.isFinal) { if (t.trim()) opts.onFinal(t.trim()); } else interim += t;
      }
      opts.onInterim?.(interim.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') { stopped = true; opts.onEnd?.(e.error); }
      else if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
    };
    rec.onend = () => {
      opts.onInterim?.('');
      if (!stopped && opts.keepAlive && failures < 5) { setTimeout(() => { if (!stopped) begin(); }, failures ? 600 : 150); return; }
      if (!stopped) { stopped = true; opts.onEnd?.(); }
    };
    try { rec.start(); } catch (err) { stopped = true; opts.onEnd?.(String(err)); }
  };
  begin();
  return { stop: () => { if (stopped) return; stopped = true; rec?.stop(); opts.onEnd?.(); } };
}

export function say(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = navigator.language || 'en-US';
    u.rate = 1.05;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
    setTimeout(resolve, 15000);
  });
}

/** Spoken punctuation for dictation ("new line", "comma", "period"…). */
export function tidyDictation(t: string): string {
  return t
    .replace(/\s*\b(new line|newline)\b\s*/gi, '\n')
    .replace(/\s*\bnew paragraph\b\s*/gi, '\n\n')
    .replace(/\s*\bcomma\b/gi, ',')
    .replace(/\s*\b(period|full stop)\b/gi, '.')
    .replace(/\s*\bquestion mark\b/gi, '?')
    .replace(/\s*\bexclamation (mark|point)\b/gi, '!')
    .replace(/(^|[.!?]\s+|\n)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

// ---- Drive mode commands -----------------------------------------------------------------------------

export type Command =
  | { kind: 'note'; text: string }
  | { kind: 'add'; item: string; list: string }
  | { kind: 'read'; list: string }
  | { kind: 'remind'; text: string; when: string }
  | { kind: 'undo' }
  | { kind: 'stop' }
  | { kind: 'help' }
  | { kind: 'unknown'; text: string };

const strip = (s: string) => s.trim().replace(/[.!?]+$/, '').trim();

const DAY = '(?:today|tonight|tomorrow(?: morning| afternoon| evening| night)?|this (?:morning|afternoon|evening)|(?:on |next )?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?: morning| afternoon| evening| night)?)';
const AT = '(?:at \\d{1,2}(?::\\d{2})?(?: ?[ap]\\.?m\\.?)?|\\d{1,2}(?::\\d{2})? ?[ap]\\.?m\\.?)';
const WHEN = new RegExp(`^(?:${DAY}(?: ${AT})?|${AT}(?: ${DAY})?)$`, 'i');

/** What a spoken phrase asks for. Anything that isn't a command is taken as a note. */
export function parseCommand(raw: string): Command {
  const t = strip(raw);
  const l = t.toLowerCase();
  if (/^(stop|exit|end|quit)( drive mode| listening)?$/.test(l)) return { kind: 'stop' };
  if (/^(undo|delete that|scratch that|never ?mind)$/.test(l)) return { kind: 'undo' };
  if (/^(help|what can i say)$/.test(l)) return { kind: 'help' };
  let m = t.match(/^(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+|my\s+)?(.+?)(?:\s+list)?$/i);
  if (m) return { kind: 'add', item: strip(m[1]), list: strip(m[2]) };
  m = t.match(/^(?:read|what'?s on|what is on)\s+(?:me\s+)?(?:the\s+|my\s+)?(.+?)(?:\s+list)?$/i);
  if (m) return { kind: 'read', list: strip(m[1]) };
  m = t.match(/^remind me (?:to\s+)?(.+)$/i);
  if (m) {
    // The time is the longest tail that reads as one: "call Sam | tomorrow at 5".
    const words = m[1].split(/\s+/);
    for (let i = 1; i < words.length; i++) {
      const tail = words.slice(i).join(' ');
      if (WHEN.test(tail)) return { kind: 'remind', text: strip(words.slice(0, i).join(' ')), when: tail.toLowerCase() };
    }
    return { kind: 'remind', text: strip(m[1]), when: '' };
  }
  m = t.match(/^(?:new note|take a note|note|make a note)(?:\s+that)?[\s:,]+(.+)$/i);
  if (m) return { kind: 'note', text: strip(m[1]) };
  return t ? { kind: 'unknown', text: t } : { kind: 'help' };
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** A spoken time like "tomorrow morning", "on friday", "at 5 pm" as a local reminder string. */
export function parseWhen(when: string, now = new Date()): string {
  const d = new Date(now);
  let hour: number | null = null, minute = 0;
  const at = when.match(/(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?/i);
  if (at && /at\s|\d\s*[ap]\.?m/i.test(when)) {
    hour = Number(at[1]) % 12 + (/p/i.test(at[3] || '') ? 12 : 0);
    if (!at[3] && Number(at[1]) < 8) hour += 12; // "at 5" while driving means the afternoon
    minute = Number(at[2] || 0);
  }
  if (/tomorrow/.test(when)) d.setDate(d.getDate() + 1);
  const day = DAYS.findIndex((x) => when.includes(x));
  if (day >= 0) d.setDate(d.getDate() + (((day - d.getDay() + 7) % 7) || 7));
  if (hour === null) {
    if (/morning/.test(when)) hour = 9;
    else if (/afternoon/.test(when)) hour = 14;
    else if (/evening|tonight|night/.test(when)) hour = 19;
    else if (/today/.test(when)) hour = Math.min(23, now.getHours() + 2);
  }
  // "at 9" when it's already past 9 means tomorrow.
  if (hour !== null && !/tomorrow/.test(when) && day < 0 && hour * 60 + minute <= now.getHours() * 60 + now.getMinutes()) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return hour === null ? date : `${date}T${pad(hour)}:${pad(minute)}`;
}
