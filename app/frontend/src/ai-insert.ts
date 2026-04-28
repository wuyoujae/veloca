import type { JSONContent } from '@tiptap/core';

export interface MarkdownSelectionRange {
  from: number;
  to: number;
}

export interface AiGeneratedMarkdownRange {
  createdAt: number;
  end: number;
  id: string;
  provenanceId: string;
  rawMarkdown: string;
  rawMarkdownHash: string;
  sourceMessageId: string;
  start: number;
}

export interface AiProvenanceSnapshotV2 {
  markdownHash: string;
  ranges: AiGeneratedMarkdownRange[];
  snapshot: JSONContent | null;
  version: 2;
}

export interface AiMarkdownInsertionPatch {
  content: string;
  inserted: MarkdownSelectionRange;
  normalizedMarkdown: string;
  replaced: MarkdownSelectionRange;
}

interface MarkdownLine {
  end: number;
  index: number;
  start: number;
  text: string;
}

interface MarkdownBlockRange {
  from: number;
  to: number;
}

export function normalizeAiMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  while (lines.length && !lines[0].trim()) {
    lines.shift();
  }

  while (lines.length && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines.join('\n');
}

export function buildAiMarkdownInsertionPatch(
  content: string,
  markdown: string,
  selection: MarkdownSelectionRange | null
): AiMarkdownInsertionPatch | null {
  const normalizedMarkdown = normalizeAiMarkdown(markdown);

  if (!normalizedMarkdown.trim()) {
    return null;
  }

  const safeSelection = normalizeSelection(selection, content.length);
  const replaced = getReplacementRange(content, safeSelection);
  const before = content.slice(0, replaced.from);
  const after = content.slice(replaced.to);
  const prefix = buildPrefix(before);
  const suffix = buildSuffix(after);
  const insertedStart = before.length + prefix.length;
  const insertedEnd = insertedStart + normalizedMarkdown.length;

  return {
    content: `${before}${prefix}${normalizedMarkdown}${suffix}${after}`,
    inserted: {
      from: insertedStart,
      to: insertedEnd
    },
    normalizedMarkdown,
    replaced
  };
}

export function shiftAiProvenanceRangesForPatch(
  ranges: AiGeneratedMarkdownRange[],
  replaced: MarkdownSelectionRange,
  insertedLength: number
): AiGeneratedMarkdownRange[] {
  const removedLength = replaced.to - replaced.from;
  const delta = insertedLength - removedLength;

  return ranges
    .flatMap((range) => {
      if (range.end <= replaced.from) {
        return [range];
      }

      if (range.start >= replaced.to) {
        return [
          {
            ...range,
            end: range.end + delta,
            start: range.start + delta
          }
        ];
      }

      return [];
    })
    .sort((left, right) => left.start - right.start);
}

export function relocateAiProvenanceRanges(
  content: string,
  ranges: AiGeneratedMarkdownRange[]
): AiGeneratedMarkdownRange[] {
  const relocated: AiGeneratedMarkdownRange[] = [];

  for (const range of ranges) {
    if (!range.rawMarkdown) {
      continue;
    }

    if (content.slice(range.start, range.end) === range.rawMarkdown && !overlapsExisting(relocated, range.start, range.end)) {
      relocated.push(range);
      continue;
    }

    const matches = findAllOccurrences(content, range.rawMarkdown).filter(
      (start) => !overlapsExisting(relocated, start, start + range.rawMarkdown.length)
    );

    if (matches.length !== 1) {
      continue;
    }

    const start = matches[0];
    relocated.push({
      ...range,
      end: start + range.rawMarkdown.length,
      start
    });
  }

  return relocated.sort((left, right) => left.start - right.start);
}

export function filterValidAiProvenanceRanges(
  content: string,
  ranges: AiGeneratedMarkdownRange[]
): AiGeneratedMarkdownRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const valid: AiGeneratedMarkdownRange[] = [];

  for (const range of sorted) {
    if (
      range.start < 0 ||
      range.end <= range.start ||
      range.end > content.length ||
      content.slice(range.start, range.end) !== range.rawMarkdown ||
      overlapsExisting(valid, range.start, range.end)
    ) {
      continue;
    }

    valid.push(range);
  }

  return valid;
}

