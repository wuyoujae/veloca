import DOMPurify from 'dompurify';
import {
  Extension,
  InputRule,
  Mark,
  mergeAttributes,
  Node,
  textblockTypeInputRule,
  type Editor,
  type JSONContent,
  type MarkdownRendererHelpers
} from '@tiptap/core';
import { CodeBlock } from '@tiptap/extension-code-block';
import Emoji from '@tiptap/extension-emoji';
import FileHandler from '@tiptap/extension-file-handler';
import HardBreak from '@tiptap/extension-hard-break';
import Heading from '@tiptap/extension-heading';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Mathematics } from '@tiptap/extension-mathematics';
import Placeholder from '@tiptap/extension-placeholder';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Typography from '@tiptap/extension-typography';
import { Markdown } from '@tiptap/markdown';
import { liftEmptyBlock, splitBlockAs } from '@tiptap/pm/commands';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Plugin, PluginKey, TextSelection, type Transaction } from '@tiptap/pm/state';
import {
  CellSelection,
  TableMap,
  addColumn,
  addRow,
  cellAround,
  findTable,
  selectedRect
} from '@tiptap/pm/tables';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { marked } from 'marked';
import type { Mermaid, MermaidConfig } from 'mermaid';
import { createHighlighterCore, type HighlighterCore, type ThemedToken } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import bashLanguage from 'shiki/langs/bash.mjs';
import cssLanguage from 'shiki/langs/css.mjs';
import htmlLanguage from 'shiki/langs/html.mjs';
import javascriptLanguage from 'shiki/langs/javascript.mjs';
import jsonLanguage from 'shiki/langs/json.mjs';
import markdownLanguage from 'shiki/langs/markdown.mjs';
import typescriptLanguage from 'shiki/langs/typescript.mjs';
import vitesseLightTheme from 'shiki/themes/vitesse-light.mjs';

