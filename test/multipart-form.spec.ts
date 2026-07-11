import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { parseMultipartForm } from '../src/lib/multipart-form';

function multipartBody(boundary: string, parts: string[]) {
  return Buffer.from(
    parts.map((part) => `--${boundary}\r\n${part}`).join('') + `--${boundary}--\r\n`,
  );
}

function textPart(name: string, value: string) {
  return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}

function filePart(name: string, filename: string, contentType: string, value: string) {
  return [
    `Content-Disposition: form-data; name="${name}"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    '',
    `${value}\r\n`,
  ].join('\r\n');
}

test('parseMultipartForm returns text fields and uploaded file bytes', async () => {
  const boundary = 'boundary-test';
  const body = multipartBody(boundary, [
    textPart('module', 'task'),
    textPart('type', 'img'),
    filePart('file', 'note.jpg', 'image/jpeg', 'fake-image-bytes'),
  ]);

  const form = await parseMultipartForm(
    Readable.from(body),
    `multipart/form-data; boundary=${boundary}`,
    { maxBytes: 1024 },
  );

  assert.equal(form.fields.module, 'task');
  assert.equal(form.fields.type, 'img');
  assert.equal(form.files.length, 1);
  assert.equal(form.files[0].fieldName, 'file');
  assert.equal(form.files[0].filename, 'note.jpg');
  assert.equal(form.files[0].contentType, 'image/jpeg');
  assert.equal(form.files[0].buffer.toString(), 'fake-image-bytes');
});

test('parseMultipartForm rejects bodies over the byte limit', async () => {
  const boundary = 'boundary-limit';
  const body = multipartBody(boundary, [
    textPart('module', 'task'),
    filePart('file', 'large.jpg', 'image/jpeg', 'this body is larger than the limit'),
  ]);

  await assert.rejects(
    () =>
      parseMultipartForm(Readable.from(body), `multipart/form-data; boundary=${boundary}`, {
        maxBytes: 16,
      }),
    /上传文件过大/,
  );
});
