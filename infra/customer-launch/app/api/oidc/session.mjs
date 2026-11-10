import {createThefaCoreOidcHandler} from '../../server/thefa-oidc-client.mjs';
import {readStageOidcCustomerAccount} from '../../server/oidc-stage-account.mjs';
const onSessionLookup=process.env.THEFA_CORE_STAGE_BRIDGE_ENABLED==='true'
 ?cookie=>readStageOidcCustomerAccount(cookie):null;
const run=createThefaCoreOidcHandler({onSessionLookup});
export default async function handler(req,res){return run(req,res,'session');}
