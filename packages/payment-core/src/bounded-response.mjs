export async function readBoundedGatewayResponse(res, maxBytes, error) {
  const reader = res.body?.getReader?.();
  if (!reader) {
    const raw = await res.text();
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > maxBytes) throw error();
    return raw;
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let total = 0;
  let raw = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw error();
      raw += decoder.decode(value, { stream: true });
    }
    return raw + decoder.decode();
  } catch (err) {
    // Do not wait for a potentially stalled upstream cancellation.
    void reader.cancel().catch(() => {});
    if (err instanceof TypeError) throw error();
    throw err;
  } finally {
    reader.releaseLock();
  }
}
