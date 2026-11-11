import {createThefaCoreOidcHandler} from '../../server/thefa-oidc-client.mjs';
import {admitVerifiedStageOidcSubject} from '../../server/oidc-stage-account.mjs';
import {verifyStageEdgeOidcIdentity} from '../../server/oidc-stage-edge-auth.mjs';
// Reuse one verified OAuth identity. The privileged account admission route
// stays disabled until a scoped writer/fence/secret receipt is available.
const onVerifiedIdentity=process.env.THEFA_CORE_STAGE_BRIDGE_ENABLED==='true'
 ?identity=>admitVerifiedStageOidcSubject(identity):
 process.env.THEFA_CORE_STAGE_EDGE_AUTH_READY==='true'
 ?identity=>verifyStageEdgeOidcIdentity(identity):null;
const run=createThefaCoreOidcHandler({onVerifiedIdentity});
export default async function handler(req,res){return run(req,res,'callback');}
