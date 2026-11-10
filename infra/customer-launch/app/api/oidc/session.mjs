import {createThefaCoreOidcHandler} from '../../server/thefa-oidc-client.mjs';
const run=createThefaCoreOidcHandler();
export default async function handler(req,res){return run(req,res,'session');}
