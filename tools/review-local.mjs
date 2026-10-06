import { createLabServer } from '../lab/server.mjs';
import path from 'node:path';
const base = process.env.THEFA_REVIEW_DATA;
if (!base || !path.isAbsolute(base)) throw new Error('REVIEW_DATA_DIRECTORY_REQUIRED');
const app = await createLabServer({runtimeDir:path.join(base,'state'),outputDir:path.join(base,'output'),ollamaFetch:async()=>{throw new Error('REVIEW_LOCAL_AI_DISABLED');}});
app.server.listen(4180,'127.0.0.1',()=>console.log('Review console http://127.0.0.1:4180'));
for(const signal of ['SIGINT','SIGTERM']) process.once(signal,async()=>{await app.close();process.exit(0);});
