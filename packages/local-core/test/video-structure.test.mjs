import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {MAX_VIDEO_BYTES,readMp4Body,validateMp4,parseVideoRange} from '../src/video.mjs';
const fixture=Buffer.from(readFileSync(fileURLToPath(new URL('./fixtures/synthetic-1s.mp4.base64',import.meta.url)),'utf8'),'base64');
const box=(type,bytes=Buffer.alloc(0))=>{
  const result=Buffer.alloc(8+bytes.length);
  result.writeUInt32BE(result.length,0);
  result.write(type,4);
  bytes.copy(result,8);
  return result;
};
const broken=(buffer)=>assert.throws(()=>validateMp4(buffer),{message:'INVALID_VIDEO'});
test('accept structurally complete original MP4, optional legitimate free box',()=>{
  assert.equal(validateMp4(fixture),true);
  assert.equal(validateMp4(Buffer.concat([fixture,box('free',Buffer.from('safe'))])),true);
});
test('reject header-only spoofed MP4 previously accepted by signature-only validator',()=>{
  const fake=Buffer.alloc(64);
  fake.writeUInt32BE(24,0);fake.write('ftyp',4);fake.write('isom',8);fake.write('isom',16);
  broken(fake);
});
test('reject truncated, trailing junk and forged oversized top-level boxes',()=>{
  broken(fixture.subarray(0,fixture.length-1));
  broken(Buffer.concat([fixture,Buffer.from([0])]));
  const bad=Buffer.from(fixture);bad.writeUInt32BE(0x7fffffff,32);broken(bad);
  const badSize=Buffer.from(fixture);badSize.writeUInt32BE(4,32);broken(badSize);
});
test('reject unknown, duplicate or nonsensical box layout',()=>{
  broken(Buffer.concat([fixture,box('evil',Buffer.from('spam'))]));
  broken(Buffer.concat([fixture,fixture.subarray(0,32)]));
  const noMdat=fixture.subarray(0,fixture.length-728);broken(noMdat);
  const noMoov=Buffer.concat([fixture.subarray(0,32),fixture.subarray(829)]);broken(noMoov);
  const zeroSize=Buffer.from(fixture);zeroSize.writeUInt32BE(0,32);broken(zeroSize);
});
test('reject truncated extended-size boxes, invalid declared lengths and oversized files',()=>{
  const largeBox=Buffer.from(fixture);largeBox.writeUInt32BE(1,32);broken(largeBox);
  broken(Buffer.alloc(MAX_VIDEO_BYTES+1));
  const huge=Buffer.from(fixture);huge.writeUInt32BE(1,32);huge.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER)+1n,40);broken(huge);
});
test('readMp4Body checks missing media type, declared excessive content-length, and truncated stream',async()=>{
  const request=(headers,body)=>new Request('http://localhost/api/local/lessons/abc/video',{method:'POST',headers,body});
  await assert.rejects(()=>readMp4Body(request({'content-type':'text/plain'},fixture)),{message:'VIDEO_MP4_REQUIRED'});
  await assert.rejects(()=>readMp4Body(request({'content-type':'video/mp4','content-length':String(MAX_VIDEO_BYTES+1)},fixture)),{message:'VIDEO_TOO_LARGE'});
  await assert.rejects(()=>readMp4Body(request({'content-type':'video/mp4'},fixture.subarray(0,fixture.length-1))),{message:'INVALID_VIDEO'});
  assert.deepEqual(await readMp4Body(request({'content-type':'video/mp4'},fixture)),fixture);
});
test('invalid range sizes, malformed bytes and large integers do not escape range validation',()=>{
  assert.equal(parseVideoRange(null,0),null);
  assert.equal(parseVideoRange(null,NaN),null);
  assert.equal(parseVideoRange('bytes=999999999999999999999999-',10),null);
  assert.deepEqual(parseVideoRange('bytes=0-3',10),{start:0,end:3,status:206});
});