const purifier = typeof window === 'undefined' ? null : DOMPurify(window);
const mermaidCommandText = '/mermaid';
const spacedBacktickCodeBlockInputRegex = /^``` ([a-z]+)[\s\n]$/;
const tildeCodeBlockInputRegex = /^~~~([a-z]+)?[\s\n]$/;
const shikiTheme = 'vitesse-light';
const shikiCodeBlockPluginKey = new PluginKey<DecorationSet>('velocaShikiCodeBlock');
const aiProvenancePluginKey = new PluginKey('velocaAiProvenance');
const aiProvenanceInsertMeta = 'velocaAiGeneratedInsert';
const aiProvenanceAppliedMeta = 'velocaAiEditedMarkApplied';
let shikiHighlighter: HighlighterCore | null = null;
let shikiHighlighterPromise: Promise<HighlighterCore> | null = null;
let mermaidModulePromise: Promise<Mermaid> | null = null;
let mermaidRenderId = 0;

export const MEDIA_LIMITS = {
  audio: 50 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024
} as const;

type HtmlBlockAttrs = {
  html: string;
};

type MermaidBlockAttrs = {
  code: string;
};

type AiGeneratedBlockAttrs = {
  createdAt: number;
  provenanceId: string;
  sourceMessageId: string;
};

type MediaNodeAttrs = {
  allow?: string | null;
  allowfullscreen?: boolean | null;
  alt?: string | null;
  controls?: boolean | null;
  fileName?: string | null;
  height?: number | null;
  mimeType?: string | null;
  poster?: string | null;
  resolvedPoster?: string | null;
  resolvedSrc?: string | null;
  src?: string | null;
  title?: string | null;
  width?: number | null;
};

export interface RichEditorCallbacks {
  onFileDrop: (editor: Editor, files: File[], pos?: number) => void | Promise<void>;
  onPasteMediaUrl: (editor: Editor, url: string) => boolean | Promise<boolean>;
  onUpdateInlineMath: (pos: number, latex: string) => void;
  onUpdateBlockMath: (pos: number, latex: string) => void;
}

export interface WorkspaceAssetPayload {
  data: ArrayBuffer | Uint8Array;
  fileName: string;
  mimeType: string;
}

export interface WorkspaceResolvedAsset {
  assetPath: string;
  byteSize: number;
  exists: boolean;
  fileName: string;
  isExternal: boolean;
  mimeType: string;
  url: string;
}

interface FootnoteDefinition {
  content: string;
  id: string;
}

export const VelocaImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fileName: {
        default: null
      },
      mimeType: {
        default: null
      },
      resolvedSrc: {
        default: null
      }
    };
  },

  renderHTML({ HTMLAttributes }) {
    const { fileName: _fileName, mimeType: _mimeType, resolvedSrc, ...rest } = HTMLAttributes;

    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, {
        ...rest,
        src: resolvedSrc || rest.src
      })
    ];
  }
});

const VelocaCodeBlockShiki = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [
      createShikiCodeBlockPlugin(this.name),
      new Plugin({
        props: {
          handleDOMEvents: {
            click: (_view, event) => {
              const copyButton = findCodeCopyButton(event.target);

              if (!copyButton) {
                return false;
              }

              event.preventDefault();
              void copyCodeBlockToClipboard(copyButton);
              return true;
            },
            mousedown: (_view, event) => {
              const copyButton = findCodeCopyButton(event.target);

              if (!copyButton) {
                return false;
              }

              event.preventDefault();
              return true;
            }
          }
        }
      })
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const language = typeof node.attrs.language === 'string' ? node.attrs.language : null;

    return [
      'pre',
      mergeAttributes(
        this.options.HTMLAttributes,
        HTMLAttributes,
        language
          ? {
              'data-language': language
            }
          : {}
      ),
      [
        'span',
        {
          class: 'veloca-code-toolbar',
          contenteditable: 'false',
        },
        ...(language
          ? [
              [
                'span',
                {
                  class: 'veloca-code-language'
                },
                language
              ] as const
            ]
          : []),
        [
          'button',
          {
            'aria-label': 'Copy code',
            class: 'veloca-code-copy-button',
            contenteditable: 'false',
            'data-veloca-copy-code': 'true',
            tabindex: '-1',
            title: 'Copy code',
            type: 'button'
          },
          ['span', { class: 'veloca-code-copy-status' }, '⧉']
        ]
      ],
      [
        'code',
        mergeAttributes(
          language
            ? {
                class: `language-${language}`
              }
            : {}
        ),
        0
      ]
    ];
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: spacedBacktickCodeBlockInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      }),
      textblockTypeInputRule({
        find: tildeCodeBlockInputRegex,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1]
        })
      })
    ];
  },

  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      'Ctrl-a': () => selectCurrentCodeBlockContent(this.editor),
      'Mod-a': () => selectCurrentCodeBlockContent(this.editor)
    };
  }
});

function selectCurrentCodeBlockContent(editor: Editor): boolean {
  const { selection } = editor.state;
  const codeBlockDepth = findAncestorDepth(selection.$from, 'codeBlock');

  if (codeBlockDepth <= 0) {
    return false;
  }

  const codeBlock = selection.$from.node(codeBlockDepth);
  const from = selection.$from.start(codeBlockDepth);
  const to = from + codeBlock.content.size;

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
  return true;
}

function getShikiHighlighter(): Promise<HighlighterCore> {
  if (shikiHighlighter) {
    return Promise.resolve(shikiHighlighter);
  }

  shikiHighlighterPromise ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    langs: [
      htmlLanguage,
      cssLanguage,
      javascriptLanguage,
      typescriptLanguage,
      jsonLanguage,
      markdownLanguage,
      bashLanguage
    ],
    themes: [vitesseLightTheme]
  }).then((highlighter) => {
    shikiHighlighter = highlighter;
    return highlighter;
  });

  return shikiHighlighterPromise;
}

function createShikiCodeBlockPlugin(nodeName: string): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: shikiCodeBlockPluginKey,
    state: {
      init: (_, state) => createShikiDecorations(state.doc, nodeName),
      apply: (transaction, decorations) => {
        if (!transaction.docChanged && !transaction.getMeta(shikiCodeBlockPluginKey)) {
          return decorations.map(transaction.mapping, transaction.doc);
        }

        return createShikiDecorations(transaction.doc, nodeName);
      }
    },
    props: {
      decorations: (state) => shikiCodeBlockPluginKey.getState(state) ?? DecorationSet.empty
    },
    view: (view) => {
      refreshShikiDecorationsWhenReady(view);

      return {
        update: (currentView) => {
          if (!shikiHighlighter) {
            refreshShikiDecorationsWhenReady(currentView);
          }
        }
      };
    }
  });
}

function refreshShikiDecorationsWhenReady(view: EditorView): void {
  void getShikiHighlighter()
    .then(() => {
      if (view.isDestroyed) {
        return;
      }

      view.dispatch(view.state.tr.setMeta(shikiCodeBlockPluginKey, true));
    })
    .catch(() => {
      shikiHighlighterPromise = null;
    });
}

function createShikiDecorations(doc: ProseMirrorNode, nodeName: string): DecorationSet {
  const highlighter = shikiHighlighter;

  if (!highlighter) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];

  doc.descendants((node, position) => {
    if (node.type.name !== nodeName) {
      return true;
    }

    const code = node.textContent;
    const language = getSupportedShikiLanguage(node.attrs.language, highlighter);

    if (!code || !language) {
      return false;
    }

    try {
      const result = highlighter.codeToTokens(code, {
        includeExplanation: 'scopeName',
        lang: language,
        theme: shikiTheme,
        tokenizeMaxLineLength: 5000
      });

      result.tokens.flat().forEach((token) => {
        if (!token.content.length) {
          return;
        }

        decorations.push(
          Decoration.inline(position + 1 + token.offset, position + 1 + token.offset + token.content.length, {
            class: `veloca-shiki-token ${getShikiTokenClass(token)}`
          })
        );
      });
    } catch {
      return false;
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function getSupportedShikiLanguage(language: unknown, highlighter: HighlighterCore): string | null {
  if (typeof language !== 'string') {
    return null;
  }

  const normalized = language.trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  try {
    return highlighter.resolveLangAlias(normalized);
  } catch {
    return null;
  }
}

function getShikiTokenClass(token: ThemedToken): string {
  const scopes = token.explanation
    ?.flatMap((explanation) => explanation.scopes.map((scope) => scope.scopeName))
    .join(' ') ?? '';

  if (/\bcomment\b|\bquote\b/.test(scopes)) {
    return 'veloca-token-comment';
  }

  if (/\bstring\b/.test(scopes)) {
    return 'veloca-token-string';
  }

  if (/\bentity\.name\.function\b|\bsupport\.function\b/.test(scopes)) {
    return 'veloca-token-function';
  }

  if (
    /\bkeyword\b|\bstorage\.type\b|\bentity\.name\.tag\b|\bentity\.name\.type\b|\bsupport\.type\b|\bsupport\.class\b/.test(
      scopes
    )
  ) {
    return 'veloca-token-keyword';
  }

  if (/\bentity\.other\.attribute-name\b|\bmeta\.attribute\b|\bconstant\.numeric\b|\bconstant\.language\b/.test(scopes)) {
    return 'veloca-token-function';
  }

  return 'veloca-token-default';
}

function findCodeCopyButton(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const button = target.closest('[data-veloca-copy-code="true"]');
  return button instanceof HTMLElement ? button : null;
}

async function copyCodeBlockToClipboard(button: HTMLElement): Promise<void> {
  const pre = button.closest('pre');
  const codeElement = pre?.querySelector('code');
  const text = codeElement?.textContent ?? '';

  if (!text) {
    return;
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }

      showCodeCopySuccess(button);
    } catch {
      fallbackCopyText(text);
      showCodeCopySuccess(button);
    }
  }

function showCodeCopySuccess(button: HTMLElement): void {
  const status = button.querySelector('.veloca-code-copy-status');
  const resetTimer = window.setTimeout(() => {
    delete button.dataset.copied;
    delete button.dataset.copyResetTimer;
    button.setAttribute('aria-label', 'Copy code');
    button.setAttribute('title', 'Copy code');

    if (status) {
      status.textContent = '⧉';
    }
  }, 3000);
  const previousResetTimer = Number(button.dataset.copyResetTimer);

  if (Number.isFinite(previousResetTimer)) {
    window.clearTimeout(previousResetTimer);
  }

  button.dataset.copied = 'true';
  button.dataset.copyResetTimer = String(resetTimer);
  button.setAttribute('aria-label', 'Code copied');
  button.setAttribute('title', 'Code copied');

  if (status) {
    status.textContent = '✓';
  }
}

function fallbackCopyText(text: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export const AudioNode = Node.create({
  name: 'velocaAudio',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      controls: { default: true },
      fileName: { default: null },
      mimeType: { default: null },
      resolvedSrc: { default: null },
      src: { default: null },
      title: { default: null }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'audio[src]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            controls: element.hasAttribute('controls'),
            src: sanitizeUrl(element.getAttribute('src')),
            title: element.getAttribute('title')
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { fileName: _fileName, mimeType: _mimeType, resolvedSrc, ...rest } = HTMLAttributes;
    const src = resolvedSrc || rest.src;

    return [
      'audio',
      mergeAttributes({
        ...rest,
        controls: rest.controls === false ? null : 'true',
        src
      })
    ];
  },

  renderMarkdown(node) {
    const attrs = node.attrs as MediaNodeAttrs;
    return `<audio controls src="${escapeHtmlAttribute(attrs.src)}"></audio>`;
  }
});

export const VideoNode = Node.create({
  name: 'velocaVideo',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      controls: { default: true },
      fileName: { default: null },
      height: { default: null },
      mimeType: { default: null },
      poster: { default: null },
      resolvedPoster: { default: null },
      resolvedSrc: { default: null },
      src: { default: null },
      title: { default: null },
      width: { default: null }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const width = Number(element.getAttribute('width'));
          const height = Number(element.getAttribute('height'));

          return {
            controls: element.hasAttribute('controls'),
            height: Number.isFinite(height) ? height : null,
            poster: sanitizeUrl(element.getAttribute('poster')),
            src: sanitizeUrl(element.getAttribute('src')),
            title: element.getAttribute('title'),
            width: Number.isFinite(width) ? width : null
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const {
      fileName: _fileName,
      mimeType: _mimeType,
      poster,
      resolvedPoster,
      resolvedSrc,
      ...rest
    } = HTMLAttributes;

    return [
      'video',
      mergeAttributes({
        ...rest,
        controls: rest.controls === false ? null : 'true',
        poster: resolvedPoster || poster || null,
        src: resolvedSrc || rest.src
      })
    ];
  },

  renderMarkdown(node) {
    const attrs = node.attrs as MediaNodeAttrs;
    const widthAttr = attrs.width ? ` width="${attrs.width}"` : '';
    const heightAttr = attrs.height ? ` height="${attrs.height}"` : '';
    const posterAttr = attrs.poster ? ` poster="${escapeHtmlAttribute(attrs.poster)}"` : '';

    return `<video controls src="${escapeHtmlAttribute(attrs.src)}"${posterAttr}${widthAttr}${heightAttr}></video>`;
  }
});

export const IframeNode = Node.create({
  name: 'velocaIframe',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      allow: { default: null },
      allowfullscreen: { default: true },
      height: { default: 405 },
      resolvedSrc: { default: null },
      src: { default: null },
      title: { default: null },
      width: { default: 720 }
    };
  },

  parseHTML() {
    return [
      {
        tag: 'iframe[src]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          const width = Number(element.getAttribute('width'));
          const height = Number(element.getAttribute('height'));

          return {
            allow: element.getAttribute('allow'),
            allowfullscreen: element.hasAttribute('allowfullscreen'),
            height: Number.isFinite(height) ? height : 405,
            src: sanitizeUrl(element.getAttribute('src')),
            title: element.getAttribute('title'),
            width: Number.isFinite(width) ? width : 720
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { resolvedSrc, ...rest } = HTMLAttributes;

    return [
      'iframe',
      mergeAttributes({
        ...rest,
        allowfullscreen: rest.allowfullscreen ? 'true' : null,
        src: resolvedSrc || rest.src
      })
    ];
  },

  renderMarkdown(node) {
    const attrs = node.attrs as MediaNodeAttrs;
    const widthAttr = attrs.width ? ` width="${attrs.width}"` : '';
    const heightAttr = attrs.height ? ` height="${attrs.height}"` : '';
    const allowAttr = attrs.allow ? ` allow="${escapeHtmlAttribute(attrs.allow)}"` : '';
    const fullscreenAttr = attrs.allowfullscreen ? ' allowfullscreen' : '';

    return `<iframe src="${escapeHtmlAttribute(attrs.src)}"${widthAttr}${heightAttr}${allowAttr}${fullscreenAttr}></iframe>`;
  }
});

export const HtmlBlockNode = Node.create({
  name: 'velocaHtmlBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      html: {
        default: ''
      }
    } satisfies Record<keyof HtmlBlockAttrs, { default: string }>;
  },

  parseHTML() {
    return [
      {
        tag: 'details',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            html: sanitizeHtml(element.outerHTML)
          };
        }
      },
      {
        tag: 'section[data-veloca-html-block]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            html: sanitizeHtml(element.dataset.html ?? '')
          };
        }
      },
      {
        tag: 'section[data-veloca-callout]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            html: sanitizeHtml(element.outerHTML)
          };
        }
      },
      {
        tag: 'section[data-veloca-footnotes]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            html: sanitizeHtml(element.outerHTML)
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const html = sanitizeHtml((HTMLAttributes as HtmlBlockAttrs).html);

    return [
      'section',
      {
        'data-html': html,
        'data-veloca-html-block': 'true'
      }
    ];
  },

  renderMarkdown(node) {
    return sanitizeHtml((node.attrs as HtmlBlockAttrs).html);
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('section');
      dom.dataset.velocaHtmlBlock = 'true';
      dom.contentEditable = 'false';

      const render = () => {
        const html = sanitizeHtml((node.attrs as HtmlBlockAttrs).html);
        dom.className = `veloca-html-block ${getHtmlBlockVariantClass(html)}`.trim();
        dom.innerHTML = html;
      };

      render();

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'velocaHtmlBlock') {
            return false;
          }

          node = updatedNode;
          render();
          return true;
        }
      };
    };
  }
});

export const VelocaAiEditedMark = Mark.create({
  name: 'velocaAiEdited',
  inclusive: false,

  parseHTML() {
    return [
      {
        tag: 'span[data-veloca-ai-edited]'
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'veloca-ai-edited-text',
        'data-veloca-ai-edited': 'true'
      }),
      0
    ];
  },

  renderMarkdown(node, helpers) {
    return helpers.renderChildren(node);
  }
});

export const VelocaAiGeneratedMark = Mark.create({
  name: 'velocaAiGenerated',
  inclusive: false,

  parseHTML() {
    return [
      {
        tag: 'span[data-veloca-ai-generated-text]'
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        class: 'veloca-ai-generated-text',
        'data-veloca-ai-generated-text': 'true'
      }),
      0
    ];
  },

  renderMarkdown(node, helpers) {
    return helpers.renderChildren(node);
  }
});

export const VelocaAiGeneratedBlock = Node.create({
  name: 'velocaAiGeneratedBlock',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      createdAt: {
        default: 0
      },
      provenanceId: {
        default: ''
      },
      sourceMessageId: {
        default: ''
      }
    } satisfies Record<keyof AiGeneratedBlockAttrs, { default: string | number }>;
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-veloca-ai-generated]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            createdAt: Number.parseInt(element.dataset.velocaAiCreatedAt ?? '0', 10) || 0,
            provenanceId: element.dataset.velocaAiProvenanceId ?? '',
            sourceMessageId: element.dataset.velocaAiSourceMessageId ?? ''
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = HTMLAttributes as AiGeneratedBlockAttrs;

    return [
      'section',
      {
        class: 'veloca-ai-generated-block',
        'data-veloca-ai-created-at': String(attrs.createdAt ?? 0),
        'data-veloca-ai-generated': 'true',
        'data-veloca-ai-provenance-id': attrs.provenanceId ?? '',
        'data-veloca-ai-source-message-id': attrs.sourceMessageId ?? ''
      },
      0
    ];
  },

  renderMarkdown(node, helpers) {
    return helpers.renderChildren(getMarkdownNodeContent(node), '\n\n');
  }
});

function getMarkdownNodeContent(node: JSONContent | ProseMirrorNode): JSONContent[] {
  const json = getMarkdownNodeJson(node);

  return Array.isArray(json.content) ? json.content : [];
}

function getMarkdownNodeJson(node: JSONContent | ProseMirrorNode): JSONContent {
  if ('type' in node && typeof node.type === 'string') {
    return node as JSONContent;
  }

  if ('toJSON' in node && typeof node.toJSON === 'function') {
    return node.toJSON() as JSONContent;
  }

  return {};
}

export const MermaidNode = Node.create({
  name: 'velocaMermaid',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      code: {
        default: ''
      }
    } satisfies Record<keyof MermaidBlockAttrs, { default: string }>;
  },

  parseHTML() {
    return [
      {
        tag: 'section[data-veloca-mermaid]',
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) {
            return false;
          }

          return {
            code: decodeOriginalMarkdown(element.dataset.mermaidCode ?? '')
          };
        }
      }
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const code = (HTMLAttributes as MermaidBlockAttrs).code ?? '';

    return [
      'section',
      {
        class: 'veloca-mermaid-block',
        'data-mermaid-code': encodeOriginalMarkdown(code),
        'data-veloca-mermaid': 'true'
      }
    ];
  },

  renderMarkdown(node) {
    return buildMermaidMarkdown((node.attrs as MermaidBlockAttrs).code);
  },

  addNodeView() {
    return ({ node, getPos, view }) => {
      let currentNode = node;
      let editing = !(currentNode.attrs as MermaidBlockAttrs).code.trim();
      let draftCode = (currentNode.attrs as MermaidBlockAttrs).code;
      let renderVersion = 0;

      const dom = document.createElement('section');
      const header = document.createElement('div');
      const label = document.createElement('span');
      const editButton = document.createElement('button');
      const preview = document.createElement('div');
      const editorPanel = document.createElement('div');
      const textarea = document.createElement('textarea');
      const actions = document.createElement('div');
      const saveButton = document.createElement('button');
      const cancelButton = document.createElement('button');

      dom.dataset.velocaMermaid = 'true';
      dom.contentEditable = 'false';
      dom.className = 'veloca-mermaid-node';

      header.className = 'veloca-mermaid-header';
      label.className = 'veloca-mermaid-label';
      label.textContent = 'Mermaid';

      editButton.className = 'veloca-mermaid-button';
      editButton.type = 'button';

      preview.className = 'veloca-mermaid-preview';
      editorPanel.className = 'veloca-mermaid-editor-panel';
      textarea.className = 'veloca-mermaid-textarea';
      textarea.spellcheck = false;

      actions.className = 'veloca-mermaid-actions';
      saveButton.className = 'veloca-mermaid-button primary';
      saveButton.type = 'button';
      saveButton.textContent = 'Save';
      cancelButton.className = 'veloca-mermaid-button';
      cancelButton.type = 'button';
      cancelButton.textContent = 'Cancel';

      actions.append(saveButton, cancelButton);
      editorPanel.append(textarea, actions);
      header.append(label, editButton);
      dom.append(header, preview, editorPanel);

      const getCode = () => (currentNode.attrs as MermaidBlockAttrs).code ?? '';

      const setEditing = (nextEditing: boolean) => {
        editing = nextEditing;
        draftCode = getCode();
        textarea.value = draftCode;
        dom.classList.toggle('is-editing', editing);
        preview.hidden = editing;
        editorPanel.hidden = !editing;
        editButton.textContent = editing ? 'Preview' : 'Edit';

        if (editing) {
          focusMermaidTextarea(textarea);
          return;
        }

        void renderPreview();
      };

      const renderPreview = async () => {
        const code = getCode().trim();
        const version = (renderVersion += 1);

        preview.replaceChildren();

        if (!code) {
          preview.textContent = 'Click Edit to add a Mermaid diagram.';
          preview.classList.add('is-empty');
          preview.classList.remove('is-error');
          return;
        }

        preview.classList.remove('is-empty', 'is-error');
        preview.textContent = 'Rendering diagram...';

        try {
          const svg = await renderMermaidToSafeSvg(code);

          if (version !== renderVersion) {
            return;
          }

          preview.innerHTML = svg;
        } catch (error) {
          if (version !== renderVersion) {
            return;
          }

          preview.classList.add('is-error');
          preview.textContent = getMermaidErrorMessage(error);
        }
      };

      editButton.addEventListener('click', () => setEditing(!editing));
      cancelButton.addEventListener('click', () => setEditing(false));
      saveButton.addEventListener('click', () => {
        const pos = typeof getPos === 'function' ? getPos() : null;

        if (typeof pos !== 'number') {
          return;
        }

        const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
          ...currentNode.attrs,
          code: draftCode
        });
        view.dispatch(transaction);
        setEditing(false);
      });
      textarea.addEventListener('input', () => {
        draftCode = textarea.value;
      });

      setEditing(editing);

      return {
        dom,
        update(updatedNode) {
          if (updatedNode.type.name !== 'velocaMermaid') {
            return false;
          }

          const previousCode = getCode();
          currentNode = updatedNode;

          if (!editing && previousCode !== getCode()) {
            void renderPreview();
          }

          return true;
        },
        ignoreMutation: () => true,
        stopEvent: (event) => isMermaidControlEvent(event, dom)
      };
    };
  }
});

function focusMermaidTextarea(textarea: HTMLTextAreaElement): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      if (!document.contains(textarea)) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });
}

function isMermaidControlEvent(event: Event, dom: HTMLElement): boolean {
  const target = event.target;

  if (!(target instanceof globalThis.Node) || !dom.contains(target)) {
    return false;
  }

  return (
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement &&
      target.closest('.veloca-mermaid-editor-panel, .veloca-mermaid-button') !== null)
  );
}

export function insertMermaidBlockFromCommand(editor: Editor): boolean {
  const { empty, $from, $to } = editor.state.selection;
  const mermaidNodeType = editor.state.schema.nodes.velocaMermaid;
  const paragraphNodeType = editor.state.schema.nodes.paragraph;
  const command = parseMermaidCommand($from.parent.textContent);

  if (
    !empty ||
    !$from.sameParent($to) ||
    !mermaidNodeType ||
    !paragraphNodeType ||
    $from.parent.type !== paragraphNodeType ||
    !command ||
    $from.parentOffset !== $from.parent.content.size ||
    !isRootParagraphContext($from)
  ) {
    return false;
  }

  const blockStart = $from.before();
  const blockEnd = $from.after();
  const mermaidNode = mermaidNodeType.create({ code: '' });
  const paragraphNode = paragraphNodeType.create();

  const transaction = command.replaceCurrent
    ? editor.state.tr.replaceWith(blockStart, blockEnd, Fragment.fromArray([mermaidNode, paragraphNode]))
    : editor.state.tr.replaceWith(
        blockStart,
        blockEnd,
        Fragment.fromArray([
          paragraphNodeType.create(null, command.prefix ? editor.state.schema.text(command.prefix) : undefined),
          mermaidNode,
          paragraphNode
        ])
      );
  const mermaidPosition = command.replaceCurrent
    ? blockStart
    : blockStart + (paragraphNodeType.create(null, command.prefix ? editor.state.schema.text(command.prefix) : undefined).nodeSize);

  transaction.setSelection(NodeSelection.create(transaction.doc, mermaidPosition));
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}

function parseMermaidCommand(text: string): { prefix: string; replaceCurrent: boolean } | null {
  if (text.trim() === mermaidCommandText) {
    return {
      prefix: '',
      replaceCurrent: true
    };
  }

  const commandSuffix = ` ${mermaidCommandText}`;

  if (!text.endsWith(commandSuffix)) {
    return null;
  }

  const prefix = text.slice(0, -commandSuffix.length).trimEnd();

  if (!prefix) {
    return null;
  }

  return {
    prefix,
    replaceCurrent: false
  };
}

const VelocaTable = Table.extend({
  renderMarkdown(node, helpers): string {
    return renderVelocaTableToMarkdown(getMarkdownNodeJson(node), helpers);
  }
});

const VelocaHeading = Heading.extend({
  renderMarkdown(node, helpers): string {
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 1;
    const content = node.content ?? [];

    if (!content.length) {
      return '';
    }

    if (!content.some((childNode) => childNode.type === 'hardBreak')) {
      return `${'#'.repeat(level)} ${helpers.renderChildren(content)}`;
    }

    return sanitizeHtml(`<h${level}>${renderMultilineHeadingHtml(content, helpers)}</h${level}>`);
  }
});

const VelocaMermaidCommandInput = Extension.create({
  name: 'velocaMermaidCommandInput',
  priority: 1100,

  addKeyboardShortcuts() {
    const editor = this.editor;

    return {
      Enter: () => {
        if (editor.view.composing) {
          return false;
        }

        return insertMermaidBlockFromCommand(editor);
      }
    };
  }
});

const TyporaTableInput = Extension.create({
  name: 'typoraTableInput',
  priority: 1000,

  addKeyboardShortcuts() {
    const editor = this.editor;

    return {
      Enter: () => {
        if (editor.view.composing) {
          return false;
        }

        if (handleTableKeyboardInteraction(editor, 'enter')) {
          return true;
        }

        if (convertMarkdownTableHeaderToTable(editor)) {
          return true;
        }

        return false;
      },
      'Shift-Enter': () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'shift-enter');
      },
      ArrowDown: () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'arrow-down');
      },
      ArrowUp: () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'arrow-up');
      },
      'Shift-ArrowLeft': () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'column-left');
      },
      'Shift-ArrowRight': () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'column-right');
      },
      'Shift-ArrowDown': () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'row-below');
      },
      'Shift-ArrowUp': () => {
        if (editor.view.composing) {
          return false;
        }

        return handleTableKeyboardInteraction(editor, 'row-above');
      }
    };
  }
});

const VelocaWritingBehavior = Extension.create({
  name: 'velocaWritingBehavior',
  priority: 900,

  addKeyboardShortcuts() {
    const editor = this.editor;

    return {
      Enter: () => {
        if (editor.view.composing) {
          return false;
        }

        if (exitHeadingToParagraph(editor)) {
          return true;
        }

        return exitEmptyBlockquote(editor);
      },
      Backspace: () => {
        if (editor.view.composing) {
          return false;
        }

        if (convertHeadingToParagraph(editor)) {
          return true;
        }

        return exitEmptyBlockquote(editor, true);
      }
    };
  }
});

function createAiProvenancePlugin() {
  return new Plugin({
    key: aiProvenancePluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (
        transactions.some(
          (transaction) =>
            transaction.getMeta(aiProvenanceInsertMeta) || transaction.getMeta(aiProvenanceAppliedMeta)
        )
      ) {
        return null;
      }

      const editedMark = newState.schema.marks.velocaAiEdited;
      const generatedMark = newState.schema.marks.velocaAiGenerated;

      if (!editedMark) {
        return null;
      }

      const ranges = getInsertedTransactionRanges(transactions);

      if (!ranges.length) {
        return null;
      }

      const transaction = newState.tr;
      let changed = false;

      for (const range of ranges) {
        const from = Math.max(0, Math.min(range.from, newState.doc.content.size));
        const to = Math.max(from, Math.min(range.to, newState.doc.content.size));

        if (to <= from || !rangeTouchesAiGeneratedBlock(newState.doc, from, to)) {
          continue;
        }

        newState.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isText) {
            return true;
          }

          const markFrom = Math.max(from, pos);
          const markTo = Math.min(to, pos + node.nodeSize);
          const parent = newState.doc.resolve(pos).parent;

          if (
            markTo <= markFrom ||
            !parent.type.allowsMarkType(editedMark) ||
            node.marks.some((mark) => mark.type === editedMark)
          ) {
            return false;
          }

          if (generatedMark) {
            transaction.removeMark(markFrom, markTo, generatedMark);
          }

          transaction.addMark(markFrom, markTo, editedMark.create());
          changed = true;
          return false;
        });
      }

      return changed ? transaction.setMeta(aiProvenanceAppliedMeta, true) : null;
    }
  });
}

function getInsertedTransactionRanges(transactions: readonly Transaction[]): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = [];

  for (const transaction of transactions) {
    transaction.mapping.maps.forEach((map, index) => {
      map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
        if (newEnd <= newStart) {
          return;
        }

        const remainingMapping = transaction.mapping.slice(index + 1);
        ranges.push({
          from: remainingMapping.map(newStart, 1),
          to: remainingMapping.map(newEnd, -1)
        });
      });
    });
  }

  return ranges;
}

function rangeTouchesAiGeneratedBlock(doc: ProseMirrorNode, from: number, to: number): boolean {
  let touchesAiBlock = false;

  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'velocaAiGeneratedBlock') {
      touchesAiBlock = true;
      return false;
    }

    return !touchesAiBlock;
  });

  if (touchesAiBlock) {
    return true;
  }

  const safePos = Math.max(0, Math.min(from, doc.content.size));
  const resolvedPos = doc.resolve(safePos);

  for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
    if (resolvedPos.node(depth).type.name === 'velocaAiGeneratedBlock') {
      return true;
    }
  }

  return false;
}

const VelocaAiProvenance = Extension.create({
  name: 'velocaAiProvenance',
  priority: 1200,

  addProseMirrorPlugins() {
    return [createAiProvenancePlugin()];
  }
});

const VelocaHardBreak = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.setHardBreak(),
      'Shift-Enter': () => {
        if (getActiveTableContext(this.editor)) {
          return false;
        }

        return this.editor.commands.setHardBreak();
      }
    };
  }
});

const VelocaMarkdownInput = Extension.create({
  name: 'velocaMarkdownInput',
  priority: 950,

  addInputRules() {
    return [
      new InputRule({
        find: /^\[([ xX])\]\s$/,
        handler: ({ state, range, match }) => {
          applyTaskListShortcut(state, range, match[1].toLowerCase() === 'x');
        }
      }),
      new InputRule({
        find: /(?<!\!)\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)$/,
        handler: ({ state, range, match }) => {
          applyMarkdownLinkShortcut(state, range, match[1], match[2], match[3] ?? null);
        }
      }),
      new InputRule({
        find: /(?<!\$)\$\$([^$\n]+)\$\$(?!\$)$/,
        handler: ({ state, range, match }) => {
          applyInlineBlockMathShortcut(state, range, match[1]);
        }
      }),
      new InputRule({
        find: /(?<!\$)\$([^$\n]+)\$(?!\$)$/,
        handler: ({ state, range, match }) => {
          applyInlineMathShortcut(state, range, match[1]);
        }
      })
    ];
  },

  addKeyboardShortcuts() {
    const editor = this.editor;

    return {
      Enter: () => {
        if (editor.view.composing) {
          return false;
        }

        if (convertDelimitedBlockMath(editor)) {
          return true;
        }

        if (finalizeCalloutOnExit(editor)) {
          return true;
        }

        return normalizeFootnotesOnBlankLine(editor);
      }
    };
  }
});

export function createRichEditorExtensions(callbacks: RichEditorCallbacks) {
  return [
    StarterKit.configure({
      codeBlock: false,
      gapcursor: false,
      hardBreak: false,
      heading: false
    }),
    VelocaHeading.configure({
      levels: [1, 2, 3, 4, 5, 6]
    }),
    Markdown.configure({
      markedOptions: {
        breaks: false,
        gfm: true
      }
    }),
    Placeholder.configure({
      placeholder: 'Start writing in Markdown...'
    }),
    VelocaAiGeneratedBlock,
    VelocaAiGeneratedMark,
    VelocaAiEditedMark,
    VelocaAiProvenance,
    MermaidNode,
    VelocaCodeBlockShiki.configure({
      HTMLAttributes: {
        class: 'veloca-code-block'
      }
    }),
    Highlight,
    VelocaMarkdownInput,
    Link.configure({
      autolink: true,
      defaultProtocol: 'https',
      HTMLAttributes: {
        rel: 'noreferrer noopener',
        target: '_blank'
      },
      openOnClick: true
    }),
    Subscript,
    Superscript,
    Typography,
    TaskList,
    TaskItem.configure({
      nested: true
    }),
    VelocaMermaidCommandInput,
    TyporaTableInput,
    VelocaWritingBehavior,
    VelocaHardBreak,
    VelocaTable.configure({
      cellMinWidth: 160,
      resizable: false,
      renderWrapper: true
    }),
    TableRow,
    TableHeader,
    TableCell,
    VelocaImage.configure({
      HTMLAttributes: {
        class: 'veloca-image'
      }
    }),
    FileHandler.configure({
      onDrop(editor, files, pos) {
        void callbacks.onFileDrop(editor, files, pos);
      },
      onPaste(editor, files, pasteContent) {
        if (files.length > 0) {
          void callbacks.onFileDrop(editor, files);
          return;
        }

        const pastedUrl = extractFirstMediaUrl(pasteContent);

        if (pastedUrl) {
          void callbacks.onPasteMediaUrl(editor, pastedUrl);
        }
      }
    }),
    Emoji,
    Mathematics.configure({
      blockOptions: {
        onClick(node, pos) {
          const nextLatex = window.prompt('Edit block formula', node.attrs.latex);

          if (typeof nextLatex === 'string' && nextLatex.trim()) {
            callbacks.onUpdateBlockMath(pos, nextLatex.trim());
          }
        }
      },
      inlineOptions: {
        onClick(node, pos) {
          const nextLatex = window.prompt('Edit formula', node.attrs.latex);

          if (typeof nextLatex === 'string' && nextLatex.trim()) {
            callbacks.onUpdateInlineMath(pos, nextLatex.trim());
          }
        }
      },
      katexOptions: {
        throwOnError: false
      }
    }),
    AudioNode,
    VideoNode,
    IframeNode,
    HtmlBlockNode
  ];
}

export async function hydrateDocumentAssets(
  editor: Editor,
  documentPath: string,
  resolveAsset: (documentPath: string, assetPath: string) => Promise<WorkspaceResolvedAsset>
): Promise<void> {
  const updates: Array<{ attrs: Record<string, unknown>; pos: number }> = [];
  const pending: Promise<void>[] = [];

  editor.state.doc.descendants((node, pos) => {
    if (!node.attrs || typeof node.attrs.src !== 'string') {
      return;
    }

    const source = node.attrs.src as string;

    if (!shouldResolveAssetSource(source)) {
      return;
    }

    pending.push(
      resolveAsset(documentPath, source)
        .then((asset) => {
          const attrs = { ...node.attrs, fileName: asset.fileName, mimeType: asset.mimeType, resolvedSrc: asset.url };

          if (typeof node.attrs.poster === 'string' && shouldResolveAssetSource(node.attrs.poster)) {
            return resolveAsset(documentPath, node.attrs.poster).then((posterAsset) => {
              updates.push({
                attrs: { ...attrs, resolvedPoster: posterAsset.url },
                pos
              });
            });
          }

          updates.push({ attrs, pos });
        })
        .catch(() => undefined)
    );
  });

  await Promise.all(pending);

  if (!updates.length) {
    return;
  }

  const transaction = editor.state.tr;

  updates.forEach(({ attrs, pos }) => {
    const currentNode = transaction.doc.nodeAt(pos);

    if (currentNode) {
      transaction.setNodeMarkup(pos, undefined, attrs);
    }
  });

  if (transaction.docChanged) {
    editor.view.dispatch(transaction);
  }
}

export function buildMediaInsertContent(asset: WorkspaceResolvedAsset, altText = '') {
  if (asset.mimeType.startsWith('image/')) {
    return {
      attrs: {
        alt: altText || asset.fileName,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        resolvedSrc: asset.url,
        src: asset.assetPath,
        title: asset.fileName
      },
      type: 'image'
    };
  }

  if (asset.mimeType.startsWith('audio/')) {
    return {
      attrs: {
        controls: true,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        resolvedSrc: asset.url,
        src: asset.assetPath,
        title: asset.fileName
      },
      type: 'velocaAudio'
    };
  }

  return {
    attrs: {
      controls: true,
      fileName: asset.fileName,
      height: null,
      mimeType: asset.mimeType,
      resolvedSrc: asset.url,
      src: asset.assetPath,
      title: asset.fileName,
      width: null
    },
    type: 'velocaVideo'
  };
}

export function buildMediaNodeFromUrl(url: string) {
  if (isYouTubeUrl(url)) {
    return {
      attrs: {
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: true,
        height: 405,
        resolvedSrc: buildYoutubeEmbedUrl(url),
        src: buildYoutubeEmbedUrl(url),
        title: 'YouTube video',
        width: 720
      },
      type: 'velocaIframe'
    };
  }

  if (isImageUrl(url)) {
    return {
      attrs: {
        alt: getUrlFileName(url),
        resolvedSrc: url,
        src: url,
        title: getUrlFileName(url)
      },
      type: 'image'
    };
  }

  if (isAudioUrl(url)) {
    return {
      attrs: {
        controls: true,
        resolvedSrc: url,
        src: url,
        title: getUrlFileName(url)
      },
      type: 'velocaAudio'
    };
  }

  if (isVideoUrl(url)) {
    return {
      attrs: {
        controls: true,
        resolvedSrc: url,
        src: url,
        title: getUrlFileName(url)
      },
      type: 'velocaVideo'
    };
  }

  return null;
}

export function buildHtmlBlockContent(html: string) {
  return {
    attrs: {
      html: sanitizeHtml(html)
    },
    type: 'velocaHtmlBlock'
  };
}

export function extractFirstMediaUrl(value?: string): string | null {
  if (!value) {
    return null;
  }

  const urlMatch = value.match(/https?:\/\/[^\s"'<>]+/i);

  return urlMatch?.[0] ?? null;
}

export function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

export function isImageUrl(url: string): boolean {
  return /\.(gif|jpe?g|png|svg|webp)$/i.test(url);
}

export function isAudioUrl(url: string): boolean {
  return /\.(m4a|mp3|ogg|wav|webm)$/i.test(url);
}

export function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v|ogg|ogv|webm)$/i.test(url);
}

export function shouldResolveAssetSource(source?: string | null): boolean {
  if (!source) {
    return false;
  }

  return !/^(blob:|data:|https?:\/\/|veloca-asset:\/\/)/i.test(source);
}

export function sanitizeHtml(html: string): string {
  if (!purifier) {
    return html;
  }

  return purifier.sanitize(html, {
    ADD_ATTR: [
      'allow',
      'allowfullscreen',
      'class',
      'controls',
      'data-callout-type',
      'data-mermaid-code',
      'data-veloca-ai-created-at',
      'data-veloca-ai-edited',
      'data-veloca-ai-generated',
      'data-veloca-ai-generated-text',
      'data-veloca-ai-provenance-id',
      'data-veloca-ai-source-message-id',
      'data-veloca-callout',
      'data-veloca-footnotes',
      'data-veloca-html-block',
      'data-veloca-mermaid',
      'data-veloca-original-markdown',
      'href',
      'id',
      'poster',
      'src',
      'title'
    ],
    ADD_TAGS: ['audio', 'details', 'iframe', 'section', 'source', 'summary', 'video'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
    FORBID_TAGS: ['script']
  });
}

export function transformMarkdownForEditor(content: string): string {
  return transformFootnotesForEditor(transformMermaidForEditor(transformCalloutsForEditor(content)));
}

export function transformMarkdownFromEditor(content: string): string {
  return restoreFootnotesFromEditor(restoreMermaidFromEditor(restoreCalloutsFromEditor(content)));
}

export function renderMarkdownToSafeHtml(content: string): string {
  return sanitizeHtml(renderMarkdownHtml(transformMarkdownForEditor(content)));
}

export function getEditorMarkdown(editor: Editor): string {
  const json = unwrapVelocaInternalNodes(editor.state.doc.toJSON() as JSONContent);
  const content = Array.isArray(json.content) ? json.content : [];

  return editor.markdown?.serialize(content as unknown as JSONContent) ?? editor.getMarkdown();
}

function unwrapVelocaInternalNodes(node: JSONContent): JSONContent {
  const content = node.content?.flatMap((child) => {
    const nextChild = unwrapVelocaInternalNodes(child);

    if (nextChild.type === 'velocaAiGeneratedBlock') {
      return nextChild.content ?? [];
    }

    return [nextChild];
  });

  const marks = node.marks?.filter((mark) => mark.type !== 'velocaAiGenerated' && mark.type !== 'velocaAiEdited');

  return {
    ...node,
    ...(content ? { content } : {}),
    ...(marks ? { marks } : {})
  };
}

export function insertAiGeneratedMarkdown(editor: Editor, markdown: string, sourceMessageId: string): boolean {
  if (!markdown.trim() || !editor.markdown) {
    console.info('[Veloca AI Insert] rich insert aborted before parse', {
      hasMarkdownManager: Boolean(editor.markdown),
      markdownLength: markdown.length,
      sourceMessageId
    });
    return false;
  }

  const parsed = editor.markdown.parse(transformMarkdownForEditor(markdown));
  const content = parsed.content?.length ? parsed.content : [{ type: 'paragraph' }];
  const provenanceId = `ai-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    return editor
      .chain()
      .focus()
      .insertContent(
        {
          type: 'velocaAiGeneratedBlock',
          attrs: {
            createdAt: Date.now(),
            provenanceId,
            sourceMessageId
          },
          content
        },
        {
          updateSelection: true
        }
      )
      .setMeta(aiProvenanceInsertMeta, true)
      .run();
  } catch (error) {
    console.info('[Veloca AI Insert] rich insert attempt threw', {
      error: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

export async function renderMermaidToSafeSvg(code: string): Promise<string> {
  if (!code.trim()) {
    return '';
  }

  const mermaid = await loadMermaid();
  mermaid.initialize(getMermaidConfig());

  const result = await mermaid.render(`veloca-mermaid-${Date.now()}-${mermaidRenderId += 1}`, code);
  return sanitizeMermaidSvg(result.svg);
}

export function hydrateMermaidBlocks(root: ParentNode): void {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('section[data-veloca-mermaid="true"]'));

  blocks.forEach((block) => {
    if (block.dataset.mermaidHydrated === 'true') {
      return;
    }

    const code = block.querySelector('code')?.textContent ?? decodeOriginalMarkdown(block.dataset.mermaidCode ?? '');

    block.dataset.mermaidHydrated = 'true';
    block.classList.add('veloca-mermaid-agent-block');
    block.replaceChildren(buildMermaidStatusElement('Rendering diagram...'));

    void renderMermaidToSafeSvg(code)
      .then((svg) => {
        block.innerHTML = svg;
      })
      .catch((error) => {
        const source = document.createElement('pre');
        const codeElement = document.createElement('code');

        block.replaceChildren(buildMermaidStatusElement(getMermaidErrorMessage(error), true), source);
        codeElement.textContent = code;
        source.append(codeElement);
      });
  });
}

function buildMermaidStatusElement(message: string, isError = false): HTMLElement {
  const element = document.createElement('div');
  element.className = isError ? 'veloca-mermaid-status is-error' : 'veloca-mermaid-status';
  element.textContent = message;
  return element;
}

async function loadMermaid(): Promise<Mermaid> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid').then((module) => module.default);
  }

  return mermaidModulePromise;
}