function normalizeSelection(selection: MarkdownSelectionRange | null, contentLength: number): MarkdownSelectionRange {
  const from = clamp(selection?.from ?? contentLength, 0, contentLength);
  const to = clamp(selection?.to ?? from, 0, contentLength);

  return {
    from: Math.min(from, to),
    to: Math.max(from, to)
  };
}

function getReplacementRange(content: string, selection: MarkdownSelectionRange): MarkdownSelectionRange {
  if (!content.trim()) {
    return {
      from: 0,
      to: content.length
    };
  }

  const lines = getMarkdownLines(content);

  if (!lines.length) {
    return {
      from: 0,
      to: 0
    };
  }

  if (selection.from !== selection.to) {
    const fromBlock = findContainingBlockRange(content, lines, selection.from);
    const toBlock = findContainingBlockRange(content, lines, Math.max(selection.from, selection.to - 1));

    return {
      from: fromBlock.from,
      to: toBlock.to
    };
  }

  const line = findLineAtOffset(lines, selection.from);

  if (!line || !line.text.trim()) {
    return {
      from: line?.start ?? selection.from,
      to: line?.end ?? selection.from
    };
  }

  const block = findContainingBlockRange(content, lines, selection.from);

  return {
    from: block.to,
    to: block.to
  };
}

function findContainingBlockRange(content: string, lines: MarkdownLine[], offset: number): MarkdownBlockRange {
  const line = findLineAtOffset(lines, offset) ?? lines[lines.length - 1];
  const fencedCodeRange = findFencedCodeRange(lines, line.index);

  if (fencedCodeRange) {
    return fencedCodeRange;
  }

  const tableRange = findTableRange(lines, line.index);

  if (tableRange) {
    return tableRange;
  }

  const listRange = findListRange(lines, line.index);

  if (listRange) {
    return listRange;
  }

  return findParagraphRange(content, lines, line.index);
}

function getMarkdownLines(content: string): MarkdownLine[] {
  const lines: MarkdownLine[] = [];
  let start = 0;
  let index = 0;

  while (start <= content.length) {
    const newlineIndex = content.indexOf('\n', start);
    const end = newlineIndex >= 0 ? newlineIndex : content.length;
    const rawText = content.slice(start, end);

    lines.push({
      end,
      index,
      start,
      text: rawText.endsWith('\r') ? rawText.slice(0, -1) : rawText
    });

    if (newlineIndex < 0) {
      break;
    }

    start = newlineIndex + 1;
    index += 1;
  }

  return lines;
}

function findLineAtOffset(lines: MarkdownLine[], offset: number): MarkdownLine | null {
  return (
    lines.find((line) => offset >= line.start && offset <= line.end) ??
    lines.find((line) => offset === line.end + 1) ??
    null
  );
}

