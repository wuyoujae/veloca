import assert from 'node:assert/strict';
import test from 'node:test';
import { attachStoredReasoningToMessages } from '../backend/services/agent-reasoning.ts';

test('attaches stored DeepSeek reasoning content to assistant tool-call messages', () => {
  const messages = [
    { role: 'system', content: 'You are Veloca.' },
    { role: 'user', content: 'Search the workspace.' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: {
            name: 'grep_search',
            arguments: '{"input":{"pattern":"DeepSeek"}}'
          }
        }
      ]
    },
    { role: 'tool', content: '{"ok":true}', tool_call_id: 'call_1', name: 'grep_search' }
  ];
  const entries = [
    { role: 'user', content: 'Search the workspace.' },
    {
      role: 'assistant',
      content: '',
      reasoning_content: 'I should inspect the workspace before answering.',
      tools: {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'grep_search',
              arguments: '{"input":{"pattern":"DeepSeek"}}'
            }
          }
        ]
      }
    },
    { role: 'tool', content: '{"ok":true}' }
  ];

  const updatedMessages = attachStoredReasoningToMessages(messages, entries);

  assert.equal(updatedMessages[2].reasoning_content, 'I should inspect the workspace before answering.');
  assert.equal(updatedMessages[0].reasoning_content, undefined);
  assert.equal(updatedMessages[3].reasoning_content, undefined);
});

test('does not attach reasoning content to a different assistant tool call', () => {
  const updatedMessages = attachStoredReasoningToMessages(
    [
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } }]
      }
    ],
    [
      {
        role: 'assistant',
        content: '',
        reasoning_content: 'Reasoning for another call.',
        tools: {
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'grep_search', arguments: '{}' } }]
        }
      }
    ]
  );

  assert.equal(updatedMessages[0].reasoning_content, undefined);
});
