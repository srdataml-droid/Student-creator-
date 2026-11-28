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

test('content domain does not depend on provider or local-runtime implementations',async()=>{
  const files=await sourceFiles(sourceRoot);
  const violations=[];
  for(const file of files){
    const content=await readFile(file,'utf8');
    if(/from\s+['"][^'"]*\/(?:hosted-core|local-core)\/src\//.test(content))violations.push(path.relative(sourceRoot,file));
  }
  assert.deepEqual(violations,[],'domain code must receive infrastructure through injected ports');
});

test('Supabase content adapters accept auth through the composition boundary',async()=>{
  const files=['supabase-draft-store.mjs','submission-api.mjs','moderation-api.mjs'];
  for(const file of files){
    const content=await readFile(path.join(sourceRoot,file),'utf8');
    assert.doesNotMatch(content,/hosted-core\/src\/supabase-current-auth/);
    assert.match(content,/authFactory/);
  }
});
