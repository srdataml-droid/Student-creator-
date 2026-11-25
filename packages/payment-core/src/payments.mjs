import { createHmac, timingSafeEqual } from 'node:crypto';

export const MIN_PRICE_KOBO = 20_000; // ₦200; config decision from owner.
const MAX_WEBHOOK_BYTES = 1024 * 1024;

export class PaymentValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PaymentValidationError';
    this.code = code;
  }
}

function checkKobo(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PaymentValidationError('INVALID_AMOUNT', `${name} must be a nonnegative safe integer in kobo`);
  }
}

/** Internal allocation only: callers must supply explicit terms. No commission default.
 * Gateway/settlement fees must be tracked separately. */
export function quoteLessonPurchase(amountKobo, platformFeeBps) {
  checkKobo(amountKobo, 'amountKobo');
  if (amountKobo < MIN_PRICE_KOBO) {
    throw new PaymentValidationError('BELOW_MINIMUM_PRICE', 'Paid lessons must cost at least ₦200');
  }
  if (!Number.isSafeInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
    throw new PaymentValidationError('INVALID_COMMISSION', 'platformFeeBps must be between 0 and 10000');
  }
  const platformFeeKobo = Number((BigInt(amountKobo) * BigInt(platformFeeBps) + 5000n) / 10_000n);
  return Object.freeze({
    currency: 'NGN', amountKobo, platformFeeBps,
    platformFeeKobo, creatorGrossShareKobo: amountKobo - platformFeeKobo,
  });
}

/**
 * Verify the legacy x-paystack-signature: HMAC-SHA512 over the exact raw body.
 * NEVER sign JSON.stringify(parsedBody). Can accept multiple rotating secrets.
 * Verify against current Paystack documentation before production deployment.
 */
export function verifyLegacyPaystackSignature(rawBody, signature, secrets) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : null;
  if (!body || body.length === 0 || body.length > MAX_WEBHOOK_BYTES) return false;
  if (typeof signature !== 'string' || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  if (!Array.isArray(secrets) || secrets.length === 0) return false;
  const received = Buffer.from(signature.toLowerCase(), 'hex');
  let match = 0;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    const expected = createHmac('sha512', secret).update(body).digest();
    match |= Number(timingSafeEqual(received, expected));
  }
  return Boolean(match);
}

/** Signature checks establish delivery origin, not payment/fulfillment authority. */
export function decodeVerifiedLegacyWebhook(rawBody, signature, secrets) {
  if (!verifyLegacyPaystackSignature(rawBody, signature, secrets)) {
    throw new PaymentValidationError('INVALID_SIGNATURE', 'Webhook signature is missing or invalid');
  }
  let payload;
  try { payload = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody); }
  catch { throw new PaymentValidationError('BAD_JSON', 'Signed body is not valid JSON'); }
  if (!payload || typeof payload !== 'object' || typeof payload.event !== 'string' || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new PaymentValidationError('INVALID_EVENT', 'Webhook payload is missing required fields');
  }
  return { event: payload.event, data: payload.data };
}

/**
 * ONLY server-side Paystack transaction/verify response can support fulfillment.
 * The caller must then atomically update order, entitlement, ledger and audit in
 * a PostgreSQL transaction with row locks and unique constraints. This function
 * performs no writes and is safe for retries.
 */
export function validateVerifiedCharge(order, verificationResponse) {
  if (!order || typeof order !== 'object' || typeof order.reference !== 'string' || !order.reference || typeof order.buyerEmail !== 'string' || !order.buyerEmail.trim()) {
    throw new PaymentValidationError('INVALID_ORDER', 'Expected trusted server-side order snapshot');
  }
  checkKobo(order.amountKobo, 'order.amountKobo');
  if (order.amountKobo < MIN_PRICE_KOBO) throw new PaymentValidationError('BELOW_MINIMUM_PRICE', 'Paid orders must cost at least ₦200');
  if (!['test', 'live'].includes(order.domain)) {
    throw new PaymentValidationError('INVALID_ORDER', 'Order must declare its payment environment');
  }
  if (verificationResponse?.status !== true || verificationResponse?.data?.status !== 'success') {
    throw new PaymentValidationError('NOT_PAID', 'Provider has not confirmed a successful charge');
  }
  const data = verificationResponse.data;
  if (data.reference !== order.reference) throw new PaymentValidationError('REFERENCE_MISMATCH', 'Payment reference differs from order');
  if (!Number.isSafeInteger(data.amount) || data.amount !== order.amountKobo) throw new PaymentValidationError('AMOUNT_MISMATCH', 'Payment amount differs from order');
  if (data.currency !== 'NGN') throw new PaymentValidationError('CURRENCY_MISMATCH', 'Payment currency is not NGN');
  if (data.domain !== order.domain) throw new PaymentValidationError('ENVIRONMENT_MISMATCH', 'Provider environment differs from order');
  if (typeof data.customer?.email !== 'string' || data.customer.email.trim().toLowerCase() !== order.buyerEmail.trim().toLowerCase()) {
    throw new PaymentValidationError('BUYER_MISMATCH', 'Provider buyer identity differs from order');
  }
  if ((typeof data.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.id)) && (typeof data.id !== 'number' || !Number.isSafeInteger(data.id) || data.id <= 0)) {
    throw new PaymentValidationError('MISSING_TRANSACTION_ID', 'Provider transaction ID missing');
  }
  if (order.domain==='live' && data.fees==null) throw new PaymentValidationError('MISSING_PROVIDER_FEE', 'Live verification must declare provider fees');
  if (data.fees != null && (!Number.isSafeInteger(data.fees) || data.fees < 0 || data.fees > data.amount)) throw new PaymentValidationError('INVALID_PROVIDER_FEE', 'Provider fee must be valid integer kobo');
  return Object.freeze({ reference: order.reference, providerTransactionId: String(data.id), amountKobo: data.amount, currency: 'NGN', domain: data.domain, providerFeeKobo: data.fees ?? 0 });
}