function getMermaidConfig(): MermaidConfig {
  const theme = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';

  return {
    flowchart: {
      htmlLabels: false
    },
    securityLevel: 'strict',
    startOnLoad: false,
    theme,
    themeVariables: {
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }
  };
}

function sanitizeMermaidSvg(svg: string): string {
  if (!purifier) {
    return svg;
  }

  return purifier.sanitize(svg, {
    ADD_ATTR: ['aria-roledescription', 'class', 'role', 'style', 'viewBox', 'xmlns'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
    FORBID_TAGS: ['foreignObject', 'script'],
    USE_PROFILES: {
      svg: true,
      svgFilters: true
    }
  });
}

function getMermaidErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `Mermaid render failed: ${error.message}`;
  }

  return 'Mermaid render failed. Check the diagram syntax.';
}

function transformMermaidForEditor(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index].match(/^( {0,3})(```|~~~)mermaid[ \t]*$/i);

    if (!opening) {
      output.push(lines[index]);
      continue;
    }

    const fence = opening[2];
    const blockLines = [lines[index]];
    const codeLines: string[] = [];
    let nextIndex = index + 1;
    let closed = false;

    while (nextIndex < lines.length) {
      const line = lines[nextIndex];

      if (new RegExp(`^ {0,3}${escapeRegExp(fence)}[ \\t]*$`).test(line)) {
        blockLines.push(line);
        closed = true;
        break;
      }

      blockLines.push(line);
      codeLines.push(line);
      nextIndex += 1;
    }

    if (!closed) {
      output.push(...blockLines);
      index = nextIndex - 1;
      continue;
    }

    output.push(renderMermaidHtmlBlock(codeLines.join('\n'), blockLines.join('\n')));
    index = nextIndex;
  }

  return output.join('\n');
}

function restoreMermaidFromEditor(content: string): string {
  return content.replace(
    /<section\b[^>]*data-veloca-mermaid="true"[^>]*data-mermaid-code="([^"]*)"[^>]*>[\s\S]*?<\/section>/gi,
    (_match, encodedCode: string) => buildMermaidMarkdown(decodeOriginalMarkdown(encodedCode))
  );
}

function renderMermaidHtmlBlock(code: string, originalMarkdown?: string): string {
  const markdown = originalMarkdown ?? buildMermaidMarkdown(code);

  return [
    `<section class="veloca-mermaid-block" data-veloca-mermaid="true" data-mermaid-code="${encodeOriginalMarkdown(code)}" data-veloca-original-markdown="${encodeOriginalMarkdown(markdown)}">`,
    '<pre><code class="language-mermaid">',
    escapeHtmlText(code),
    '</code></pre>',
    '</section>'
  ].join('');
}

function buildMermaidMarkdown(code: string): string {
  return ['```mermaid', code.trimEnd(), '```'].join('\n');
}

const CALLOUT_OPENING_LINE_REGEXP = /^\s*>+\s*\[!([A-Z0-9_-]+)\]\s*(.*)$/i;
const CALLOUT_CONTINUATION_PREFIX_REGEXP = /^\s*>+\s?/;

function parseCalloutOpeningLine(line: string): {
  rawTitle: string;
  type: string;
} | null {
  const match = line.match(CALLOUT_OPENING_LINE_REGEXP);

  if (!match) {
    return null;
  }

  return {
    rawTitle: match[2] ?? '',
    type: match[1]
  };
}

function stripCalloutLinePrefix(line: string): string {
  return line.replace(CALLOUT_CONTINUATION_PREFIX_REGEXP, '');
}

function transformCalloutsForEditor(content: string): string {
  const lines = content.split('\n');
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = parseCalloutOpeningLine(line);

    if (!matched) {
      output.push(line);
      continue;
    }

    const blockLines = [line];
    let nextIndex = index + 1;

    while (nextIndex < lines.length && CALLOUT_CONTINUATION_PREFIX_REGEXP.test(lines[nextIndex])) {
      blockLines.push(lines[nextIndex]);
      nextIndex += 1;
    }

    output.push(renderCalloutHtml(blockLines, matched.type, matched.rawTitle));
    index = nextIndex - 1;
  }

  return output.join('\n');
}

function renderCalloutHtml(lines: string[], type: string, rawTitle: string): string {
  const originalMarkdown = lines.join('\n');
  const normalizedType = type.trim().toLowerCase();
  const bodyLines = lines.slice(1).map((line) => stripCalloutLinePrefix(line));
  const bodyMarkdown = bodyLines.join('\n').trim();
  const title = rawTitle.trim() || formatCalloutTitle(normalizedType);
  const titleHtml = renderMarkdownHtml(title, true).trim();
  const bodyHtml = bodyMarkdown
    ? renderMarkdownHtml(bodyMarkdown).trim()
    : '<p class="callout-content"></p>';

  return [
    `<section class="callout" data-callout-type="${escapeHtmlAttribute(normalizedType)}" data-veloca-callout="true" data-veloca-original-markdown="${encodeOriginalMarkdown(originalMarkdown)}">`,
    `<div class="callout-title">${titleHtml}</div>`,
    `<div class="callout-body">${bodyHtml}</div>`,
    '</section>'
  ].join('');
}

function restoreCalloutsFromEditor(content: string): string {
  return content.replace(
    /<section\b[^>]*data-veloca-callout="true"[^>]*data-veloca-original-markdown="([^"]+)"[^>]*>[\s\S]*?<\/section>/gi,
    (_match, encodedMarkdown: string) => decodeOriginalMarkdown(encodedMarkdown)
  );
}

function transformFootnotesForEditor(content: string): string {
  const extracted = extractFootnoteDefinitions(content);

  if (!extracted.definitions.length) {
    return content;
  }

  const footnoteIndex = new Map<string, number>();

  extracted.definitions.forEach((definition, index) => {
    footnoteIndex.set(definition.id, index + 1);
  });

  const contentWithReferences = extracted.content.replace(/\[\^([^\]\n]+)\]/g, (match, id: string, offset: number, input) => {
    const preceding = input.slice(Math.max(0, offset - 1), offset);

    if (preceding === '[') {
      return match;
    }

    const index = footnoteIndex.get(id);

    if (!index) {
      return match;
    }

    return `[${index}](#veloca-fn-${slugifyFootnoteId(id)})`;
  });

  return `${contentWithReferences.trimEnd()}\n\n${renderFootnotesHtml(extracted.definitions)}`;
}

