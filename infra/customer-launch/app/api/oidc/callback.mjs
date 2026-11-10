import {createThefaCoreOidcHandler} from '../../server/thefa-oidc-client.mjs';
import {admitVerifiedStageOidcSubject} from '../../server/oidc-stage-account.mjs';
// Enrollment is permitted only when the scoped, independent staging credential path is installed.
const onVerifiedIdentity=process.env.THEFA_CORE_STAGE_BRIDGE_ENABLED==='true'
 ?identity=>admitVerifiedStageOidcSubject(identity):null;
const run=createThefaCoreOidcHandler({onVerifiedIdentity});
export default async function handler(req,res){return run(req,res,'callback');}
