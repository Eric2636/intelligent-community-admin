import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Dockerfile keeps a Prisma migration stage before production dependencies are pruned', () => {
  const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  const migrationStage = dockerfile.indexOf('FROM builder AS migration');
  const runtimeStage = dockerfile.indexOf('FROM builder AS runtime-builder');
  const pruneStep = dockerfile.indexOf('RUN npm prune --omit=dev');

  assert.ok(migrationStage >= 0, 'expected a dedicated migration stage');
  assert.ok(runtimeStage > migrationStage, 'runtime stage must be created after migration stage');
  assert.ok(pruneStep > runtimeStage, 'dependency pruning must only happen in the runtime stage');
  assert.match(dockerfile, /COPY --from=runtime-builder \/app\/node_modules \.\/node_modules/);
});