function restoreFootnotesFromEditor(content: string): string {
  const contentWithReferences = content.replace(
    /\[(\d+)\]\(#veloca-fn-([^)]+)\)/g,
    (_match, _index: string, slug: string) => `[^${unslugifyFootnoteId(slug)}]`
  );

  return contentWithReferences.replace(
    /<section\b[^>]*data-veloca-footnotes="true"[^>]*data-veloca-original-markdown="([^"]+)"[^>]*>[\s\S]*?<\/section>/gi,
    (_match, encodedMarkdown: string) => `\n\n${decodeOriginalMarkdown(encodedMarkdown)}`
  );
}

function extractFootnoteDefinitions(content: string): {
  content: string;
  definitions: FootnoteDefinition[];
} {
  const lines = content.split('\n');
  const output: string[] = [];
  const definitions: FootnoteDefinition[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const matched = line.match(/^\[\^([^\]]+)\]:\s?(.*)$/);

    if (!matched) {
      output.push(line);
      continue;
    }

    const id = matched[1];
    const definitionLines = [matched[2]];
    let nextIndex = index + 1;

    while (nextIndex < lines.length) {
      const nextLine = lines[nextIndex];

      if (/^( {2,}|\t)/.test(nextLine)) {
        definitionLines.push(nextLine.replace(/^( {2,}|\t)/, ''));
        nextIndex += 1;
        continue;
      }

      if (nextLine.trim() === '') {
        definitionLines.push('');
        nextIndex += 1;
        continue;
      }

      break;
    }

    definitions.push({
      content: definitionLines.join('\n').trim(),
      id
    });
    index = nextIndex - 1;
  }

  return {
    content: output.join('\n').replace(/\n{3,}/g, '\n\n'),
    definitions
  };
}

