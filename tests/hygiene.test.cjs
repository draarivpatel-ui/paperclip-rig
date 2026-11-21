// Content checks use encoded tokens so their own source follows the same rule.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const word = (codes) => String.fromCharCode(...codes);
const blockedWords = [[65, 73], [76, 76, 77], [79, 112, 101, 110, 65, 73], [65, 110, 116, 104, 114, 111, 112, 105, 99], [67, 108, 97, 117, 100, 101], [67, 104, 97, 116, 71, 80, 84], [71, 80, 84], [71, 101, 109, 105, 110, 105], [67, 111, 100, 101, 120], [76, 108, 97, 109, 97], [77, 105, 115, 116, 114, 97, 108], [68, 101, 101, 112, 83, 101, 101, 107], [81, 119, 101, 110], [71, 114, 111, 107], [71, 114, 111, 113], [80, 101, 114, 112, 108, 101, 120, 105, 116, 121], [67, 111, 104, 101, 114, 101], [72, 117, 103, 103, 105, 110, 103, 32, 70, 97, 99, 101], [72, 117, 103, 103, 105, 110, 103, 70, 97, 99, 101], [78, 86, 73, 68, 73, 65], [71, 111, 111, 103, 108, 101], [67, 111, 112, 105, 108, 111, 116], [77, 105, 99, 114, 111, 115, 111, 102, 116], [81, 108, 111, 111], [65, 103, 101, 110, 116, 82, 111, 117, 116, 101, 114], [79, 109, 110, 105, 82, 111, 117, 116, 101], [67, 104, 97, 116, 116, 101, 114, 98, 111, 120], [67, 111, 109, 102, 121, 85, 73], [72, 105, 103, 103, 115, 102, 105, 101, 108, 100], [66, 121, 116, 101, 68, 97, 110, 99, 101], [83, 101, 101, 100, 97, 110, 99, 101], [66, 97, 114, 100], [80, 97, 76, 77], [68, 65, 76, 76, 45, 69], [66, 101, 100, 114, 111, 99, 107], [82, 101, 112, 108, 105, 99, 97, 116, 101], [79, 108, 108, 97, 109, 97], [78, 101, 98, 105, 117, 115], [83, 116, 97, 98, 105, 108, 105, 116, 121, 32, 65, 73], [86, 101, 114, 116, 101, 120, 32, 65, 73], [84, 111, 103, 101, 116, 104, 101, 114, 32, 65, 73], [77, 105, 110, 105, 77, 97, 120], [78, 101, 109, 111, 116, 114, 111, 110], [82, 101, 112, 108, 105, 116], [65, 109, 97, 122, 111, 110], [65, 122, 117, 114, 101], [67, 101, 114, 101, 98, 114, 97, 115], [83, 97, 109, 98, 97, 78, 111, 118, 97], [70, 105, 114, 101, 119, 111, 114, 107, 115], [120, 65, 73]].map(word);
const prefixes = [[115, 107, 45], [103, 104, 112, 95], [103, 105, 116, 104, 117, 98, 95, 112, 97, 116, 95], [116, 115, 107, 101, 121, 45], [120, 111, 120, 98, 45], [120, 111, 120, 112, 45], [120, 111, 120, 97, 45], [103, 115, 107, 95], [110, 118, 97, 112, 105, 45], [116, 118, 108, 121, 45], [65, 73, 122, 97], [65, 75, 73, 65], [65, 83, 73, 65], [115, 107, 45, 112, 114, 111, 106, 45], [115, 107, 45, 97, 110, 116, 45], [103, 115, 107, 45], [120, 111, 120, 114, 45], [120, 111, 120, 115, 45]].map(word);
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blocked = new RegExp('(?:^|[^a-z0-9])(?:' + blockedWords.map(escape).join('|') + ')(?=$|[^a-z0-9])', 'i');
const properName = new RegExp('\\b(?:' + [word([77,101,116,97]), word([67,117,114,115,111,114])].join('|') + ')\\b');
const dash = new RegExp('[' + word([0x2013,0x2014]) + ']|' + [word([38,109,100,97,115,104,59]),word([38,110,100,97,115,104,59]),word([38,35,56,50,49,49,59]),word([38,35,56,50,49,50,59]),word([38,35,120,50,48,49,51,59]),word([38,35,120,50,48,49,52,59])].join('|'), 'i');
const privatePath = new RegExp([word([47,85,115,101,114,115,47]),word([47,104,111,109,101,47])].map(escape).join('|'));
const privateMail = /[a-z0-9._%+-]+@(?:gmail|outlook|yahoo|icloud|hotmail)\.[a-z]+/i;
const keyPrefix = new RegExp('(?:^|[^a-z0-9])(?:' + prefixes.map(escape).join('|') + ')[a-z0-9_-]+', 'i');
const generated = /^(?:node_modules|__pycache__|\.cache|coverage|\.DS_Store|dist|build|target|\.pytest_cache|\.ruff_cache|\.mypy_cache|\.venv|venv)$/;
const root = path.resolve(__dirname, '..');
function inventory(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    if (entry.name === '.git') continue;
    const file = path.join(dir,entry.name);
    if (entry.isDirectory() && !generated.test(entry.name)) out.push(...inventory(file));
    else out.push({file,directory:entry.isDirectory(),name:entry.name});
  }
  return out;
}
const files = inventory(root);
const texts = files.filter((f) => !f.directory).flatMap((entry) => {
  const bytes=fs.readFileSync(entry.file);
  try { const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes); return text.includes('\0') ? [] : [{...entry,text}]; }
  catch { return []; }
});
const relative = (file) => path.relative(root,file);

test('Content scanner detects planted encoded names, punctuation and private fields', () => {
  for (const name of blockedWords) assert.ok(blocked.test('prefix ' + name + ' suffix'));
  assert.ok(properName.test(word([77,101,116,97])));
  assert.ok(properName.test(word([67,117,114,115,111,114])));
  for (const value of [word([0x2013]),word([0x2014]),word([38,109,100,97,115,104,59]),word([38,110,100,97,115,104,59])]) assert.ok(dash.test(value));
  assert.ok(privatePath.test(word([47,85,115,101,114,115,47])+'fixture'));
  assert.ok(privateMail.test('fixture'+word([64,103,109,97,105,108,46,99,111,109])));
  for (const prefix of prefixes) assert.ok(keyPrefix.test(prefix+'fixture'));
});

test('Every working tree text file passes the content naming and punctuation rules', () => {
  const hits=texts.filter((f) => dash.test(f.text) || blocked.test(f.text) || properName.test(f.text)).map((f)=>relative(f.file));
  assert.deepEqual(hits, [], 'Content violations are in the listed files');
});

test('Working tree text has no private email, absolute home path or credential-shaped prefix', () => {
  const hits=texts.filter((f) => privateMail.test(f.text) || privatePath.test(f.text) || keyPrefix.test(f.text)).map((f)=>relative(f.file));
  assert.deepEqual(hits, [], 'Private field violations are in the listed files');
});

test('Working tree has no temporary files or generated caches', () => {
  const hits=files.filter((f) => generated.test(f.name) || /(?:\.tmp|\.pyc|\.log|\.bak|\.swp|~)$/.test(f.name)).map((f)=>relative(f.file));
  assert.deepEqual(hits, [], 'Generated output is in the listed paths');
});
