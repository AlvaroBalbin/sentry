import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';

const [language, ...args] = process.argv.slice(2);
assert(language === 'js' || language === 'css', 'Expected js or css');

// Maintenance and inspection belong to the root policy, not package lint tasks.
const rootOnly =
  (language === 'js' &&
    ['--check', '--ci', '--enroll', '--prune', '--backlog', '--snapshot'].includes(
      args[0] ?? ''
    )) ||
  args.some(arg =>
    ['--help', '-h', '--version', '-V', '-v', '--print-config', '--rules'].includes(arg)
  );

function run(options: string[]) {
  const result = spawnSync('pnpm', options, {stdio: 'inherit'});
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

// Parse option values so repository-relative paths are never passed to packages.
const {positionals, tokens} = parseArgs({
  args: rootOnly ? [] : args,
  strict: false,
  allowPositionals: true,
  tokens: true,
  options: {
    format: {type: 'string', short: 'f'},
    formatter: {type: 'string', short: 'f'},
    threads: {type: 'string'},
    debug: {type: 'string'},
    'max-warnings': {type: 'string'},
    'report-unused-disable-directives-severity': {type: 'string'},
    config: {type: 'string', short: 'c'},
    'config-basedir': {type: 'string'},
    'custom-syntax': {type: 'string'},
    'ignore-path': {type: 'string', short: 'i'},
    'ignore-pattern': {type: 'string'},
    'cache-location': {type: 'string'},
    'cache-strategy': {type: 'string'},
    'custom-formatter': {type: 'string'},
    'output-file': {type: 'string', short: 'o'},
    'globby-options': {type: 'string'},
  },
});
const packageArgs = tokens.flatMap(token => {
  if (token.kind !== 'option') {
    return [];
  }
  return args.slice(token.index, token.index + (token.inlineValue === false ? 2 : 1));
});
const rootArgs = [...args];
if (!rootOnly) {
  if (language === 'js' && !args.includes('--no-error-on-unmatched-pattern')) {
    rootArgs.unshift('--no-error-on-unmatched-pattern');
  }
  if (language === 'css' && positionals.length === 0) {
    rootArgs.unshift('**/*.[jt]sx');
  }
}

const rootStatus = run(['run', `lint:${language}:root`, ...rootArgs]);
const packageStatus =
  rootOnly || rootStatus !== 0
    ? 0
    : run([
        '--recursive',
        '--parallel',
        '--no-bail',
        '--no-include-workspace-root',
        '--if-present',
        'run',
        `lint:${language}`,
        ...packageArgs,
      ]);
process.exitCode = rootStatus || packageStatus;
