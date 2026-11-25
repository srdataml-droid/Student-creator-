/** Pure, server-only payout review contract. Does not reserve or transfer money.
 * Inputs MUST be loaded by the trusted finance service, not from client JSON.
 * All amounts are integer kobo; pending earnings never count as cleared funds.
 * No policy defaults and no live release path are provided by this module.
 */
export class PayoutPolicyError extends Error {
 constructor(code){super(code);this.name='PayoutPolicyError';this.code=code;}
}
const fail=code=>{throw new PayoutPolicyError(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(x);
const amount=x=>Number.isSafeInteger(x)&&x>=0;
export function assessPayout({policy,creator,balance,requestedKobo}={}){
 if(!policy||policy.approved!==true||!id(policy.version)||policy.environment!=='test')fail('PAYOUT_POLICY_UNAPPROVED');
 if(!amount(policy.minimumKobo)||policy.minimumKobo===0||!amount(policy.maximumKobo)||policy.maximumKobo<policy.minimumKobo)fail('INVALID_PAYOUT_POLICY');
 if(!id(creator?.id)||creator.eligible!==true||creator.kycVerified!==true||creator.payoutAccountVerified!==true)fail('CREATOR_NOT_ELIGIBLE');
 if(!balance||balance.creatorId!==creator.id||balance.currency!=='NGN'||balance.environment!=='test'||balance.reconciled!==true||!id(balance.revision))fail('BALANCE_UNVERIFIED');
 if(!amount(balance.clearedKobo)||!amount(balance.reservedKobo)||balance.reservedKobo>balance.clearedKobo)fail('INVALID_CLEARED_BALANCE');
 if(!amount(requestedKobo)||requestedKobo<policy.minimumKobo||requestedKobo>policy.maximumKobo)fail('PAYOUT_AMOUNT_OUTSIDE_POLICY');
 const availableKobo=balance.clearedKobo-balance.reservedKobo;
 if(requestedKobo>availableKobo)fail('INSUFFICIENT_CLEARED_BALANCE');
 return Object.freeze({creatorId:creator.id,requestedKobo,currency:'NGN',environment:'test',policyVersion:policy.version,balanceRevision:balance.revision,availableKobo,status:'eligible_for_review',transferEnabled:false});
}
/** A second trusted review must reread policy, identity and cleared balance.
 * This is a proposal only: an atomic database transaction must check revision,
 * reserve cleared funds, and persist approval/audit before changing real state.
 */
export function approvePayoutReview({request,reviewer,policy,creator,balance}={}){
 if(!request||request.status!=='pending_review'||!id(request.id)||request.environment!=='test'||request.currency!=='NGN')fail('INVALID_PAYOUT_REQUEST');
 if(!id(reviewer?.id)||reviewer.active!==true||reviewer.canApprovePayout!==true||reviewer.id===request.creatorId)fail('PAYOUT_APPROVAL_FORBIDDEN');
 if(creator?.id!==request.creatorId)fail('CREATOR_MISMATCH');
 if(policy?.version!==request.policyVersion)fail('PAYOUT_POLICY_CHANGED');
 const result=assessPayout({policy,creator,balance,requestedKobo:request.requestedKobo});
 return Object.freeze({requestId:request.id,creatorId:result.creatorId,reviewerId:reviewer.id,requestedKobo:result.requestedKobo,currency:'NGN',environment:'test',policyVersion:result.policyVersion,expectedBalanceRevision:result.balanceRevision,status:'approved_for_reservation',transferEnabled:false});
}