function renderFootnotesHtml(definitions: FootnoteDefinition[]): string {
  const originalMarkdown = definitions
    .map((definition) => `[^${definition.id}]: ${definition.content.replace(/\n/g, '\n  ')}`)
    .join('\n');
  const items = definitions
    .map((definition) => {
      const html = renderMarkdownHtml(definition.content).trim();
      const body = stripSingleParagraphWrapper(html);

      return [
        `<li id="veloca-fn-${slugifyFootnoteId(definition.id)}">`,
        `${body} <a href="#veloca-fnref-${slugifyFootnoteId(definition.id)}">↩</a>`,
        '</li>'
      ].join('');
    })
    .join('');

  return [
    `<section class="footnotes" data-veloca-footnotes="true" data-veloca-original-markdown="${encodeOriginalMarkdown(originalMarkdown)}">`,
    '<ol>',
    items,
    '</ol>',
    '</section>'
  ].join('');
}

function stripSingleParagraphWrapper(html: string): string {
  const matched = html.match(/^<p>([\s\S]*)<\/p>$/i);

  return matched ? matched[1] : html;
}

function formatCalloutTitle(type: string): string {
  return type
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function renderMarkdownHtml(value: string, inline = false): string {
  const rendered = inline
    ? marked.parseInline(value, { gfm: true, breaks: false })
    : marked.parse(value, { gfm: true, breaks: false });

  return typeof rendered === 'string' ? rendered : value;
}

function slugifyFootnoteId(id: string): string {
  return encodeURIComponent(id);
}

function unslugifyFootnoteId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

function encodeOriginalMarkdown(value: string): string {
  return escapeHtmlAttribute(encodeURIComponent(value));
}

function decodeOriginalMarkdown(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function applyTaskListShortcut(
  state: Editor['state'],
  _range: { from: number; to: number },
  checked: boolean
): void {
  const { selection, schema, tr } = state;
  const { $from } = selection;
  const taskList = schema.nodes.taskList;
  const taskItem = schema.nodes.taskItem;

  if (!selection.empty || !taskList || !taskItem || $from.parent.type.name !== 'paragraph') {
    return;
  }

  const listItemDepth = findAncestorDepth($from, 'listItem');
  const bulletListDepth = findAncestorDepth($from, 'bulletList');

  if (listItemDepth > 0 && bulletListDepth === listItemDepth - 1) {
    const bulletListNode = $from.node(bulletListDepth);
    const bulletListPos = $from.before(bulletListDepth);
    const listItemIndex = $from.index(bulletListDepth);
    const currentListItem = bulletListNode.child(listItemIndex);
    const replacementNodes: ProseMirrorNode[] = [];
    const beforeItems: ProseMirrorNode[] = [];
    const afterItems: ProseMirrorNode[] = [];

    for (let index = 0; index < listItemIndex; index += 1) {
      beforeItems.push(bulletListNode.child(index));
    }

    for (let index = listItemIndex + 1; index < bulletListNode.childCount; index += 1) {
      afterItems.push(bulletListNode.child(index));
    }

    if (beforeItems.length) {
      replacementNodes.push(schema.nodes.bulletList.create(bulletListNode.attrs, beforeItems));
    }

    replacementNodes.push(taskList.create(null, [buildTaskItemFromListItem(schema, currentListItem, checked)]));

    if (afterItems.length) {
      replacementNodes.push(schema.nodes.bulletList.create(bulletListNode.attrs, afterItems));
    }

    const taskListPos = bulletListPos + (beforeItems.length ? replacementNodes[0].nodeSize : 0);

    tr.replaceWith(
      bulletListPos,
      bulletListPos + bulletListNode.nodeSize,
      Fragment.fromArray(replacementNodes)
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve(taskListPos + 3), 1));
    return;
  }

  if (!isRootParagraphContext($from)) {
    return;
  }

  const paragraphPos = $from.before();
  const nextTaskList = taskList.create(null, [
    taskItem.create({ checked }, [schema.nodes.paragraph.create()])
  ]);

  tr.replaceWith(paragraphPos, paragraphPos + $from.parent.nodeSize, nextTaskList);
  tr.setSelection(TextSelection.near(tr.doc.resolve(paragraphPos + 3), 1));
}

function applyMarkdownLinkShortcut(
  state: Editor['state'],
  range: { from: number; to: number },
  label: string,
  href: string,
  title: string | null
): void {
  const link = state.schema.marks.link;
  const normalizedLabel = label.trim();

  if (!link || !normalizedLabel) {
    return;
  }

  const nextHref = normalizeLinkHref(href);
  const transaction = state.tr.replaceWith(
    range.from,
    range.to,
    state.schema.text(
      normalizedLabel,
      [link.create({ href: nextHref, title })]
    )
  );

  transaction.setSelection(TextSelection.create(transaction.doc, range.from + normalizedLabel.length));
}

function applyInlineMathShortcut(
  state: Editor['state'],
  range: { from: number; to: number },
  latex: string
): void {
  const inlineMath = state.schema.nodes.inlineMath;
  const nextLatex = latex.trim();

  if (!inlineMath || !nextLatex) {
    return;
  }

  const transaction = state.tr.replaceWith(range.from, range.to, inlineMath.create({ latex: nextLatex }));
  transaction.setSelection(TextSelection.near(transaction.doc.resolve(range.from + 1), 1));
}

function applyInlineBlockMathShortcut(
  state: Editor['state'],
  _range: { from: number; to: number },
  latex: string
): void {
  const { selection, schema, tr } = state;
  const { $from } = selection;
  const blockMath = schema.nodes.blockMath;
  const nextLatex = latex.trim();

  if (!blockMath || !nextLatex || $from.parent.type.name !== 'paragraph' || !isRootParagraphContext($from)) {
    return;
  }

  const paragraphPos = $from.before();
  const paragraph = schema.nodes.paragraph.create();
  const blockMathNode = blockMath.create({ latex: nextLatex });

  tr.replaceWith(
    paragraphPos,
    paragraphPos + $from.parent.nodeSize,
    Fragment.fromArray([blockMathNode, paragraph])
  );
  tr.setSelection(TextSelection.create(tr.doc, paragraphPos + blockMathNode.nodeSize + 1));
}

function convertDelimitedBlockMath(editor: Editor): boolean {
  const { selection, doc, schema } = editor.state;
  const { $from } = selection;
  const blockMath = schema.nodes.blockMath;

  if (
    !selection.empty ||
    !blockMath ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parent.textContent.trim() !== '$$' ||
    $from.parentOffset !== $from.parent.content.size ||
    !isRootParagraphContext($from)
  ) {
    return false;
  }

  const currentIndex = $from.index(0);
  const formulaNodes: ProseMirrorNode[] = [];
  let openingIndex = -1;

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const node = doc.child(index);

    if (node.type.name !== 'paragraph') {
      return false;
    }

    if (node.textContent.trim() === '$$') {
      openingIndex = index;
      break;
    }

    formulaNodes.unshift(node);
  }

  if (openingIndex === -1 || !formulaNodes.length) {
    return false;
  }

  const latex = formulaNodes.map((node) => node.textContent).join('\n').trim();

  if (!latex) {
    return false;
  }

  const startPos = getTopLevelNodePos(doc, openingIndex);
  const endPos = getTopLevelNodePos(doc, currentIndex) + doc.child(currentIndex).nodeSize;
  const blockMathNode = blockMath.create({ latex });
  const paragraph = schema.nodes.paragraph.create();
  const transaction = editor.state.tr.replaceWith(
    startPos,
    endPos,
    Fragment.fromArray([blockMathNode, paragraph])
  );

  transaction.setSelection(TextSelection.create(transaction.doc, startPos + blockMathNode.nodeSize + 1));
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

function finalizeCalloutOnExit(editor: Editor): boolean {
  const { selection, schema } = editor.state;
  const { $from } = selection;

  if (
    !selection.empty ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parent.content.size > 0 ||
    $from.parentOffset !== 0 ||
    !isInsideNodeType($from, 'blockquote')
  ) {
    return false;
  }

  const blockquoteDepth = findAncestorDepth($from, 'blockquote');

  if (blockquoteDepth < 0 || !editor.markdown) {
    return false;
  }

  const blockquoteNode = $from.node(blockquoteDepth);
  const calloutNode = buildCalloutNodeFromBlockquote(editor, blockquoteNode);

  if (!calloutNode) {
    return false;
  }

  const blockquotePos = $from.before(blockquoteDepth);
  const paragraph = schema.nodes.paragraph.create();
  const transaction = editor.state.tr.replaceWith(
    blockquotePos,
    blockquotePos + blockquoteNode.nodeSize,
    Fragment.fromArray([calloutNode, paragraph])
  );

  transaction.setSelection(TextSelection.create(transaction.doc, blockquotePos + calloutNode.nodeSize + 1));
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

function normalizeFootnotesOnBlankLine(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from } = selection;

  if (
    !selection.empty ||
    $from.parent.type.name !== 'paragraph' ||
    $from.parent.content.size > 0 ||
    !isRootParagraphContext($from)
  ) {
    return false;
  }

  const markdown = getEditorMarkdown(editor);

  if (!/(^|\n)\[\^[^\]]+\]:\s?/m.test(markdown)) {
    return false;
  }

  return normalizeEditorMarkdown(editor, transformFootnotesForEditor);
}

