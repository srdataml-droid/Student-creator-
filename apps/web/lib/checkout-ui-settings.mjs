/** Public checkout UI settings only. The backend still authorizes every order. */
export function checkoutSettings(env=process.env){
 if(env.APP_DATA_MODE!=='hosted'||env.STUDENT_CREATORS_DISTRIBUTION_CHANNEL!=='independent_web')return {mode:'disabled'};
 if(env.STUDENT_CREATORS_ENVIRONMENT==='production'&&env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED==='true'&&env.PAYSTACK_LIVE_PAYMENTS_ENABLED==='1'&&env.STUDENT_CREATORS_LIVE_DELIVERY_APPROVED==='true'&&env.STUDENT_CREATORS_LIVE_REVERSAL_APPROVED==='true'&&env.STUDENT_CREATORS_LIVE_PROVIDER_APPROVED==='true'&&env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED!=='true'){
  const version=env.STUDENT_CREATORS_CHECKOUT_TERMS_VERSION,text=env.STUDENT_CREATORS_CHECKOUT_TERMS_TEXT;
  if(/^[A-Za-z0-9._-]{3,128}$/.test(version||'')&&typeof text==='string'&&text.trim().length>=100&&text.length<=12000)return {mode:'live',terms:{version,text}};
 }
 if(env.STUDENT_CREATORS_STAGING_APPROVED==='true'&&env.STUDENT_CREATORS_PAYSTACK_TEST_ENABLED==='true'&&env.STUDENT_CREATORS_REAL_PAYMENT_ENABLED==='false'&&env.STUDENT_CREATORS_ENVIRONMENT!=='production')return {mode:'test'};
 return {mode:'disabled'};
}
