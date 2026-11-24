import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {
 institutionalSubjectDigest,validateInstitutionRegistryEntry,signSyntheticInstitutionAssertion,
 verifySignedInstitutionAssertion,makeSyntheticInstitutionProvider,makeAuthorizedRestProvider,
 verifyOidcInstitutionToken,verifySamlInstitutionResponse,isVerifiedInstitutionEvidence
} from '../src/institutions.mjs';

const school=randomUUID(),providerId='official_synthetic_registry',secret='synthetic_institution_only_secret_not_a_real_credential_2026';
const digest=institutionalSubjectDigest(secret,school,'STUDENT-001');
const now=1795500000;
const config={institutionId:school,providerId,kind:'synthetic'};
const requestId=randomUUID();
const payload=(overrides={})=>({institutionId:school,providerId,requestId,subjectDigest:digest,role:'student',state:'active',issuedAt:now,expiresAt:now+3600,...overrides});
const proof=(p,overrides={})=>verifySignedInstitutionAssertion({config,secret,payload:p,signature:signSyntheticInstitutionAssertion(secret,p),requestId,now,...overrides});

test('signed institution proof uses a private subject digest, strict tenant/nonce/expiry and cannot be forged by JSON',()=>{
 assert.match(digest,/^[0-9a-f]{64}$/);
 assert.notEqual(digest,institutionalSubjectDigest(secret,randomUUID(),'STUDENT-001'));
 assert.notEqual(digest,institutionalSubjectDigest(secret,school,'STUDENT-002'));
 assert.equal(isVerifiedInstitutionEvidence(payload()),false);
 assert.equal(isVerifiedInstitutionEvidence({...payload(),eligible:true}),false);
 const accepted=proof(payload());assert.equal(accepted.eligible,true);
 assert.equal(isVerifiedInstitutionEvidence(accepted),true);
 assert.equal(isVerifiedInstitutionEvidence({...accepted}),false);
 assert.equal(Object.keys(accepted).includes('legalName'),false);
 assert.equal(JSON.stringify(accepted).includes('STUDENT-001'),false);
 const signed=signSyntheticInstitutionAssertion(secret,payload());
 for(const mutation of [
  {subjectDigest:institutionalSubjectDigest(secret,school,'OTHER-009')},
  {role:'lecturer'},{state:'suspended'},{expiresAt:now+7000},{institutionId:randomUUID()}
 ]){
  assert.throws(()=>verifySignedInstitutionAssertion({config,secret,payload:payload(mutation),signature:signed,requestId,now}),{code:'IDENTITY_BAD_SIGNATURE'});
 }
 assert.throws(()=>proof(payload({requestId:randomUUID()})),{code:'IDENTITY_RESPONSE_MISMATCH'});
 assert.throws(()=>proof(payload({institutionId:randomUUID()})),{code:'IDENTITY_RESPONSE_MISMATCH'});
 assert.throws(()=>proof(payload({issuedAt:now-2*24*3600,expiresAt:now-10})),{code:'IDENTITY_INVALID_EVIDENCE'});
 assert.throws(()=>proof(payload({expiresAt:now+8*24*3600})),{code:'IDENTITY_INVALID_EVIDENCE'});
 assert.throws(()=>verifySignedInstitutionAssertion({config,secret,payload:payload(),signature:'f'.repeat(64),requestId,now}),{code:'IDENTITY_BAD_SIGNATURE'});
});
test('student, suspended, alumni, graduate and lecturer classes cannot elevate privileges',()=>{
 for(const [role,state,eligible] of [
 ['student','active',true],['student','suspended',false],['student','graduated',false],
 ['alumni','active',false],['lecturer','active',false],['student','inactive',false]
 ])assert.equal(proof(payload({role,state})).eligible,eligible);
 assert.throws(()=>proof(payload({role:'admin'})),{code:'IDENTITY_INVALID_EVIDENCE'});
 assert.throws(()=>proof(payload({state:'approved_by_browser'})),{code:'IDENTITY_INVALID_EVIDENCE'});
});
test('approved synthetic provider returns only signed identities present in its roster',async()=>{
 const roster=new Map([[digest,{role:'student',state:'active'}]]);
 const provider=makeSyntheticInstitutionProvider({config,secret,roster,clock:()=>now});
 const p=await provider.verify({subjectDigest:digest});assert.equal(p.eligible,true);
 await assert.rejects(provider.verify({subjectDigest:'a'.repeat(64)}),{code:'IDENTITY_NOT_FOUND'});
 assert.throws(()=>makeSyntheticInstitutionProvider({config:{...config,kind:'rest'},secret,roster}),{code:'IDENTITY_INVALID_PROVIDER'});
});
test('HTTPS REST contract sends only pseudonymous subject and rejects unsigned/altered response',async()=>{
 const endpoint='https://verify.institution.example.edu/approved-affiliation';
 const restConfig={institutionId:school,providerId:'official_rest_v1',kind:'rest',
  issuer:'https://verify.institution.example.edu',audience:'student-creators-test',endpoint};
 const token='synthetic_server_side_token_abcdefghijklmnop';
 let requests=0;
 const fetchImpl=async(url,options)=>{
  requests++;
  assert.equal(url,endpoint);assert.equal(options.redirect,'error');
  assert.equal(options.headers.authorization,'Bearer '+token);
  const request=JSON.parse(options.body);
  assert.equal(request.subjectDigest,digest);assert.ok(request.requestId);
  assert.equal(JSON.stringify(request).includes('STUDENT-001'),false);
  const assertion={...request,role:'student',state:'active',issuedAt:now,expiresAt:now+1800};
  return {ok:true,headers:{get:()=> 'application/json; charset=utf-8'},
    text:async()=>JSON.stringify({payload:assertion,signature:signSyntheticInstitutionAssertion(secret,assertion)})};
 };
 const client=makeAuthorizedRestProvider({config:restConfig,secret,serverToken:token,fetchImpl,clock:()=>now});
 const result=await client.verify({subjectDigest:digest});assert.equal(result.eligible,true);assert.equal(requests,1);
 for(const bad of ['http://verify.institution.example.edu/api','https://127.0.0.1/a','https://localhost/api','https://verify.institution.example.edu:8443/a']){
  assert.throws(()=>validateInstitutionRegistryEntry({...restConfig,endpoint:bad}),{code:'IDENTITY_INVALID_PROVIDER'});
 }
 const tampered=makeAuthorizedRestProvider({config:restConfig,secret,serverToken:token,
 fetchImpl:async()=>({ok:true,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({payload:payload(),signature:'0'.repeat(64)})})});
 await assert.rejects(tampered.verify({subjectDigest:digest}),{code:'IDENTITY_BAD_SIGNATURE'});
});
test('OIDC and SAML contracts demand signed verified issuer, audience, bound request and student classification',async()=>{
 const oidc={institutionId:school,providerId:'institution_oidc',kind:'oidc',
   issuer:'https://sso.university.example',audience:'student-creators'};
 const nonce=randomUUID();
 const claims={iss:oidc.issuer,aud:oidc.audience,nonce,iat:now,exp:now+3600,subject_digest:digest,
  affiliation_role:'student',enrollment_state:'active'};
 const ok=await verifyOidcInstitutionToken({config:oidc,idToken:'synthetic.id.token',nonce,
  verifyJwt:async()=>({signatureVerified:true,claims}),now});
 assert.equal(ok.eligible,true);
 await assert.rejects(verifyOidcInstitutionToken({config:oidc,idToken:'malicious.header.payload',nonce,
  verifyJwt:async()=>({signatureVerified:false,claims}),now}),{code:'IDENTITY_BAD_SIGNATURE'});
 await assert.rejects(verifyOidcInstitutionToken({config:oidc,idToken:'signed.but.wrong',nonce,
  verifyJwt:async()=>({signatureVerified:true,claims:{...claims,aud:'other-service'}}),now}),{code:'IDENTITY_RESPONSE_MISMATCH'});
 const saml={institutionId:school,providerId:'institution_saml',kind:'saml',
  issuer:'https://sso.university.example/saml',audience:'student-creators'};
 const destination='https://student-creators.invalid/auth/saml';
 const assertion={signatureVerified:true,issuer:saml.issuer,audience:saml.audience,inResponseTo:nonce,
  destination,subjectDigest:digest,role:'lecturer',state:'active',issuedAt:now,expiresAt:now+2000};
 const verified=await verifySamlInstitutionResponse({config:saml,samlResponse:'<SignedSyntheticAssertion/>',
  requestId:nonce,destination,verifySignedAssertion:async()=>assertion,now});
 assert.equal(verified.eligible,false);
 await assert.rejects(verifySamlInstitutionResponse({config:saml,samlResponse:'<Untrusted/>',
  requestId:nonce,destination,verifySignedAssertion:async()=>({...assertion,signatureVerified:false}),now}),
  {code:'IDENTITY_BAD_SIGNATURE'});
 await assert.rejects(verifySamlInstitutionResponse({config:saml,samlResponse:'<WrongDestination/>',
  requestId:nonce,destination,verifySignedAssertion:async()=>({...assertion,destination:'https://attacker.example'}),now}),
  {code:'IDENTITY_BAD_SIGNATURE'});
});