function normalizeEditorMarkdown(editor: Editor, transform: (content: string) => string): boolean {
  if (!editor.markdown || !editor.state.selection.empty) {
    return false;
  }

  const marker = `VELOCACURSORTOKEN${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const markerTransaction = editor.state.tr.insertText(
    marker,
    editor.state.selection.from,
    editor.state.selection.to
  );
  const rawWithMarker = editor.markdown.serialize(markerTransaction.doc.toJSON() as JSONContent);
  const transformedWithMarker = transform(rawWithMarker);

  if (transformedWithMarker === rawWithMarker) {
    return false;
  }

  editor.commands.setContent(transformedWithMarker, {
    contentType: 'markdown',
    emitUpdate: false
  });

  const markerRange = findTextRange(editor.state.doc, marker);

  if (!markerRange) {
    editor.commands.focus('end');
    return true;
  }

  const cleanupTransaction = editor.state.tr.delete(markerRange.from, markerRange.to);
  cleanupTransaction.setSelection(TextSelection.create(cleanupTransaction.doc, markerRange.from));
  editor.view.dispatch(cleanupTransaction);
  editor.view.focus();
  return true;
}

function buildCalloutNodeFromBlockquote(editor: Editor, blockquoteNode: ProseMirrorNode): ProseMirrorNode | null {
  if (!editor.markdown) {
    return null;
  }

  const contentNodes: ProseMirrorNode[] = [];

  for (let index = 0; index < blockquoteNode.childCount; index += 1) {
    contentNodes.push(blockquoteNode.child(index));
  }

  while (contentNodes.length && isEmptyParagraphNode(contentNodes.at(-1))) {
    contentNodes.pop();
  }

  if (!contentNodes.length) {
    return null;
  }

  const markdown = editor.markdown.serialize({
    type: 'doc',
    content: [
      {
        ...blockquoteNode.toJSON(),
        content: contentNodes.map((node) => node.toJSON())
      }
    ]
  });
  const openingLine = parseCalloutOpeningLine(markdown.trimStart());

  if (!openingLine) {
    return null;
  }

  const transformed = transformCalloutsForEditor(markdown);

  if (transformed === markdown) {
    return null;
  }

  const parsed = editor.markdown.parse(transformed);
  const nextNode = parsed.content?.[0];

  if (!nextNode) {
    return null;
  }

  try {
    return editor.state.schema.nodeFromJSON(nextNode);
  } catch {
    return null;
  }
}

function buildTaskItemFromListItem(
  schema: Editor['schema'],
  listItemNode: ProseMirrorNode,
  checked: boolean
): ProseMirrorNode {
  const nextContent: ProseMirrorNode[] = [schema.nodes.paragraph.create()];

  for (let index = 1; index < listItemNode.childCount; index += 1) {
    nextContent.push(listItemNode.child(index));
  }

  return schema.nodes.taskItem.create({ checked }, nextContent);
}

function findTextRange(
  doc: Editor['state']['doc'],
  text: string
): { from: number; to: number } | null {
  let foundRange: { from: number; to: number } | null = null;

  doc.descendants((node, pos) => {
    if (foundRange || !node.isText || !node.text) {
      return true;
    }

    const matchIndex = node.text.indexOf(text);

    if (matchIndex === -1) {
      return true;
    }

    foundRange = {
      from: pos + matchIndex,
      to: pos + matchIndex + text.length
    };

    return false;
  });

  return foundRange;
}

function findAncestorDepth(
  $from: Editor['state']['selection']['$from'],
  typeName: string
): number {
  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    if ($from.node(depth).type.name === typeName) {
      return depth;
    }
  }

  return -1;
}

function getTopLevelNodePos(doc: Editor['state']['doc'], index: number): number {
  let pos = 0;

  for (let currentIndex = 0; currentIndex < index; currentIndex += 1) {
    pos += doc.child(currentIndex).nodeSize;
  }

  return pos;
}

function isEmptyParagraphNode(node?: ProseMirrorNode | null): boolean {
  return !!node && node.type.name === 'paragraph' && node.textContent.trim() === '';
}

function normalizeLinkHref(href: string): string {
  const normalized = href.trim();

  if (
    !normalized ||
    /^[a-z][a-z0-9+.-]*:/i.test(normalized) ||
    normalized.startsWith('/') ||
    normalized.startsWith('#') ||
    normalized.startsWith('?')
  ) {
    return normalized;
  }

  return `https://${normalized}`;
}

function getHtmlBlockVariantClass(html: string): string {
  if (/data-veloca-callout="true"/i.test(html)) {
    return 'veloca-html-block--callout';
  }

  if (/data-veloca-footnotes="true"/i.test(html)) {
    return 'veloca-html-block--footnotes';
  }

  if (/<details\b/i.test(html)) {
    return 'veloca-html-block--details';
  }

  return '';
}

function renderMultilineHeadingHtml(content: JSONContent[], helpers: MarkdownRendererHelpers): string {
  const lines: JSONContent[][] = [[]];

  content.forEach((node) => {
    if (node.type === 'hardBreak') {
      lines.push([]);
      return;
    }

    lines.at(-1)?.push(node);
  });

  return lines.map((line) => renderMultilineHeadingLine(line, helpers)).join('<br>');
}

function renderMultilineHeadingLine(content: JSONContent[], helpers: MarkdownRendererHelpers): string {
  if (!content.length) {
    return '';
  }

  const markdown = helpers.renderChildren(content);
  const html = renderMarkdownHtml(markdown, true).trim();

  return stripSingleParagraphWrapper(html);
}

function exitHeadingToParagraph(editor: Editor): boolean {
  const { selection, schema } = editor.state;
  const { $from, $to } = selection;
  const paragraph = schema.nodes.paragraph;

  if (!paragraph || !$from.sameParent($to) || $from.parent.type.name !== 'heading') {
    return false;
  }

  return splitBlockAs(() => ({ type: paragraph }))(editor.state, editor.view.dispatch);
}

function convertHeadingToParagraph(editor: Editor): boolean {
  const { selection } = editor.state;
  const { $from, $to } = selection;

  if (!selection.empty || !$from.sameParent($to) || $from.parent.type.name !== 'heading' || $from.parentOffset !== 0) {
    return false;
  }

  return editor.commands.setNode('paragraph');
}

function exitEmptyBlockquote(editor: Editor, requireStart = false): boolean {
  const { selection } = editor.state;
  const { $from } = selection;

  if (
    !selection.empty ||
    !$from.parent.isTextblock ||
    $from.parent.content.size > 0 ||
    !isInsideNodeType($from, 'blockquote') ||
    (requireStart && $from.parentOffset !== 0)
  ) {
    return false;
  }

  return liftEmptyBlock(editor.state, editor.view.dispatch);
}

function isInsideNodeType($from: Editor['state']['selection']['$from'], typeName: string): boolean {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === typeName) {
      return true;
    }
  }

  return false;
}

function convertMarkdownTableHeaderToTable(editor: Editor): boolean {
  const { selection, schema, tr } = editor.state;

  if (!selection.empty || !selection.$from.parent.isTextblock) {
    return false;
  }

  const { $from } = selection;

  if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) {
    return false;
  }

  if (!isRootParagraphContext($from)) {
    return false;
  }

  const headerCells = parseMarkdownTableHeader($from.parent.textBetween(0, $from.parent.content.size, ''));

  if (!headerCells) {
    return false;
  }

  const tableNode = buildMarkdownTableNode(schema, headerCells);
  const paragraphStart = $from.before();
  const paragraphEnd = paragraphStart + $from.parent.nodeSize;
  const tableStart = paragraphStart + 1;

  tr.replaceWith(paragraphStart, paragraphEnd, tableNode);

  tr.setSelection(getTableCellTextSelection(tr.doc, tableStart, tableNode, 1, 0));
  tr.scrollIntoView();

  editor.view.dispatch(tr);
  editor.view.focus();

  return true;
}

function handleTableKeyboardInteraction(
  editor: Editor,
  action:
    | 'enter'
    | 'shift-enter'
    | 'arrow-down'
    | 'arrow-up'
    | 'column-left'
    | 'column-right'
    | 'row-above'
    | 'row-below'
): boolean {
  if (action === 'enter') {
    const context = getActiveTableContext(editor);

    if (!context) {
      return false;
    }

    return insertTableHardBreak(editor, context);
  }

  if (action === 'shift-enter') {
    const context = getActiveTableContext(editor);

    if (!context) {
      return false;
    }

    return insertBodyRowBelowSelection(editor, context);
  }

  if (action === 'row-above') {
    const context = getActionableTableContext(editor);

    if (!context) {
      return false;
    }

    return insertBodyRowAboveSelection(editor, context);
  }

  if (action === 'row-below') {
    const context = getActionableTableContext(editor);

    if (!context) {
      return false;
    }

    return insertBodyRowBelowSelection(editor, context);
  }

  if (action === 'column-left') {
    const context = getActionableTableContext(editor);

    if (!context) {
      return false;
    }

    return insertColumnBesideSelection(editor, context, 'left');
  }

  if (action === 'column-right') {
    const context = getActionableTableContext(editor);

    if (!context) {
      return false;
    }

    return insertColumnBesideSelection(editor, context, 'right');
  }

  if (action === 'arrow-down') {
    const context = getActiveTableContext(editor);

    if (!context) {
      return false;
    }

    return maybeExitTable(editor, context, 'down');
  }

  if (action === 'arrow-up') {
    const context = getActiveTableContext(editor);

    if (!context) {
      return false;
    }

    return maybeExitTable(editor, context, 'up');
  }

  return false;
}

