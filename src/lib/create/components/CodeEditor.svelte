<script lang="ts">
  import { untrack } from 'svelte';
  import { basicSetup } from 'codemirror';
  import { EditorView, keymap } from '@codemirror/view';
  import { Compartment, EditorState } from '@codemirror/state';
  import { javascript } from '@codemirror/lang-javascript';
  import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
  import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
  import { tags } from '@lezer/highlight';

  interface Props {
    value: string;
    /** Changes when the active sketch changes — forces a full document replace. */
    syncKey: string;
    onChange: (value: string) => void;
    /** Cmd/Ctrl+Enter shortcut. */
    onRun?: () => void;
    disabled?: boolean;
  }

  let { value, syncKey, onChange, onRun, disabled = false }: Props = $props();

  let host = $state<HTMLDivElement | null>(null);
  let view: EditorView | null = null;
  const editableCompartment = new Compartment();
  /** Suppresses onChange while applying a programmatic document replace. */
  let applyingExternal = false;
  let lastSyncKey = '';
  /** Always call the latest props — EditorView listeners outlive render cycles. */
  let onChangeRef: Props['onChange'] = (next) => onChange(next);
  let onRunRef: () => void = () => onRun?.();
  $effect(() => {
    onChangeRef = (next) => onChange(next);
    onRunRef = () => onRun?.();
  });

  /* Brand-aligned syntax colours: Deep Purple ink, magenta (link colour) for
     keywords, and a dark turquoise for strings so small text stays legible. */
  const brandHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: '#a21caf', fontWeight: '700' },
    { tag: tags.comment, color: '#888888', fontStyle: 'italic' },
    { tag: tags.string, color: '#0b7a6e' },
    { tag: tags.number, color: '#22113e', fontWeight: '700' },
    { tag: tags.function(tags.variableName), color: '#5b2a86' },
    { tag: tags.propertyName, color: '#22113e' },
  ]);

  function replaceDocument(next: string) {
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === next) return;
    applyingExternal = true;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next } });
    applyingExternal = false;
  }

  function mountEditor(parent: HTMLDivElement, initial: string) {
    view?.destroy();
    const state = EditorState.create({
      doc: initial,
      extensions: [
        basicSetup,
        javascript(),
        history(),
        syntaxHighlighting(brandHighlight),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        editableCompartment.of(EditorView.editable.of(!disabled)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || applyingExternal) return;
          onChangeRef(update.state.doc.toString());
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: '13px',
            backgroundColor: '#ffffff',
            color: '#22113e',
            border: '1px solid rgba(34, 17, 62, 0.18)',
            borderRadius: '4px',
          },
          '.cm-scroller': {
            fontFamily: '"Courier Prime", ui-monospace, monospace',
            lineHeight: '1.55',
          },
          '.cm-gutters': {
            backgroundColor: 'rgba(202, 216, 216, 0.35)',
            color: '#888888',
            borderRight: '1px solid rgba(34, 17, 62, 0.14)',
          },
          '&.cm-focused': {
            outline: '2px solid #22113e',
            outlineOffset: '2px',
          },
          '.cm-activeLine': {
            backgroundColor: 'rgba(8, 242, 219, 0.12)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'rgba(8, 242, 219, 0.18)',
          },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
            backgroundColor: 'rgba(234, 125, 255, 0.28) !important',
          },
          '.cm-cursor': {
            borderLeftColor: '#22113e',
          },
        }),
      ],
    });
    view = new EditorView({ state, parent });
  }

  $effect(() => {
    const parent = host;
    if (!parent) return;
    const initial = untrack(() => value);
    const key = untrack(() => syncKey);
    mountEditor(parent, initial);
    lastSyncKey = key;
    return () => {
      view?.destroy();
      view = null;
    };
  });

  $effect(() => {
    view?.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
    });
  });

  // Sketch identity changed → always replace the full document.
  $effect(() => {
    if (!view) return;
    if (syncKey === lastSyncKey) return;
    lastSyncKey = syncKey;
    replaceDocument(value);
  });

  // Same sketch, external value update (restore) → replace when different.
  $effect(() => {
    if (!view) return;
    if (syncKey !== lastSyncKey) return;
    if (view.state.doc.toString() === value) return;
    replaceDocument(value);
  });
</script>

<div class="editor" bind:this={host} role="textbox" aria-label="Sketch code editor"></div>

<style>
  .editor {
    height: 100%;
    min-height: 220px;
    overflow: hidden;
  }

  .editor :global(.cm-editor) {
    height: 100%;
  }
</style>
