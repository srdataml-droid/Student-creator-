import test from 'node:test';
import assert from 'node:assert/strict';
import {canInitializePaystackCheckout} from '../src/checkout-distribution.mjs';
test('independent web deployment is eligible for the separate payment release gate',()=>{for(const environment of ['test','live'])assert.equal(canInitializePaystackCheckout({environment,channel:'independent_web',nodeEnv:'production'}),true);});
test('local nonproduction test checkout remains available without deployment configuration',()=>{assert.equal(canInitializePaystackCheckout({environment:'test',nodeEnv:'development'}),true);assert.equal(canInitializePaystackCheckout({environment:'test'}),true);});
test('production or live checkout requires explicit independent web configuration',()=>{assert.equal(canInitializePaystackCheckout({environment:'test',nodeEnv:'production'}),false);assert.equal(canInitializePaystackCheckout({environment:'live',nodeEnv:'development'}),false);});
test('Google Play, other or unknown channels cannot initialize Paystack digital checkout',()=>{for(const channel of ['google_play','play_consumption_only','play_billing','direct_android','',null,'INDEPENDENT_WEB'])for(const environment of ['test','live'])assert.equal(canInitializePaystackCheckout({environment,channel,nodeEnv:'development'}),false);});
test('invalid payment environments never enable checkout',()=>{assert.equal(canInitializePaystackCheckout({environment:'sandbox',channel:'independent_web'}),false);});
