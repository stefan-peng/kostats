import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';

const root = fileURLToPath(new URL('../../', import.meta.url));
const result = spawnSync('uv', ['run', '--no-sync', 'python', '-m', 'backend.app.openapi'], {
  cwd: root, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024,
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(result.stderr);
const source = astToString(await openapiTS(JSON.parse(result.stdout), { defaultNonNullable: false }));
const output = new URL('../src/api.generated.ts', import.meta.url);
if (process.argv.includes('--check')) {
  if (readFileSync(output, 'utf-8') !== source) {
    throw new Error('API types are stale. Run npm run generate:types.');
  }
} else {
  writeFileSync(output, source);
}
