import assert from 'node:assert/strict';
import test from 'node:test';
import { MarkdownManager } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import {
  buildAiMarkdownInsertionPatch,
  relocateAiProvenanceRanges,
  shiftAiProvenanceRangesForPatch,
  updateAiProvenanceRangesForSourceEdit
} from '../frontend/src/ai-insert.ts';
import { getEditorMarkdown } from '../frontend/src/rich-markdown.ts';

test('inserts normalized AI markdown into an empty document', () => {
  const patch = buildAiMarkdownInsertionPatch('', '\n\n# Title\n\nBody\n\n', { from: 0, to: 0 });

  assert.ok(patch);
  assert.equal(patch.content, '# Title\n\nBody');
  assert.deepEqual(patch.inserted, { from: 0, to: 13 });
});

test('inserts after a fenced code block when the cursor is inside it', () => {
  const content = 'Before\n\n```ts\nconst answer = 42;\n```\n\nAfter';
  const cursor = content.indexOf('answer');
  const patch = buildAiMarkdownInsertionPatch(content, '| A | B |\n| --- | --- |\n| 1 | 2 |', {
    from: cursor,
    to: cursor
  });

  assert.ok(patch);
  assert.equal(
    patch.content,
    'Before\n\n```ts\nconst answer = 42;\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nAfter'
  );
});

test('inserts after a table block when the cursor is inside a cell', () => {
  const content = '| A | B |\n| --- | --- |\n| old | value |\n\nTail';
  const cursor = content.indexOf('old');
  const patch = buildAiMarkdownInsertionPatch(content, '- first\n- second', { from: cursor, to: cursor });

  assert.ok(patch);
  assert.equal(patch.content, '| A | B |\n| --- | --- |\n| old | value |\n\n- first\n- second\n\nTail');
});

test('shifts existing provenance ranges around a source patch', () => {
  const ranges = [
    {
      createdAt: 1,
      end: 9,
      id: 'range-a',
      provenanceId: 'ai-a',
      rawMarkdown: 'AI block',
      rawMarkdownHash: 'hash-a',
      sourceMessageId: 'message-a',
      start: 1
    }
  ];

  assert.deepEqual(shiftAiProvenanceRangesForPatch(ranges, { from: 0, to: 0 }, 4)[0], {
    ...ranges[0],
    end: 13,
    start: 5
  });
});

test('relocates an AI range only when its raw markdown has one clear match', () => {
  const range = {
    createdAt: 1,
    end: 12,
    id: 'range-a',
    provenanceId: 'ai-a',
    rawMarkdown: 'AI block',
    rawMarkdownHash: 'hash-a',
    sourceMessageId: 'message-a',
    start: 4
  };

  assert.deepEqual(relocateAiProvenanceRanges('Intro\n\nAI block\n\nTail', [range])[0], {
    ...range,
    end: 15,
    start: 7
  });
  assert.equal(relocateAiProvenanceRanges('AI block\n\nAI block', [range]).length, 0);
});

test('keeps provenance ranges when source edits happen before AI content', () => {
  const previousContent = 'Intro\n\nAI block';
  const nextContent = 'Intro changed\n\nAI block';
  const range = {
    createdAt: 1,
    end: previousContent.length,
    id: 'range-a',
    provenanceId: 'ai-a',
    rawMarkdown: 'AI block',
    rawMarkdownHash: 'hash-a',
    sourceMessageId: 'message-a',
    start: previousContent.indexOf('AI block')
  };

  const [updated] = updateAiProvenanceRangesForSourceEdit(previousContent, nextContent, [range]);

  assert.equal(updated.start, nextContent.indexOf('AI block'));
  assert.equal(updated.end, nextContent.length);
  assert.equal(updated.rawMarkdown, 'AI block');
});

test('keeps provenance ranges when source edits happen inside AI content', () => {
  const previousContent = 'Intro\n\nAI block\n\nTail';
  const nextContent = 'Intro\n\nAI edited block\n\nTail';
  const range = {
    createdAt: 1,
    end: previousContent.indexOf('\n\nTail'),
    id: 'range-a',
    provenanceId: 'ai-a',
    rawMarkdown: 'AI block',
    rawMarkdownHash: 'hash-a',
    sourceMessageId: 'message-a',
    start: previousContent.indexOf('AI block')
  };

  const [updated] = updateAiProvenanceRangesForSourceEdit(previousContent, nextContent, [range]);

  assert.equal(updated.start, nextContent.indexOf('AI edited block'));
  assert.equal(updated.end, nextContent.indexOf('\n\nTail'));
  assert.equal(updated.rawMarkdown, 'AI edited block');
});

test('serializes rendered editor markdown with block separators', () => {
  const manager = new MarkdownManager({ extensions: [StarterKit] });
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: '你好！我是 Loomber 项目的开发者。' }]
      },
      {
        type: 'heading',
        attrs: { level: 3 },
        content: [{ type: 'text', text: '项目总结：Loomber' }]
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '简单来说，' },
          { type: 'text', text: 'Loomber', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' 是一个 Markdown 编辑器。' }
        ]
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: '后端：处理文件上传。' }]
              }
            ]
          }
        ]
      }
    ]
  };
  const editor = {
    getMarkdown: () => '',
    markdown: manager,
    state: {
      doc: {
        toJSON: () => doc
      }
    }
  };

  assert.equal(
    getEditorMarkdown(editor),
    '你好！我是 Loomber 项目的开发者。\n\n### 项目总结：Loomber\n\n简单来说，**Loomber** 是一个 Markdown 编辑器。\n\n- 后端：处理文件上传。'
  );
});
