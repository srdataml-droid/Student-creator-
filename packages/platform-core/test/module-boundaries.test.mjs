import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sourceRoot=fileURLToPath(new URL('../src/',import.meta.url));

async function sourceFiles(directory){
  const entries=await readdir(directory,{withFileTypes:true});
  const nested=await Promise.all(entries.map(entry=>{
    const absolute=path.join(directory,entry.name);
    return entry.isDirectory()?sourceFiles(absolute):entry.isFile()&&entry.name.endsWith('.mjs')?[absolute]:[];
  }));
  return nested.flat();
}

test('platform primitives do not depend on feature or provider packages',async()=>{
  const files=await sourceFiles(sourceRoot);
  const violations=[];
  for(const file of files){
    const content=await readFile(file,'utf8');
    if(/from\s+['"][^'"]*\/packages\/(?:content-core|hosted-core|identity-core|local-core|payment-core|livekit-provider)\/src\//.test(content))violations.push(path.relative(sourceRoot,file));
  }
  assert.deepEqual(violations,[],'platform primitives must remain reusable by every feature and adapter');
});
