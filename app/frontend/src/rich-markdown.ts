import DOMPurify from 'dompurify';
import {
  Extension,
  mergeAttributes,
  Node,
  type Editor,
  type JSONContent,
  type MarkdownRendererHelpers
} from '@tiptap/core';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Emoji from '@tiptap/extension-emoji';
import FileHandler from '@tiptap/extension-file-handler';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
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
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap, addRow, cellAround, findTable, selectedRect } from '@tiptap/pm/tables';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';

const purifier = typeof window === 'undefined' ? null : DOMPurify(window);
const lowlight = createLowlight(common);

export const MEDIA_LIMITS = {
  audio: 50 * 1024 * 1024,
  image: 20 * 1024 * 1024,
  video: 200 * 1024 * 1024
} as const;

type HtmlBlockAttrs = {
  html: string;
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
      dom.className = 'veloca-html-block';
      dom.dataset.velocaHtmlBlock = 'true';
      dom.contentEditable = 'false';

      const render = () => {
        dom.innerHTML = sanitizeHtml((node.attrs as HtmlBlockAttrs).html);
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

const VelocaTable = Table.extend({
  renderMarkdown(node, helpers): string {
    return renderVelocaTableToMarkdown(node.toJSON() as JSONContent, helpers);
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

        return convertMarkdownTableHeaderToTable(editor);
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
      }
    };
  }
});

export function createRichEditorExtensions(callbacks: RichEditorCallbacks) {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: {
        levels: [1, 2, 3, 4, 5, 6]
      }
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
    CodeBlockLowlight.configure({
      HTMLAttributes: {
        class: 'veloca-code-block'
      },
      lowlight
    }),
    Highlight,
    Subscript,
    Superscript,
    Typography,
    TaskList,
    TaskItem.configure({
      nested: true
    }),
    TyporaTableInput,
    VelocaTable.configure({
      resizable: false
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
    ADD_ATTR: ['allow', 'allowfullscreen', 'controls', 'data-veloca-html-block', 'poster', 'src', 'title'],
    ADD_TAGS: ['audio', 'details', 'iframe', 'section', 'source', 'summary', 'video'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'srcdoc'],
    FORBID_TAGS: ['script']
  });
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

  tr.replaceWith(paragraphStart, paragraphEnd, tableNode);

  const selectionPos = getFirstTableBodyCellSelection(paragraphStart, tableNode);
  tr.setSelection(TextSelection.create(tr.doc, selectionPos));
  tr.scrollIntoView();

  editor.view.dispatch(tr);
  editor.view.focus();

  return true;
}

function handleTableKeyboardInteraction(
  editor: Editor,
  action: 'enter' | 'shift-enter' | 'arrow-down' | 'arrow-up'
): boolean {
  const context = getActiveTableContext(editor);

  if (!context) {
    return false;
  }

  if (action === 'enter') {
    return insertTableHardBreak(editor, context);
  }

  if (action === 'shift-enter') {
      return insertBodyRowBelowSelection(editor, context);
  }

  if (action === 'arrow-down') {
    return maybeExitTable(editor, context, 'down');
  }

  if (action === 'arrow-up') {
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
    rect,
    table,
    tableMap: TableMap.get(table.node)
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
  const cellOffset = nextTableMap.positionAt(insertRowIndex, targetColumn, tableNode);
  const selectionPos = context.rect.tableStart + cellOffset + 2;

  transaction.setSelection(TextSelection.create(transaction.doc, selectionPos));
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

function getFirstTableBodyCellSelection(tableStart: number, tableNode: ReturnType<typeof buildMarkdownTableNode>): number {
  const headerRow = tableNode.firstChild;

  if (!headerRow) {
    return tableStart + 1;
  }

  return tableStart + headerRow.nodeSize + 4;
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
  rect: ReturnType<typeof selectedRect>;
  table: NonNullable<ReturnType<typeof findTable>>;
  tableMap: TableMap;
};

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
