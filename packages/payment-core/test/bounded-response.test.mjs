import test from 'node:test';
import assert from 'node:assert/strict';
import { readBoundedGatewayResponse } from '../src/bounded-response.mjs';
const limit = 256 * 1024;
const error = () => Object.assign(new Error('Invalid or oversized payment response'), {code:'BAD_GATEWAY_RESPONSE'});
const read = res => readBoundedGatewayResponse(res, limit, error);
test('normal JSON and multibyte characters split across chunks', async () => {
  const raw = '{"message":"₦200"}';
  const bytes = new TextEncoder().encode(raw);
  const body = new ReadableStream({start(c){for(const b of bytes)c.enqueue(Uint8Array.of(b));c.close();}});
  assert.equal(await read(new Response(body)), raw);
});
test('exact byte boundary accepted', async () => {
  assert.equal((await read(new Response('x'.repeat(limit)))).length, limit);
});
test('oversize streamed body is cancelled before buffering remaining chunks', async () => {
  let cancelled = false;
  const body = new ReadableStream({start(c){c.enqueue(new Uint8Array(limit));c.enqueue(new Uint8Array(1));},cancel(){cancelled=true;}});
  await assert.rejects(read(new Response(body)), {code:'BAD_GATEWAY_RESPONSE'});
  assert.equal(cancelled,true);
});
test('text-only mock byte limit rejects multibyte oversize', async () => {
  await assert.rejects(read({text:async()=> '₦'.repeat(limit/2)}), {code:'BAD_GATEWAY_RESPONSE'});
});
test('invalid UTF-8 fails closed', async () => {
  await assert.rejects(read(new Response(Uint8Array.of(0xff))), {code:'BAD_GATEWAY_RESPONSE'});
});
test('aborted body preserves AbortError for gateway timeout handling', async () => {
  const body = new ReadableStream({start(c){c.error(new DOMException('aborted','AbortError'));}});
  await assert.rejects(read(new Response(body)), {name:'AbortError'});
});
