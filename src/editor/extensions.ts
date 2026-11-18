import { Extension, Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import Suggestion, { type SuggestionProps, type SuggestionKeyDownProps } from '@tiptap/suggestion';

// ---- [[Note links]] --------------------------------------------------------------------------------

export interface LinkOption { id: string; label: string; create?: boolean }
export interface NoteLinkOptions {
  /** Notes matching what was typed after [[ (plus a "create" option). */
  find: (query: string) => LinkOption[];
  /** Turn a "create" option into a real note id. */
  create: (label: string) => string;
}

export const NoteLink = Node.create<NoteLinkOptions>({
  name: 'noteLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addOptions() {
    return { find: () => [], create: () => '' };
  },

  addAttributes() {
    return {
      id: { default: '', parseHTML: (el) => el.getAttribute('data-note-link') || '' },
      label: { default: '', parseHTML: (el) => el.textContent || '' },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-note-link]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['a', mergeAttributes(HTMLAttributes, { 'data-note-link': node.attrs.id, class: 'note-link', href: `#note/${node.attrs.id}` }), node.attrs.label];
  },

  renderText({ node }) {
    return `[[${node.attrs.label}]]`;
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      Suggestion<LinkOption>({
        editor: this.editor,
        char: '[[',
        allowSpaces: true,
        pluginKey: new PluginKey('noteLinkSuggest'),
        items: ({ query }) => opts.find(query),
        command: ({ editor, range, props }) => {
          const id = props.create ? opts.create(props.label) : props.id;
          if (!id) return;
          // Also eat a "]]" the person may have typed themselves.
          const after = editor.state.doc.textBetween(range.to, Math.min(range.to + 2, editor.state.doc.content.size));
          editor.chain().focus()
            .insertContentAt({ from: range.from, to: range.to + (after === ']]' ? 2 : 0) }, [{ type: 'noteLink', attrs: { id, label: props.label } }, { type: 'text', text: ' ' }])
            .run();
        },
        render: suggestionMenu,
      }),
    ];
  },
});

/** The little pop-up list under the cursor while typing [[… */
function suggestionMenu() {
  let el: HTMLDivElement | null = null;
  let items: LinkOption[] = [];
  let index = 0;
  let pick: (o: LinkOption) => void = () => {};
  const draw = () => {
    if (!el) return;
    el.innerHTML = '';
    if (!items.length) {
      const p = document.createElement('div');
      p.className = 'suggest-empty';
      p.textContent = 'Type a note title';
      el.append(p);
    }
    items.forEach((o, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'suggest-item' + (i === index ? ' on' : '');
      b.textContent = o.create ? `+ New note "${o.label}"` : o.label;
      b.onmousedown = (e) => { e.preventDefault(); pick(o); };
      el!.append(b);
    });
  };
  const place = (props: SuggestionProps<LinkOption>) => {
    const r = props.clientRect?.();
    if (!el || !r) return;
    const top = r.bottom + 6;
    el.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 288)) + 'px';
    el.style.top = (top + 240 > window.innerHeight ? Math.max(8, r.top - 246) : top) + 'px';
  };
  return {
    onStart(props: SuggestionProps<LinkOption>) {
      el = document.createElement('div');
      el.className = 'suggest';
      document.body.append(el);
      items = props.items; index = 0; pick = (o) => props.command(o);
      draw(); place(props);
    },
    onUpdate(props: SuggestionProps<LinkOption>) {
      items = props.items; index = Math.min(index, Math.max(0, items.length - 1)); pick = (o) => props.command(o);
      draw(); place(props);
    },
    onKeyDown({ event }: SuggestionKeyDownProps) {
      if (event.key === 'ArrowDown') { index = (index + 1) % Math.max(1, items.length); draw(); return true; }
      if (event.key === 'ArrowUp') { index = (index - 1 + items.length) % Math.max(1, items.length); draw(); return true; }
      if (event.key === 'Enter' || event.key === 'Tab') { if (items[index]) { pick(items[index]); return true; } return false; }
      if (event.key === 'Escape') { el?.remove(); el = null; return true; }
      return false;
    },
    onExit() { el?.remove(); el = null; },
  };
}

// ---- #tags -----------------------------------------------------------------------------------------

const TAG = /(^|[\s(])(#[\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;

function tagDecorations(doc: PMNode) {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    for (const m of node.text.matchAll(TAG)) {
      if (!/\p{L}/u.test(m[2])) continue;
      const from = pos + m.index! + m[1].length;
      decos.push(Decoration.inline(from, from + m[2].length, { class: 'hashtag', 'data-tag': m[2].slice(1).toLowerCase() }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Hashtags = Extension.create({
  name: 'hashtags',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('hashtags'),
        state: {
          init: (_, { doc }) => tagDecorations(doc),
          apply: (tr, old) => (tr.docChanged ? tagDecorations(tr.doc) : old),
        },
        props: { decorations(state) { return this.getState(state); } },
      }),
    ];
  },
});

// ---- Ticked items sink -------------------------------------------------------------------------------

const countChecked = (doc: PMNode) => {
  let k = 0;
  doc.descendants((n) => { if (n.type.name === 'taskItem' && n.attrs.checked) k++; });
  return k;
};

/** When an item is ticked or unticked, its list re-sorts: open items first, ticked ones last (each keeping its order). */
export const SinkChecked = Extension.create({
  name: 'sinkChecked',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('sinkChecked'),
        appendTransaction(trs, oldState, newState) {
          if (!trs.some((t) => t.docChanged) || countChecked(oldState.doc) === countChecked(newState.doc)) return null;
          // Ticking doesn't change sizes, so a list re-ordered in place keeps every position valid.
          if (oldState.doc.content.size !== newState.doc.content.size) return null;
          const tr = newState.tr;
          let changed = false;
          for (let guard = 0; guard < 100; guard++) {
            let target: { pos: number; node: PMNode } | null = null;
            tr.doc.descendants((node, pos) => {
              if (target) return false;
              if (node.type.name !== 'taskList') return true;
              let seenChecked = false;
              let bad = false;
              node.forEach((c) => { if (c.attrs.checked) seenChecked = true; else if (seenChecked) bad = true; });
              if (bad) { target = { pos, node }; return false; }
              return true;
            });
            if (!target) break;
            const { pos, node } = target as { pos: number; node: PMNode };
            const kids: PMNode[] = [];
            node.forEach((c) => kids.push(c));
            const sorted = [...kids.filter((c) => !c.attrs.checked), ...kids.filter((c) => c.attrs.checked)];
            tr.replaceWith(pos + 1, pos + node.nodeSize - 1, sorted);
            changed = true;
          }
          return changed ? tr.setMeta('addToHistory', true) : null;
        },
      }),
    ];
  },
});
