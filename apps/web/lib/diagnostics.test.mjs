import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeServerFailure,reportServerFailure} from './diagnostics.mjs';
import {onRequestError} from '../instrumentation.js';
test('server diagnostics never serialize private request or exception data',()=>{
 const events=[];
 const request={method:'POST',path:'/messages/private-student-id',headers:{authorization:'private-credential'},body:'private-message'};
 const context={routeType:'route',routePath:'/identity/private-student'};
 const env={STUDENT_CREATORS_DIAGNOSTICS_ENABLED:'true'};
 assert.equal(reportServerFailure(request,context,{env,sink:e=>events.push(e)}),true);
 assert.deepEqual(events,[{event:'student_creators_server_failure',method:'POST',routeType:'route'}]);
 assert.deepEqual(safeServerFailure({method:'user@example.invalid',routeType:'private-data'}),{event:'student_creators_server_failure',method:'OTHER',routeType:'other'});
 assert.equal(reportServerFailure(request,context,{env:{},sink:()=>{throw Error('unexpected');}}),false);
 assert.equal(reportServerFailure(request,context,{env,sink:()=>{throw Error('sink failed');}}),false);
 assert.equal(typeof onRequestError,'function');
});
