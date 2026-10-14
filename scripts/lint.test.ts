import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const runner = path.join(root, 'scripts/lint.ts');

function fixture(t: {after: (cleanup: () => void) => void}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'workspace-lint-'));
  t.after(() => rmSync(directory, {recursive: true, force: true}));
  const write = (file: string, contents: string) => {
    mkdirSync(path.dirname(path.join(directory, file)), {recursive: true});
    writeFileSync(path.join(directory, file), contents);
  };
  write(
    'pnpm-workspace.yaml',
    'packages: [packages/*]\nincludeWorkspaceRoot: true\nverifyDepsBeforeRun: false\n'
  );
  write(
    'record.mjs',
    `import {appendFileSync, readFileSync} from 'node:fs';
    const {name} = JSON.parse(readFileSync('package.json', 'utf8'));
    appendFileSync(${JSON.stringify(path.join(directory, 'runs.jsonl'))},
      JSON.stringify({name, args: process.argv.slice(2)}) + '\\n');
    process.exitCode = process.env.FAIL_WORKSPACE === name ? 1 : 0;`
  );
  write(
    'package.json',
    JSON.stringify({
      name: 'root',
      private: true,
      scripts: {
        'lint:js:root': 'node record.mjs',
        'lint:css:root': 'node record.mjs',
      },
    })
  );
  for (const name of ['icons', 'scraps', 'unmigrated']) {
    write(
      `packages/${name}/package.json`,
      JSON.stringify({
        name,
        scripts:
          name === 'unmigrated'
            ? {}
            : {
                'lint:js': 'node ../../record.mjs',
                'lint:css': 'node ../../record.mjs',
              },
      })
    );
  }
  return {
    lint: (language: string, args: string[] = [], failWorkspace = '') => {
      const result = spawnSync(process.execPath, [runner, language, ...args], {
        cwd: directory,
        encoding: 'utf8',
        env: {...process.env, FAIL_WORKSPACE: failWorkspace},
      });
      const runs = readFileSync(path.join(directory, 'runs.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => JSON.parse(line) as {args: string[]; name: string});
      return {...result, runs};
    },
  };
}

test('root JS lint invokes every package with a task from its own directory', t => {
  const {lint} = fixture(t);
  const result = lint('js', ['--quiet', '--fix', 'static/app/example.tsx']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.runs[0], {
    name: 'root',
    args: [
      '--no-error-on-unmatched-pattern',
      '--quiet',
      '--fix',
      'static/app/example.tsx',
    ],
  });
  assert.deepEqual(
    result.runs.slice(1).sort((a, b) => a.name.localeCompare(b.name)),
    [
      {name: 'icons', args: ['--quiet', '--fix']},
      {name: 'scraps', args: ['--quiet', '--fix']},
    ]
  );
});

test('native option values reach package tasks without root file paths', t => {
  const {lint} = fixture(t);
  const result = lint('js', [
    '--format',
    'json',
    '--threads=1',
    'static/app/example.tsx',
  ]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const run of result.runs.slice(1)) {
    assert.deepEqual(run.args, ['--format', 'json', '--threads=1']);
  }
});

test('CSS lint defaults to a full root scan and invokes package tasks', t => {
  const {lint} = fixture(t);
  const result = lint('css', ['--formatter', 'compact']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.runs[0]!.args, ['**/*.[jt]sx', '--formatter', 'compact']);
  assert.equal(result.runs.length, 3);
});

test('CSS hook file arguments scope only the root scan', t => {
  const {lint} = fixture(t);
  const result = lint('css', ['--quiet', 'static/packages/icons/src/example.tsx']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(result.runs[0]!.args, [
    '--quiet',
    'static/packages/icons/src/example.tsx',
  ]);
  for (const run of result.runs.slice(1)) {
    assert.deepEqual(run.args, ['--quiet']);
  }
});

test('suppression maintenance and config inspection do not invoke package tasks', t => {
  for (const args of [['--ci', '--base', 'HEAD'], ['--prune'], ['--print-config']]) {
    const {lint} = fixture(t);
    const result = lint('js', args);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(result.runs, [{name: 'root', args}]);
  }
});

test('package failures fail the root command while other packages still run', t => {
  const {lint} = fixture(t);
  const result = lint('js', [], 'icons');
  assert.notEqual(result.status, 0);
  assert.equal(result.runs.length, 3, result.stdout + result.stderr);
});

test('root failures stop before package tasks run', t => {
  const {lint} = fixture(t);
  const result = lint('js', ['--fix'], 'root');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.runs, [
    {name: 'root', args: ['--no-error-on-unmatched-pattern', '--fix']},
  ]);
});
