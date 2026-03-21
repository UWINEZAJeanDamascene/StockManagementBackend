const { spawnSync } = require('child_process');
const fs = require('fs');

const jestBin = './node_modules/jest/bin/jest.js';
const args = ['--runInBand', 'test/fixedAsset.acceptance.test.js'];

console.log('Running Jest:', jestBin, args.join(' '));

const res = spawnSync(process.execPath, [jestBin, ...args], { encoding: 'utf8', env: process.env });

const out = [];
out.push('exitCode: ' + res.status);
out.push('stdout:\n' + (res.stdout || ''));
out.push('stderr:\n' + (res.stderr || ''));

fs.writeFileSync('test_out.log', out.join('\n\n'));
console.log('Wrote test_out.log (exitCode=' + res.status + ')');
process.exit(res.status || 0);
