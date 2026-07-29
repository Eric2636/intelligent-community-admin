import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeNotificationText } from '../src/modules/notification/notification-text';

test('shared notification sanitizer removes closed, unclosed, nested and cross-closed dangerous bodies', () => {
  const cases = [
    ['前<script>secret</script>后', '前后'],
    ['前<STYLE media="x">secret', '前'],
    ['前<script>one<script>two</script>three</script>后', '前后'],
    ['前<script><style>hidden</script>LEAK</style>后', '前后'],
    ['前<style><script>hidden</style>LEAK</script>后', '前后'],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(sanitizeNotificationText(input), expected);
  }
});

test('shared notification sanitizer strips markup and controls, collapses whitespace, and truncates Unicode code points', () => {
  const input = `<b> 标题 </b>\u0000\u007F\u0085\n${'😀'.repeat(80)}末`;
  const result = sanitizeNotificationText(input, 82);
  assert.equal(result, `标题 ${'😀'.repeat(79)}`);
  assert.equal(Array.from(result).length, 82);
});

test('shared notification sanitizer uses an explicit fallback only after sanitizing to empty', () => {
  assert.equal(sanitizeNotificationText('<script>secret', 80, '默认标题'), '默认标题');
  assert.equal(
    sanitizeNotificationText('<script>secret', 80, '<b>默认</b><style>hidden'),
    '默认',
  );
  assert.equal(sanitizeNotificationText('', 80), '');
});
