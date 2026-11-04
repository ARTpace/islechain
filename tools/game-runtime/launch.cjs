/* The host registers this process in its owned job/group before sending argv. */
'use strict';
const {spawn} = require('node:child_process');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  input += chunk;
  if (Buffer.byteLength(input) > 512 * 1024) process.exit(2);
});
process.stdin.on('end', () => {
  try {
    const {argv, stdin} = JSON.parse(input);
    if (!Array.isArray(argv) || !argv.length || !argv.every(v => typeof v === 'string')) process.exit(2);
    const child = spawn(argv[0], argv.slice(1), {shell:false, windowsHide:true, stdio:['pipe','inherit','inherit']});
    child.on('error', () => process.exit(2));
    child.on('exit', code => process.exit(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(typeof stdin === 'string' ? stdin : '');
  } catch (_) { process.exit(2); }
});
