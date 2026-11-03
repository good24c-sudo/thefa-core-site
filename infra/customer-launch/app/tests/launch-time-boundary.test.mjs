import test from 'node:test';import assert from 'node:assert/strict';
import {setup,origin} from './launch-fixture.mjs';
import {createFreshLaunchAccounts} from '../server/fresh-launch-accounts.mjs';
test('a user created milliseconds after launch is new, not silently truncated to a pre-launch identity',async()=>{
 const x=await setup(),start=Math.floor((Date.now()-3600000)/1000)*1000+500,ctx=await x.authService.auth.$context,email='time-boundary@example.test';
 await ctx.internalAdapter.createUser({name:'Boundary fixture',email,emailVerified:true,createdAt:new Date(start+100),updatedAt:new Date()});
 const headers=new Headers({origin});await x.authService.auth.api.sendVerificationOTP({headers,body:{email,type:'sign-in'}});
 const result=await x.authService.auth.api.signInEmailOTP({headers,body:{email,otp:x.sent.at(-1).otp},asResponse:true});assert.equal(result.status,200);
 const cookie=result.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),manager=createFreshLaunchAccounts({authService:x.authService,rest:x.db,config:{...x.cfg,launchStartedAt:new Date(start).toISOString()}});
 const principal=await manager.resolve(cookie,{admit:true});assert.equal(principal.accountProvenance,'LAUNCH_ACCOUNT_CONFIRMED');assert.equal(principal.user.provider,'email');
});
