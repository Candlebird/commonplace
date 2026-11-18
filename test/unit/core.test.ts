import { describe, expect, it } from 'vitest';
import { access, derive, docText, dueState, removeChecked, sinkChecked, textToDoc, toggleTask, upgradeLegacy, type Doc, type Note } from '../../src/model';
import { parseQuery, score } from '../../src/search';
import { parseCommand, parseWhen, tidyDictation } from '../../src/voice';

const item = (text: string, checked = false): Doc => ({ type: 'taskItem', attrs: { checked }, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const list = (...items: Doc[]): Doc => ({ type: 'doc', content: [{ type: 'taskList', content: items }] });
const labels = (d: Doc) => d.content![0].content!.map((i) => `${i.attrs!.checked ? 'x' : ' '}${i.content![0].content![0].text}`);

const note = (p: Partial<Note>): Note => {
  const doc = p.doc || textToDoc(p.text || '');
  return {
    id: 'n', owner: 'me@x.com', members: ['me@x.com'], editors: ['me@x.com'], shares: {}, title: '', doc, ...derive(p.title || '', doc),
    notebookId: '', pinned: false, archived: false, trashed: false, color: '', due: '', dueDone: false, photos: [], photoText: '',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', updatedBy: 'me@x.com', ...p,
  } as Note;
};

describe('checklists', () => {
  it('ticked items sink, each group keeps its order', () => {
    expect(labels(sinkChecked(list(item('a', true), item('b'), item('c', true), item('d'))))).toEqual([' b', ' d', 'xa', 'xc']);
  });
  it('ticking from a card sinks the item', () => {
    expect(labels(toggleTask(list(item('a'), item('b'), item('c')), 0))).toEqual([' b', ' c', 'xa']);
  });
  it('clear ticked removes only ticked items', () => {
    expect(labels(removeChecked(list(item('a', true), item('b'))))).toEqual([' b']);
  });
});

describe('pasted text', () => {
  it('becomes lists, headings and tags', () => {
    const d = textToDoc('# Trip\n- [ ] passport\n- [x] tickets\n* socks\n1. drive\nsee #travel');
    expect(d.content!.map((c) => c.type)).toEqual(['heading', 'taskList', 'bulletList', 'orderedList', 'paragraph']);
    expect(derive('', d).tags).toEqual(['travel']);
    expect(docText(d)).toContain('passport');
  });
});

describe('sharing', () => {
  it('merges note and notebook shares; editors are a subset of members', () => {
    const a = access('me@x.com', { 'b@x.com': 'viewer' }, { 'c@x.com': 'editor', 'b@x.com': 'editor' });
    expect(a.members.sort()).toEqual(['b@x.com', 'c@x.com', 'me@x.com']);
    expect(a.editors.sort()).toEqual(['b@x.com', 'c@x.com', 'me@x.com']);
    const v = access('me@x.com', { 'b@x.com': 'viewer' });
    expect(v.editors).toEqual(['me@x.com']);
  });
  it('v1 labels become tags', () => {
    const n = upgradeLegacy('id', { owner: 'me@x.com', body: 'hello', labels: ['work stuff'] }, '');
    expect(n.tags).toEqual(['work-stuff']);
    expect(n.members).toEqual(['me@x.com']);
  });
});

describe('search', () => {
  const n = note({ title: 'Groceries', text: '- [ ] milk\n- [x] eggs #home', pinned: true });
  it('matches words, tags and flags', () => {
    expect(score(n, parseQuery('milk'), '')).toBeGreaterThan(0);
    expect(score(n, parseQuery('#home is:pinned'), '')).toBeGreaterThan(0);
    expect(score(n, parseQuery('has:todo'), '')).toBeGreaterThan(0);
    expect(score(n, parseQuery('-milk'), '')).toBe(0);
    expect(score(n, parseQuery('#work'), '')).toBe(0);
    expect(score(n, parseQuery('in:kitchen'), 'Kitchen stuff')).toBeGreaterThan(0);
  });
});

describe('reminders', () => {
  const now = new Date(2026, 10, 17, 14, 30); // Tue 17 Nov 2026, 2:30 pm
  it('due state', () => {
    expect(dueState({ due: '2026-11-17T09:00', dueDone: false }, now)).toBe('overdue');
    expect(dueState({ due: '2026-11-17T18:00', dueDone: false }, now)).toBe('today');
    expect(dueState({ due: '2026-11-17T09:00', dueDone: true }, now)).toBe('done');
  });
  it('spoken times', () => {
    expect(parseWhen('tomorrow morning', now)).toBe('2026-11-18T09:00');
    expect(parseWhen('at 5', now)).toBe('2026-11-17T17:00');
    expect(parseWhen('at 9 am', now)).toBe('2026-11-18T09:00');
    expect(parseWhen('tomorrow at 7:30 pm', now)).toBe('2026-11-18T19:30');
    expect(parseWhen('on friday', now)).toBe('2026-11-20');
    expect(parseWhen('tonight', now)).toBe('2026-11-17T19:00');
  });
});

describe('drive mode commands', () => {
  it('understands lists, reminders and notes', () => {
    expect(parseCommand('Add eggs to my groceries list.')).toEqual({ kind: 'add', item: 'eggs', list: 'groceries' });
    expect(parseCommand("What's on the groceries list")).toEqual({ kind: 'read', list: 'groceries' });
    expect(parseCommand('Remind me to call Sam tomorrow at 5')).toEqual({ kind: 'remind', text: 'call Sam', when: 'tomorrow at 5' });
    expect(parseCommand('scratch that')).toEqual({ kind: 'undo' });
    expect(parseCommand('stop')).toEqual({ kind: 'stop' });
    expect(parseCommand('Take a note the gate code is 4417')).toEqual({ kind: 'note', text: 'the gate code is 4417' });
    expect(parseCommand('idea for the blog')).toEqual({ kind: 'unknown', text: 'idea for the blog' });
  });
  it('spoken punctuation', () => {
    expect(tidyDictation('hello comma world period new line next')).toBe('Hello, world.\nNext');
  });
});
