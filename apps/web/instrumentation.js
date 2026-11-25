import {reportServerFailure} from './lib/diagnostics.mjs';
// Only opt-in, allowlisted server diagnostics. No external service is contacted.
export function onRequestError(_error,request,context){
 reportServerFailure(request,context);
}
