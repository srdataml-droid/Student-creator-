import {createHostedGovernanceHandler} from '../../../../../../packages/hosted-core/src/governance-read-api.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const governance=createHostedGovernanceHandler();
export async function GET(request,{params}){
  const {segments}=await params;
  return governance(request,{segments});
}
export async function POST(request,{params}){
  const {segments}=await params;
  return governance(request,{segments});
}
