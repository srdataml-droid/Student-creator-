import { PaymentValidationError, validateVerifiedCharge } from './payments.mjs';

const PAYSTACK_API_ORIGIN = 'https://api.paystack.co';
const MAX_GATEWAY_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Server-only Paystack adapter. This module does not persist orders or grant
 * entitlements. Caller must snapshot order, verify return and atomically settle
 * the entitlement/ledger in Postgres. Do not invoke from a browser.
 */
export class PaystackGatewayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaystackGatewayError';
    this.code = code;
  }
}

function assertOrder(order) {
  if (!order || typeof order !== 'object' || !Number.isSafeInteger(order.amountKobo) || order.amountKobo < 20_000 ||
      typeof order.reference !== 'string' || !/^[A-Za-z0-9._-]{8,160}$/.test(order.reference) ||
      typeof order.buyerEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(order.buyerEmail) ||
      !['test','live'].includes(order.domain)) {
    throw new PaystackGatewayError('BAD_ORDER', 'Invalid trusted order snapshot');
  }
}

export function createPaystackClient({ secretKey, environment, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof secretKey !== 'string' || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new PaystackGatewayError('BAD_CONFIGURATION', 'Missing or invalid Paystack server secret');
  }
  if (!['test', 'live'].includes(environment) || !secretKey.startsWith(`sk_${environment}_`)) {
    throw new PaystackGatewayError('BAD_CONFIGURATION', 'Key and payment environment disagree');
  }
  if (typeof fetchImpl !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new PaystackGatewayError('BAD_CONFIGURATION', 'Invalid gateway transport configuration');
  }

  async function request(path, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${PAYSTACK_API_ORIGIN}${path}`, {
        method,
        headers: { Authorization: `Bearer ${secretKey}`, Accept: 'application/json', ...(body ? {'Content-Type':'application/json'} : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
        redirect: 'error',
      });
      if (!res || typeof res.ok !== 'boolean' || typeof res.text !== 'function') {
        throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Invalid payment provider response');
      }
      // Read one text response; never print it to logs because it may contain PII.
      const raw = await res.text();
      if (raw.length > MAX_GATEWAY_RESPONSE_BYTES) throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Unexpected large provider response');
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Payment provider returned invalid JSON'); }
      if (!res.ok) {
        throw new PaystackGatewayError('GATEWAY_HTTP_ERROR', `Payment provider request failed (HTTP ${res.status || 'unknown'})`);
      }
      if (!parsed || typeof parsed !== 'object' || parsed.status !== true || !parsed.data || typeof parsed.data !== 'object') {
        throw new PaystackGatewayError('GATEWAY_REJECTED', 'Payment provider did not accept the request');
      }
      return parsed;
    } catch (err) {
      if (err instanceof PaystackGatewayError) throw err;
      if (err?.name === 'AbortError') throw new PaystackGatewayError('GATEWAY_TIMEOUT', 'Payment provider response timed out; reconcile before retrying');
      throw new PaystackGatewayError('GATEWAY_NETWORK_ERROR', 'Payment provider cannot be reached; reconcile before retrying');
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    /** Payment init must only be called with a trusted persisted order snapshot. */
    async initialize(order) {
      assertOrder(order);
      if (order.domain !== environment) throw new PaystackGatewayError('BAD_ORDER', 'Order is in the wrong environment');
      const response = await request('/transaction/initialize', {
        method: 'POST',
        body: {
          email: order.buyerEmail,
          amount: order.amountKobo,
          currency: 'NGN',
          reference: order.reference,
          channels: ['card', 'bank', 'ussd', 'bank_transfer'],
        },
      });
      if (typeof response.data.authorization_url !== 'string' || typeof response.data.reference !== 'string' ||
          response.data.reference !== order.reference) {
        throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Paystack initialization reference mismatch');
      }
      let url;
      try { url = new URL(response.data.authorization_url); }
      catch { throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Invalid checkout URL'); }
      if (url.protocol !== 'https:' || !['checkout.paystack.com', 'paystack.com'].includes(url.hostname)) {
        throw new PaystackGatewayError('BAD_GATEWAY_RESPONSE', 'Untrusted checkout destination');
      }
      return Object.freeze({ reference: order.reference, authorizationUrl: url.toString() });
    },
    /** Verify using server-side provider response. Never trust client callback params. */
    async verify(order) {
      assertOrder(order);
      if (order.domain !== environment) throw new PaystackGatewayError('BAD_ORDER', 'Order is in the wrong environment');
      const response = await request(`/transaction/verify/${encodeURIComponent(order.reference)}`);
      try { return validateVerifiedCharge(order, response); }
      catch (err) {
        if (err instanceof PaymentValidationError) {
          throw new PaystackGatewayError(err.code, 'Provider verification did not match the trusted order');
        }
        throw err;
      }
    },
  });
}