function getActiveTableContext(editor: Editor): TableSelectionContext | null {
  const { selection } = editor.state;

  if (!selection.empty || selection instanceof CellSelection) {
    return null;
  }

  const { $from } = selection;
  const $cell = cellAround($from);
  const table = findTable($from);

  if (!$cell || !table) {
    return null;
  }

  const rect = selectedRect(editor.state);
  const cellNode = $cell.nodeAfter;

  if (!cellNode || !isTextCursorInsideTableCell(selection)) {
    return null;
  }

  return {
    cellNode,
    hasAnchor: true,
    rect,
    selectionKind: 'text',
    table: toTableNodeContext(table),
    tableMap: TableMap.get(table.node)
  };
}

function getActionableTableContext(editor: Editor): TableSelectionContext | null {
  const selectionState = getCurrentTableSelectionState(editor);

  if (!selectionState) {
    return null;
  }

  const anchor =
    selectionState.currentAnchor ??
    getStoredTableAnchor(editor, selectionState.table, selectionState.tableMap) ??
    getDefaultTableAnchor(selectionState.table, selectionState.tableMap);

  if (!anchor) {
    return null;
  }

  if (selectionState.currentAnchor) {
    rememberTableAnchor(editor, selectionState.table, selectionState.currentAnchor);
  }

  return {
    cellNode: anchor.cellNode,
    hasAnchor: selectionState.currentAnchor !== null,
    rect: createSingleCellRect(selectionState.table, selectionState.tableMap, anchor),
    selectionKind: selectionState.selectionKind,
    table: selectionState.table,
    tableMap: selectionState.tableMap
  };
}

function insertTableHardBreak(editor: Editor, context: TableSelectionContext): boolean {
  const { selection, schema } = editor.state;

  if (!isTextCursorInsideTableCell(selection)) {
    return false;
  }

  const hardBreak = schema.nodes.hardBreak;

  if (!hardBreak) {
    return false;
  }

  const transaction = editor.state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView();
  editor.view.dispatch(transaction);

  return true;
}

function insertBodyRowBelowSelection(editor: Editor, context: TableSelectionContext): boolean {
  if (context.cellNode.attrs.colspan > 1 || context.cellNode.attrs.rowspan > 1) {
    return false;
  }

  const insertRowIndex = context.rect.bottom;
  const targetColumn = context.rect.left;
  const transaction = editor.state.tr;
  addRow(transaction, context.rect, insertRowIndex);

  const tableNode = transaction.doc.nodeAt(context.rect.tableStart - 1);

  if (!tableNode) {
    return false;
  }

  const nextTableMap = TableMap.get(tableNode);
  const selection = getTableCellTextSelection(
    transaction.doc,
    context.rect.tableStart,
    tableNode,
    insertRowIndex,
    targetColumn,
    nextTableMap
  );

  transaction.setSelection(selection);
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();

  return true;
}

function insertBodyRowAboveSelection(editor: Editor, context: TableSelectionContext): boolean {
  if (context.cellNode.attrs.colspan > 1 || context.cellNode.attrs.rowspan > 1 || context.rect.top === 0) {
    return false;
  }

  const insertRowIndex = context.rect.top;
  const targetColumn = context.rect.left;
  const transaction = editor.state.tr;
  addRow(transaction, context.rect, insertRowIndex);

  const tableNode = transaction.doc.nodeAt(context.rect.tableStart - 1);

  if (!tableNode) {
    return false;
  }

  const nextTableMap = TableMap.get(tableNode);
  const selection = getTableCellTextSelection(
    transaction.doc,
    context.rect.tableStart,
    tableNode,
    insertRowIndex,
    targetColumn,
    nextTableMap
  );

  transaction.setSelection(selection);
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();

  return true;
}

function insertColumnBesideSelection(
  editor: Editor,
  context: TableSelectionContext,
  direction: TableColumnInsertDirection
): boolean {
  if (context.cellNode.attrs.colspan > 1 || context.cellNode.attrs.rowspan > 1) {
    return false;
  }

  const insertColumnIndex = direction === 'left' ? context.rect.left : context.rect.right;
  const targetRow = context.rect.top;
  const transaction = editor.state.tr;
  addColumn(transaction, context.rect, insertColumnIndex);

  const tableNode = transaction.doc.nodeAt(context.rect.tableStart - 1);

  if (!tableNode) {
    return false;
  }

  const nextTableMap = TableMap.get(tableNode);
  const targetColumn = direction === 'left' ? context.rect.left + 1 : context.rect.left;
  const selection = getTableCellTextSelection(
    transaction.doc,
    context.rect.tableStart,
    tableNode,
    targetRow,
    targetColumn,
    nextTableMap
  );

  transaction.setSelection(selection);
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();

  return true;
}

export type ActiveTableInfo = {
  columnCount: number;
  columnIndex: number;
  hasAnchor: boolean;
  isHeaderRow: boolean;
  rowCount: number;
  rowIndex: number;
  selectionKind: TableSelectionKind;
  tablePos: number;
};

export function getActiveTableInfo(editor: Editor): ActiveTableInfo | null {
  const selectionState = getCurrentTableSelectionState(editor);

  if (!selectionState) {
    return null;
  }

  const anchor =
    selectionState.currentAnchor ??
    getStoredTableAnchor(editor, selectionState.table, selectionState.tableMap) ??
    getDefaultTableAnchor(selectionState.table, selectionState.tableMap);

  if (!anchor) {
    return null;
  }

  if (selectionState.currentAnchor) {
    rememberTableAnchor(editor, selectionState.table, selectionState.currentAnchor);
  }

  return {
    columnCount: selectionState.tableMap.width,
    columnIndex: anchor.columnIndex,
    hasAnchor: selectionState.currentAnchor !== null,
    isHeaderRow: anchor.isHeaderRow,
    rowCount: selectionState.tableMap.height,
    rowIndex: anchor.rowIndex,
    selectionKind: selectionState.selectionKind,
    tablePos: selectionState.table.pos
  };
}

export function insertActiveTableColumn(editor: Editor, direction: TableColumnInsertDirection): boolean {
  const context = getActionableTableContext(editor);

  if (!context) {
    return false;
  }

  return insertColumnBesideSelection(editor, context, direction);
}

export function insertActiveTableRow(editor: Editor, direction: TableRowInsertDirection): boolean {
  const context = getActionableTableContext(editor);

  if (!context) {
    return false;
  }

  return direction === 'above'
    ? insertBodyRowAboveSelection(editor, context)
    : insertBodyRowBelowSelection(editor, context);
}

export function resizeActiveTable(editor: Editor, rowCount: number, columnCount: number): boolean {
  const context = getActionableTableContext(editor);

  if (!context) {
    return false;
  }

  const nextRowCount = Math.max(1, rowCount);
  const nextColumnCount = Math.max(1, columnCount);
  const resizedTable = buildResizedTableNode(editor.schema, context.table.node, nextRowCount, nextColumnCount);
  const transaction = editor.state.tr;
  const tableStart = context.table.pos + 1;

  transaction.replaceWith(context.table.pos, context.table.pos + context.table.node.nodeSize, resizedTable);
  transaction.setSelection(
    getTableCellTextSelection(
      transaction.doc,
      tableStart,
      resizedTable,
      Math.min(context.rect.top, nextRowCount - 1),
      Math.min(context.rect.left, nextColumnCount - 1)
    )
  );
  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();

  return true;
}

function maybeExitTable(editor: Editor, context: TableSelectionContext, direction: 'up' | 'down'): boolean {
  const { selection } = editor.state;
  const isBoundaryRow = direction === 'down' ? context.rect.bottom === context.tableMap.height : context.rect.top === 0;
  const isBoundaryOffset =
    direction === 'down'
      ? selection.$from.parentOffset === selection.$from.parent.content.size
      : selection.$from.parentOffset === 0;

  if (!isBoundaryRow || !isBoundaryOffset) {
    return false;
  }

  return exitTableToParagraph(editor, context.table, direction);
}

function exitTableToParagraph(editor: Editor, table: TableSelectionContext['table'], direction: 'up' | 'down'): boolean {
  const transaction = editor.state.tr;

  if (direction === 'down') {
    const afterPos = table.pos + table.node.nodeSize;
    const $after = transaction.doc.resolve(afterPos);

    if ($after.nodeAfter?.type.name === 'paragraph') {
      transaction.setSelection(TextSelection.create(transaction.doc, afterPos + 1));
    } else {
      transaction.insert(afterPos, editor.state.schema.nodes.paragraph.create());
      transaction.setSelection(TextSelection.create(transaction.doc, afterPos + 1));
    }

    transaction.scrollIntoView();
    editor.view.dispatch(transaction);
    editor.view.focus();
    return true;
  }

  const beforePos = table.pos;
  const $before = transaction.doc.resolve(beforePos);

  if ($before.nodeBefore?.type.name === 'paragraph') {
    transaction.setSelection(TextSelection.create(transaction.doc, Math.max(1, beforePos - 1)));
  } else {
    transaction.insert(beforePos, editor.state.schema.nodes.paragraph.create());
    transaction.setSelection(TextSelection.create(transaction.doc, beforePos + 1));
  }

  transaction.scrollIntoView();
  editor.view.dispatch(transaction);
  editor.view.focus();
  return true;
}

function isRootParagraphContext($from: Editor['state']['selection']['$from']): boolean {
  for (let depth = $from.depth - 1; depth >= 0; depth -= 1) {
    const ancestorName = $from.node(depth).type.name;

    if (ancestorName === 'doc') {
      return true;
    }

    if (ancestorName === 'blockquote' || ancestorName === 'bulletList' || ancestorName === 'orderedList') {
      return false;
    }

    if (
      ancestorName === 'listItem' ||
      ancestorName === 'taskItem' ||
      ancestorName === 'tableCell' ||
      ancestorName === 'tableHeader' ||
      ancestorName === 'codeBlock'
    ) {
      return false;
    }
  }

  return false;
}

function parseMarkdownTableHeader(value: string): string[] | null {
  const normalized = value.trim();

  if (!normalized.startsWith('|') || !normalized.endsWith('|')) {
    return null;
  }

  const columns = splitMarkdownTableColumns(normalized);

  if (!columns || columns.length < 2) {
    return null;
  }

  return columns;
}

function splitMarkdownTableColumns(value: string): string[] | null {
  const columns: string[] = [];
  let current = '';
  let isEscaping = false;

  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];

    if (isEscaping) {
      current += character;
      isEscaping = false;
      continue;
    }

    if (character === '\\') {
      isEscaping = true;
      continue;
    }

    if (character === '|') {
      columns.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  if (isEscaping) {
    current += '\\';
  }

  columns.push(current.trim());

  return columns.every((column) => column.length > 0) ? columns : null;
}

function buildMarkdownTableNode(schema: Editor['schema'], headerCells: string[]) {
  const createParagraph = (text = '') =>
    schema.nodes.paragraph.create(
      null,
      text ? schema.text(text) : undefined
    );
  const createHeaderCell = (text: string) => schema.nodes.tableHeader.create(null, createParagraph(text));
  const createBodyCell = () => schema.nodes.tableCell.create(null, createParagraph());
  const headerRow = schema.nodes.tableRow.create(null, headerCells.map(createHeaderCell));
  const bodyRow = schema.nodes.tableRow.create(null, headerCells.map(() => createBodyCell()));

  return schema.nodes.table.create(null, [headerRow, bodyRow]);
}

