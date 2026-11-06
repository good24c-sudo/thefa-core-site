import {createCustomerBrokerHandler} from '../../runtime/customer-broker-handler.mjs';
Deno.serve(createCustomerBrokerHandler({env:(name:string)=>Deno.env.get(name)}));
