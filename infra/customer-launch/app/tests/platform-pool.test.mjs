import test from 'node:test';import assert from 'node:assert/strict';import pg from 'pg';
import {attachCustomerVercelPool} from '../server/bootstrap.mjs';
test('pinned Vercel pool integration holds request lifetime until idle connections can close',async()=>{
 const symbol=Symbol.for('@vercel/request-context'),prior=globalThis[symbol],url=process.env.VERCEL_URL,region=process.env.VERCEL_REGION,pending=[];
 const pool=new pg.Pool({max:2,idleTimeoutMillis:10});process.env.VERCEL_URL='pool-test.vercel.app';process.env.VERCEL_REGION='icn1';globalThis[symbol]={get:()=>({waitUntil:p=>pending.push(p)})};
 try{attachCustomerVercelPool(pool);pool.emit('release',null,{});assert.equal(pending.length,1);let done=false;pending[0].then(()=>{done=true});await Promise.resolve();assert.equal(done,false);await pending[0];assert.equal(done,true);assert.equal(pool.totalCount,0);}finally{await pool.end();if(prior===undefined)delete globalThis[symbol];else globalThis[symbol]=prior;if(url===undefined)delete process.env.VERCEL_URL;else process.env.VERCEL_URL=url;if(region===undefined)delete process.env.VERCEL_REGION;else process.env.VERCEL_REGION=region;}
});
