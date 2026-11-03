import {createLazyCustomerNodeHandler} from '../server/bootstrap.mjs';
// Plain Vercel Node handler. NODEJS_HELPERS=0 is a required project env setting.
// The rewritten original URL/raw headers must be verified on the exact deployment.
const handler=createLazyCustomerNodeHandler();
export default handler;
