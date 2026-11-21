/**
 * Student Creators Platform — provider-agnostic sale allocation arithmetic.
 *
 * This is NOT a checkout, earnings balance, bank payout, subscription engine,
 * webhook verifier or money transfer. Only a trusted backend may supply fees,
 * fee policy and creator identities. No default commission is chosen.
 */

const MIN_PAID_KOBO = 20_000;
const PRODUCT_TYPES = new Set(['paid_post', 'creator_subscription', 'tutoring_session']);
const FEE_BEARERS = new Set(['platform', 'creator', 'proportional']);

export class CreatorSaleError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CreatorSaleError';
    this.code = code;
  }
}

function kobo(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CreatorSaleError(`INVALID_${label.toUpperCase()}`);
  }
}

function safeId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}

/**
 * Immutable backend-authoritative quote of purchase + creator/platform split.
 * Platform commission and fee-bearing rules MUST be explicitly approved by
 * the business owner; neither is implicitly set to 10% or any other value.
 */
export function quoteCreatorSale({productId, creatorId, productType, amountKobo,
  platformFeeBps, feeBearer} = {}) {
  if (!safeId(productId) || !safeId(creatorId)) throw new CreatorSaleError('INVALID_PARTIES');
  if (!PRODUCT_TYPES.has(productType)) throw new CreatorSaleError('INVALID_PRODUCT_TYPE');
  kobo(amountKobo, 'AMOUNT');
  if (amountKobo < MIN_PAID_KOBO) throw new CreatorSaleError('BELOW_MINIMUM_PRICE');
  if (!Number.isSafeInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps >= 10_000) {
    throw new CreatorSaleError('INVALID_PLATFORM_FEE');
  }
  if (!FEE_BEARERS.has(feeBearer)) throw new CreatorSaleError('INVALID_FEE_BEARER');

  // Deterministic half-up rounding using integer arithmetic, never floats.
  const platformGrossKobo = Number((BigInt(amountKobo) * BigInt(platformFeeBps) + 5000n) / 10000n);
  return Object.freeze({
    productId, creatorId, productType, currency: 'NGN', amountKobo,
    platformFeeBps, feeBearer, platformGrossKobo,
    creatorGrossKobo: amountKobo - platformGrossKobo,
  });
}

/**
 * Allocate an *already verified* settlement fee; an integration must validate
 * provider transaction + settlement evidence and write accounting atomically.
 * This function performs no side effects and does not declare funds paid out.
 */
export function allocateCreatorSettlement(quote, actualProviderFeeKobo) {
  if (!quote || typeof quote !== 'object' || !safeId(quote.productId) || !safeId(quote.creatorId) ||
      !PRODUCT_TYPES.has(quote.productType) || quote.currency !== 'NGN' ||
      !FEE_BEARERS.has(quote.feeBearer)) {
    throw new CreatorSaleError('INVALID_QUOTE');
  }
  kobo(quote.amountKobo, 'AMOUNT');
  kobo(quote.platformGrossKobo, 'PLATFORM_GROSS');
  kobo(quote.creatorGrossKobo, 'CREATOR_GROSS');
  kobo(actualProviderFeeKobo, 'PROVIDER_FEE');
  if (quote.amountKobo < MIN_PAID_KOBO ||
      quote.platformGrossKobo + quote.creatorGrossKobo !== quote.amountKobo ||
      actualProviderFeeKobo > quote.amountKobo ||
      !Number.isSafeInteger(quote.platformFeeBps) ||
      quote.platformFeeBps < 0 || quote.platformFeeBps >= 10_000 ||
      quote.platformGrossKobo !== Number((BigInt(quote.amountKobo) * BigInt(quote.platformFeeBps) + 5000n) / 10000n)) {
    throw new CreatorSaleError('INVALID_QUOTE');
  }

  let platformFeeShareKobo = 0;
  if (quote.feeBearer === 'platform') platformFeeShareKobo = actualProviderFeeKobo;
  if (quote.feeBearer === 'proportional') {
    platformFeeShareKobo = Number((BigInt(actualProviderFeeKobo) * BigInt(quote.platformGrossKobo) + BigInt(Math.floor(quote.amountKobo / 2))) / BigInt(quote.amountKobo));
  }
  const creatorFeeShareKobo = actualProviderFeeKobo - platformFeeShareKobo;
  const platformNetKobo = quote.platformGrossKobo - platformFeeShareKobo;
  const creatorNetKobo = quote.creatorGrossKobo - creatorFeeShareKobo;
  if (platformNetKobo < 0 || creatorNetKobo < 0) throw new CreatorSaleError('FEE_EXCEEDS_ALLOCATION');

  return Object.freeze({
    productId: quote.productId, creatorId: quote.creatorId,
    productType: quote.productType, currency: 'NGN', grossKobo: quote.amountKobo,
    providerFeeKobo: actualProviderFeeKobo, platformFeeShareKobo, creatorFeeShareKobo,
    platformNetKobo, creatorNetKobo, totalNetKobo: quote.amountKobo - actualProviderFeeKobo,
  });
}
