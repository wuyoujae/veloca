import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAiMarkdownInsertionPatch,
  relocateAiProvenanceRanges,
  shiftAiProvenanceRangesForPatch
} from '../frontend/src/ai-insert.ts';

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
