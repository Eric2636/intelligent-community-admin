import assert from 'node:assert/strict';
import test from 'node:test';
import { openApiDocument } from '../src/swagger/openapi';

type Operation = {
  description?: string;
  security?: Array<Record<string, unknown>>;
};

type OpenApiPaths = Record<string, Record<string, Operation>>;

const paths = openApiDocument.paths as OpenApiPaths;
const optionalBearer = [{}, { bearerAuth: [] }];

test('OpenAPI matches public and optionally personalized read routes', () => {
  assert.deepEqual(paths['/api/posts'].get.security, optionalBearer);
  assert.deepEqual(paths['/api/posts/{postId}'].get.security, optionalBearer);
  assert.equal(paths['/api/app-settings/module-entry-tabs'].get.security, undefined);

  assert.equal(paths['/api/tasks'].get.security, undefined);
  assert.equal(paths['/api/tasks/list'].post.security, undefined);
  assert.equal(paths['/api/tasks/{taskId}'].get.security, undefined);
});
