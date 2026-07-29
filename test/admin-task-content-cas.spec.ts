import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { HttpError } from '../src/http-error';
import { AdminService } from '../src/modules/admin/admin.service';

test('admin task content endpoint explicitly rejects workflow status edits', async () => {
  await assert.rejects(
    new AdminService().updateContentFields(
      'tasks',
      'task-1',
      { status: 'COMPLETED' },
      { adminId: 'admin-1', role: 'SUPERADMIN' },
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      /状态不能通过内容编辑/.test(error.message),
  );
});

test('admin task content branch delegates to CAS without assigning workflow status', async () => {
  const source = await readFile(
    new URL('../src/modules/admin/admin.service.ts', import.meta.url),
    'utf8',
  );
  const taskBranch = source.slice(
    source.indexOf('const existing = await tx.task.findFirst', source.indexOf("if (type === 'posts')")),
    source.indexOf("async deleteContent", source.indexOf("if (type === 'posts')")),
  );
  assert.match(taskBranch, /updateAdminTaskContentCas\(tx/);
  assert.match(taskBranch, /status:\s*existing\.status/);
  assert.match(taskBranch, /version:\s*existing\.version/);
  assert.doesNotMatch(taskBranch, /data\.status\s*=/);
});
