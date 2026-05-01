import assert from 'node:assert/strict';
import test from 'node:test';
import { mapStoredEntriesToConversations } from '../backend/services/agent-history.ts';

test('restores Agent thinking and tool timeline from stored session entries', () => {
  const conversations = mapStoredEntriesToConversations('session-restore', [
    {
      content: 'Run pwd',
      entry_id: 'user-1',
      role: 'user'
    },
    {
      content: 'I will inspect the workspace.',
      entry_id: 'assistant-1',
      reasoning_content: 'The user needs command execution evidence.',
      role: 'assistant',
      tools: {
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: {
              name: 'run_bash_command',
              arguments: '{"input":{"command":"pwd"}}'
            }
          }
        ]
      }
    },
    {
      content: '{"ok":true,"stdout":"/tmp/workspace\\n"}',
      entry_id: 'tool-1',
      role: 'tool',
      tools: {
        function_name: 'run_bash_command',
        result: {
          blocked: false,
          cwd: '/tmp/workspace',
          durationMs: 4,
          exitCode: 0,
          ok: true,
          stderr: '',
          stdout: '/tmp/workspace\n',
          timedOut: false
        },
        tool_call_id: 'call_1'
      }
    },
    {
      content: 'The workspace path is `/tmp/workspace`.',
      entry_id: 'assistant-2',
      role: 'assistant'
    }
  ]);

  assert.equal(conversations.length, 1);
  assert.equal(conversations[0].answer, 'I will inspect the workspace.\n\nThe workspace path is `/tmp/workspace`.');
  assert.deepEqual(
    conversations[0].responseParts?.map((part) => part.type),
    ['thinking', 'text', 'tool', 'text']
  );
  assert.equal(conversations[0].responseParts?.[0].item.action, 'Thinking');
  assert.equal(conversations[0].responseParts?.[2].item.action, 'Run command');
  assert.equal(conversations[0].responseParts?.[2].item.openable, true);
  assert.match(conversations[0].responseParts?.[2].item.detail ?? '', /stdout\n\/tmp\/workspace/);
});
