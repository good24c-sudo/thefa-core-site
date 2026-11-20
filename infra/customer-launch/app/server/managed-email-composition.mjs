import {createManagedEmailAuth} from './managed-email-auth.mjs';
import {createCustomerRuntime} from './inherited/customer-runtime-composition.mjs';
import {createCustomerApplication} from './inherited/customer-application.mjs';
import {createCustomerNodeAdapter} from './inherited/customer-node-adapter.mjs';
/** Reuse existing tenant storage, allowance, AI engine and strict Node boundary. */
export function createManagedEmailCustomerServer({settings,fetchImpl=globalThis.fetch,clock=Date.now}={}){
 if(settings?.authEngine!=='managed-email-v1'||settings.config?.accountMode!=='fresh-launch')throw Error('EXPLICIT_MANAGED_NEW_CUSTOMER_MODE_REQUIRED');
 const auth=createManagedEmailAuth({config:settings.config,publishableKey:settings.publishableKey,cookieSecret:settings.secret,googleProvider:settings.googleProvider??null,fetchImpl,clock});
 const runtime=createCustomerRuntime({config:settings.config,sessionVerifier:auth.sessionVerifier,fetchImpl,clock});
 const application=createCustomerApplication({runtime,authRoutes:auth.authRoutes,originConfig:settings.config});
 const nodeHandler=createCustomerNodeAdapter({application,customerOrigin:settings.config.customerOrigin,environment:settings.config.environment});
 return Object.freeze({application,nodeHandler,close:async()=>{}});
}