function findFencedCodeRange(lines: MarkdownLine[], targetIndex: number): MarkdownBlockRange | null {
  let openFence: { char: string; length: number; startIndex: number } | null = null;

  for (const line of lines) {
    const openingMatch = line.text.match(/^ {0,3}(`{3,}|~{3,})/);

    if (!openFence && openingMatch) {
      openFence = {
        char: openingMatch[1][0],
        length: openingMatch[1].length,
        startIndex: line.index
      };
      continue;
    }

    if (!openFence) {
      continue;
    }

    const closePattern = new RegExp(`^ {0,3}\\${openFence.char}{${openFence.length},}\\s*$`);

    if (closePattern.test(line.text)) {
      if (targetIndex >= openFence.startIndex && targetIndex <= line.index) {
        return {
          from: lines[openFence.startIndex].start,
          to: line.end
        };
      }

      openFence = null;
    }
  }

  if (openFence && targetIndex >= openFence.startIndex) {
    return {
      from: lines[openFence.startIndex].start,
      to: lines[lines.length - 1].end
    };
  }

  return null;
}

function findTableRange(lines: MarkdownLine[], targetIndex: number): MarkdownBlockRange | null {
  const targetLine = lines[targetIndex];

  if (!targetLine || !targetLine.text.includes('|')) {
    return null;
  }

  const hasDividerNearby =
    isTableDivider(lines[targetIndex - 1]?.text ?? '') ||
    isTableDivider(lines[targetIndex]?.text ?? '') ||
    isTableDivider(lines[targetIndex + 1]?.text ?? '');

  if (!hasDividerNearby) {
    return null;
  }

  let startIndex = targetIndex;
  let endIndex = targetIndex;

  while (startIndex > 0 && isTableRow(lines[startIndex - 1].text)) {
    startIndex -= 1;
  }

  while (endIndex < lines.length - 1 && isTableRow(lines[endIndex + 1].text)) {
    endIndex += 1;
  }

  return {
    from: lines[startIndex].start,
    to: lines[endIndex].end
  };
}

function findListRange(lines: MarkdownLine[], targetIndex: number): MarkdownBlockRange | null {
  if (!isListLikeLine(lines, targetIndex)) {
    return null;
  }

  let startIndex = targetIndex;
  let endIndex = targetIndex;

  while (startIndex > 0 && isListLikeLine(lines, startIndex - 1)) {
    startIndex -= 1;
  }

  while (endIndex < lines.length - 1 && isListLikeLine(lines, endIndex + 1)) {
    endIndex += 1;
  }

  return {
    from: lines[startIndex].start,
    to: lines[endIndex].end
  };
}

function findParagraphRange(content: string, lines: MarkdownLine[], targetIndex: number): MarkdownBlockRange {
  let startIndex = targetIndex;
  let endIndex = targetIndex;

  while (startIndex > 0 && lines[startIndex - 1].text.trim()) {
    startIndex -= 1;
  }

  while (endIndex < lines.length - 1 && lines[endIndex + 1].text.trim()) {
    endIndex += 1;
  }

  return {
    from: lines[startIndex].start,
    to: Math.min(lines[endIndex].end, content.length)
  };
}

function buildPrefix(before: string): string {
  if (!before.trim()) {
    return '';
  }

  return '\n'.repeat(Math.max(0, 2 - countTrailingNewlines(before)));
}

function buildSuffix(after: string): string {
  if (!after.trim()) {
    return '';
  }

  return '\n'.repeat(Math.max(0, 2 - countLeadingNewlines(after)));
}

function countTrailingNewlines(value: string): number {
  let count = 0;

  for (let index = value.length - 1; index >= 0 && value[index] === '\n'; index -= 1) {
    count += 1;
  }

  return count;
}

function countLeadingNewlines(value: string): number {
  let count = 0;

  for (let index = 0; index < value.length && value[index] === '\n'; index += 1) {
    count += 1;
  }

  return count;
}

function isTableDivider(value: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(value);
}

function isTableRow(value: string): boolean {
  return value.includes('|') && Boolean(value.trim());
}

function isListLikeLine(lines: MarkdownLine[], index: number): boolean {
  const line = lines[index];

  if (!line || !line.text.trim()) {
    return false;
  }

  if (/^\s*(?:[-+*]\s+|\d+[.)]\s+)/.test(line.text)) {
    return true;
  }

  return index > 0 && /^\s{2,}\S/.test(line.text) && isListLikeLine(lines, index - 1);
}

function findAllOccurrences(content: string, needle: string): number[] {
  const matches: number[] = [];
  let index = content.indexOf(needle);

  while (index >= 0) {
    matches.push(index);
    index = content.indexOf(needle, index + Math.max(needle.length, 1));
  }

  return matches;
}

function overlapsExisting(ranges: AiGeneratedMarkdownRange[], start: number, end: number): boolean {
  return ranges.some((range) => start < range.end && end > range.start);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