function buildResizedTableNode(
  schema: Editor['schema'],
  tableNode: ProseMirrorNode,
  rowCount: number,
  columnCount: number
) {
  const rows: ProseMirrorNode[] = [];

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const sourceRow = rowIndex < tableNode.childCount ? tableNode.child(rowIndex) : null;
    const nextCells: ProseMirrorNode[] = [];

    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const sourceCell = sourceRow && columnIndex < sourceRow.childCount ? sourceRow.child(columnIndex) : null;
      const shouldUseHeaderCell = rowIndex === 0;
      nextCells.push(buildResizedTableCell(schema, sourceCell, shouldUseHeaderCell));
    }

    rows.push(schema.nodes.tableRow.create(null, nextCells));
  }

  return schema.nodes.table.create(null, rows);
}

function buildResizedTableCell(
  schema: Editor['schema'],
  sourceCell: ProseMirrorNode | null,
  shouldUseHeaderCell: boolean
) {
  const cellType = shouldUseHeaderCell ? schema.nodes.tableHeader : schema.nodes.tableCell;
  const attrs = {
    align: sourceCell?.attrs.align ?? null,
    colspan: 1,
    colwidth: null,
    rowspan: 1
  };

  if (!sourceCell) {
    return cellType.create(
      attrs,
      schema.nodes.paragraph.create()
    );
  }

  return cellType.create(attrs, sourceCell.content);
}

function getTableCellTextSelection(
  doc: Editor['state']['doc'],
  tableStart: number,
  tableNode: ProseMirrorNode,
  rowIndex: number,
  columnIndex: number,
  tableMap = TableMap.get(tableNode)
) {
  const cellOffset = tableMap.positionAt(rowIndex, columnIndex, tableNode);
  return TextSelection.near(doc.resolve(tableStart + cellOffset + 1), 1);
}

function createSingleCellRect(
  table: TableNodeContext,
  tableMap: TableMap,
  anchor: TableAnchor
): ReturnType<typeof selectedRect> {
  return {
    bottom: anchor.rowIndex + 1,
    left: anchor.columnIndex,
    map: tableMap,
    right: anchor.columnIndex + 1,
    table: table.node,
    tableStart: table.start,
    top: anchor.rowIndex
  };
}

function getCurrentTableSelectionState(editor: Editor): TableSelectionState | null {
  const { selection } = editor.state;

  if (selection instanceof CellSelection) {
    const table = findTable(selection.$anchorCell);

    if (!table) {
      return null;
    }

    const tableContext = toTableNodeContext(table);
    const tableMap = TableMap.get(table.node);

    return {
      currentAnchor: getTableAnchorFromAbsoluteCellPos(tableContext, tableMap, selection.$anchorCell.pos),
      selectionKind: 'cell',
      table: tableContext,
      tableMap
    };
  }

  if (selection instanceof NodeSelection) {
    const tableRole = selection.node.type.spec.tableRole;

    if (tableRole === 'table') {
      return {
        currentAnchor: null,
        selectionKind: 'table',
        table: {
          node: selection.node,
          pos: selection.from,
          start: selection.from + 1
        },
        tableMap: TableMap.get(selection.node)
      };
    }

    if (tableRole === 'cell' || tableRole === 'header_cell') {
      const table = findTable(selection.$from);

      if (!table) {
        return null;
      }

      const tableContext = toTableNodeContext(table);
      const tableMap = TableMap.get(table.node);

      return {
        currentAnchor: getTableAnchorFromAbsoluteCellPos(tableContext, tableMap, selection.from),
        selectionKind: 'cell',
        table: tableContext,
        tableMap
      };
    }
  }

  const $cell = cellAround(selection.$from);
  const table = findTable(selection.$from);

  if (!$cell || !table) {
    return null;
  }

  const tableContext = toTableNodeContext(table);
  const tableMap = TableMap.get(table.node);

  return {
    currentAnchor: getTableAnchorFromAbsoluteCellPos(tableContext, tableMap, $cell.pos),
    selectionKind: 'text',
    table: tableContext,
    tableMap
  };
}

function getStoredTableAnchor(editor: Editor, table: TableNodeContext, tableMap: TableMap): TableAnchor | null {
  const storedAnchor = lastFocusedTableCellByEditor.get(editor);

  if (!storedAnchor || storedAnchor.tablePos !== table.pos) {
    return null;
  }

  const rowIndex = Math.min(Math.max(storedAnchor.rowIndex, 0), Math.max(tableMap.height - 1, 0));
  const columnIndex = Math.min(Math.max(storedAnchor.columnIndex, 0), Math.max(tableMap.width - 1, 0));

  return getTableAnchorFromCoordinates(table, tableMap, rowIndex, columnIndex);
}

function getDefaultTableAnchor(table: TableNodeContext, tableMap: TableMap): TableAnchor | null {
  if (tableMap.width < 1 || tableMap.height < 1) {
    return null;
  }

  if (tableMap.height > 1) {
    return getTableAnchorFromCoordinates(table, tableMap, 1, 0) ?? getTableAnchorFromCoordinates(table, tableMap, 0, 0);
  }

  return getTableAnchorFromCoordinates(table, tableMap, 0, 0);
}

function getTableAnchorFromCoordinates(
  table: TableNodeContext,
  tableMap: TableMap,
  rowIndex: number,
  columnIndex: number
): TableAnchor | null {
  if (rowIndex < 0 || columnIndex < 0 || rowIndex >= tableMap.height || columnIndex >= tableMap.width) {
    return null;
  }

  const cellOffset = tableMap.positionAt(rowIndex, columnIndex, table.node);
  const cellNode = table.node.nodeAt(cellOffset);

  if (!cellNode) {
    return null;
  }

  const cellRect = tableMap.findCell(cellOffset);

  return {
    cellNode,
    columnIndex: cellRect.left,
    isHeaderRow: cellNode.type.name === 'tableHeader',
    rowIndex: cellRect.top
  };
}

function getTableAnchorFromAbsoluteCellPos(
  table: TableNodeContext,
  tableMap: TableMap,
  absoluteCellPos: number
): TableAnchor | null {
  const relativeCellPos = absoluteCellPos - table.start;

  if (relativeCellPos < 0) {
    return null;
  }

  const cellNode = table.node.nodeAt(relativeCellPos);

  if (!cellNode) {
    return null;
  }

  const cellRect = tableMap.findCell(relativeCellPos);

  return {
    cellNode,
    columnIndex: cellRect.left,
    isHeaderRow: cellNode.type.name === 'tableHeader',
    rowIndex: cellRect.top
  };
}

function rememberTableAnchor(editor: Editor, table: TableNodeContext, anchor: TableAnchor) {
  lastFocusedTableCellByEditor.set(editor, {
    columnIndex: anchor.columnIndex,
    rowIndex: anchor.rowIndex,
    tablePos: table.pos
  });
}

function toTableNodeContext(table: NonNullable<ReturnType<typeof findTable>>): TableNodeContext {
  return {
    node: table.node,
    pos: table.pos,
    start: table.start
  };
}

function renderVelocaTableToMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  if (!node.content?.length) {
    return '';
  }

  const rows = node.content.map((rowNode) =>
    (rowNode.content ?? []).map((cellNode) => ({
      align: normalizeTableCellAlignment(cellNode.attrs),
      isHeader: cellNode.type === 'tableHeader',
      text: renderTableCellMarkdown(cellNode, helpers)
    }))
  );

  const columnCount = rows.reduce((count, row) => Math.max(count, row.length), 0);

  if (!columnCount) {
    return '';
  }

  const hasHeader = rows[0]?.some((cell) => cell.isHeader) ?? false;
  const columnWidths = new Array<number>(columnCount).fill(3);
  const alignments = new Array<string | null>(columnCount).fill(null);

  rows.forEach((row) => {
    for (let column = 0; column < columnCount; column += 1) {
      const cell = row[column];

      if (!cell) {
        continue;
      }

      columnWidths[column] = Math.max(columnWidths[column], cell.text.length || 3);

      if (!alignments[column] && cell.align) {
        alignments[column] = cell.align;
      }
    }
  });

  const headerTexts = new Array(columnCount)
    .fill('')
    .map((_, index) => (hasHeader ? rows[0]?.[index]?.text ?? '' : ''));
  const bodyRows = hasHeader ? rows.slice(1) : rows;
  const lines = [''];

  lines.push(`| ${headerTexts.map((cell, index) => padTableCell(cell, columnWidths[index])).join(' | ')} |`);
  lines.push(`| ${alignments.map((alignment, index) => buildMarkdownDivider(columnWidths[index], alignment)).join(' | ')} |`);

  bodyRows.forEach((row) => {
    lines.push(
      `| ${new Array(columnCount)
        .fill('')
        .map((_, index) => padTableCell(row[index]?.text ?? '', columnWidths[index]))
        .join(' | ')} |`
    );
  });

  return `${lines.join('\n')}\n`;
}

function renderTableCellMarkdown(
  cellNode: JSONContent,
  helpers: MarkdownRendererHelpers
): string {
  const blocks = (cellNode.content ?? []).map((childNode) => renderTableCellBlock(childNode, helpers));

  return blocks
    .filter(Boolean)
    .map((block) => normalizeTableCellWhitespace(block))
    .join('<br>');
}

function renderTableCellBlock(
  node: JSONContent,
  helpers: MarkdownRendererHelpers
): string {
  if (node.type === 'paragraph') {
    return renderTableCellInline(node.content ?? [], helpers);
  }

  if (node.type === 'hardBreak') {
    return '<br>';
  }

  if (node.content?.length) {
    return renderTableCellInline(node.content, helpers);
  }

  return helpers.renderChildren([node]);
}

function renderTableCellInline(
  nodes: JSONContent[],
  helpers: MarkdownRendererHelpers
): string {
  return nodes
    .map((node) => {
      if (node.type === 'hardBreak') {
        return '<br>';
      }

      if (node.content?.length) {
        return helpers.renderChildren([node]);
      }

      return helpers.renderChildren([node]);
    })
    .join('');
}

function normalizeTableCellWhitespace(value: string): string {
  return value
    .split('<br>')
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .join('<br>');
}

function normalizeTableCellAlignment(attrs?: Record<string, unknown>): string | null {
  if (attrs?.align === 'left' || attrs?.align === 'center' || attrs?.align === 'right') {
    return attrs.align;
  }

  return null;
}

function padTableCell(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - value.length));
}

function buildMarkdownDivider(width: number, alignment: string | null): string {
  const dashCount = Math.max(3, width);

  if (alignment === 'left') {
    return `:${'-'.repeat(dashCount)}`;
  }

  if (alignment === 'right') {
    return `${'-'.repeat(dashCount)}:`;
  }

  if (alignment === 'center') {
    return `:${'-'.repeat(dashCount)}:`;
  }

  return '-'.repeat(dashCount);
}

function isTextCursorInsideTableCell(selection: Editor['state']['selection']): boolean {
  const parentType = selection.$from.parent.type.name;

  return selection.empty && (parentType === 'paragraph' || parentType === 'text');
}

type TableSelectionContext = {
  cellNode: ProseMirrorNode;
  hasAnchor: boolean;
  rect: ReturnType<typeof selectedRect>;
  selectionKind: TableSelectionKind;
  table: TableNodeContext;
  tableMap: TableMap;
};

type TableNodeContext = {
  node: ProseMirrorNode;
  pos: number;
  start: number;
};

type TableAnchor = {
  cellNode: ProseMirrorNode;
  columnIndex: number;
  isHeaderRow: boolean;
  rowIndex: number;
};

type TableSelectionKind = 'cell' | 'table' | 'text';

type StoredTableAnchor = {
  columnIndex: number;
  rowIndex: number;
  tablePos: number;
};

type TableSelectionState = {
  currentAnchor: TableAnchor | null;
  selectionKind: TableSelectionKind;
  table: TableNodeContext;
  tableMap: TableMap;
};

type TableColumnInsertDirection = 'left' | 'right';
type TableRowInsertDirection = 'above' | 'below';

const lastFocusedTableCellByEditor = new WeakMap<Editor, StoredTableAnchor>();

function sanitizeUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value.trim();

  if (/^javascript:/i.test(sanitized)) {
    return null;
  }

  return sanitized;
}

function escapeHtmlAttribute(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlText(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildYoutubeEmbedUrl(url: string): string {
  const matchedId =
    url.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/i)?.[1] ??
    url.match(/\/shorts\/([\w-]{6,})/i)?.[1] ??
    '';

  return matchedId ? `https://www.youtube-nocookie.com/embed/${matchedId}` : url;
}

function getUrlFileName(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').filter(Boolean).pop() ?? 'media';
  } catch {
    return 'media';
  }
}
