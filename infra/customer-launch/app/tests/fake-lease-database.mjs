/** R26 test-double ONLY: models existing V3 row lease, CAS state save, and reply loss. */
const copy=v=>v==null?v:structuredClone(v);
const good=/^tenant_[a-f0-9]{64}$/;
const err=code=>Object.assign(new Error(code),{code});
export class FakeLeaseDatabase{
 constructor(){this.rows=new Map();this.calls=[];this.failNextSave=null;}
 snapshot(workspaceId){
  const found=this.rows.get(workspaceId);
  return found?copy(found):null;
 }
 prime(workspaceId,state,{version=1}={}){
  if(!good.test(workspaceId)||this.rows.has(workspaceId)||version<0)
   throw err('ILLEGAL_TEST_SEED');
  this.rows.set(workspaceId,{state:copy(state),version,owner:null,until:0});
 }
 async request(route){
  const q=new URL('https://fixture.invalid'+route);
  if(q.pathname!=='/core_console_state_v3')throw err('OUT_OF_SCOPE_HTTP_REQUEST');
  const param=q.searchParams.get('workspace_id');
  const workspace=param?.startsWith('eq.')?param.slice(3):'';
  if(!good.test(workspace)||q.searchParams.get('limit')!=='1')
   throw err('INVALID_TEST_QUERY');
  this.calls.push({op:'GET',workspace});
  const row=this.rows.get(workspace);
  return row?[{state:copy(row.state),version:row.version,
   lease_owner:row.owner,lease_until:row.until}]:[];
 }
 async rpc(name,args){
  const workspace=args?.p_workspace;
  if(!good.test(workspace))throw err('INVALID_TEST_WORKSPACE');
  this.calls.push({op:name,workspace});
  if(name==='core_console_acquire_lease_v3'){
   const row=this.rows.get(workspace)??{state:null,version:0,owner:null,until:0};
   if(row.owner&&row.owner!==args.p_owner&&row.until>Date.now())
    return {granted:false,version:row.version,recovered:false};
   const recovered=!!row.owner&&row.owner!==args.p_owner;
   row.owner=args.p_owner;row.until=Date.now()+120000;
   this.rows.set(workspace,row);
   return {granted:true,state:copy(row.state),version:row.version,
    lease_owner:row.owner,recovered};
  }
  const row=this.rows.get(workspace);
  if(!row||row.owner!==args.p_owner||row.until<=Date.now())
   throw err('LEASE_LOST');
  if(name==='core_console_save_state_v3'){
   if(row.version!==args.p_expected_version)throw err('STATE_VERSION_CONFLICT');
   if(this.failNextSave==='before'){
    this.failNextSave=null;throw err('SIMULATED_NETWORK_LOSS_BEFORE_SAVE');
   }
   row.state=copy(args.p_state);
   row.version++;
   if(this.failNextSave==='after'){
    this.failNextSave=null;throw err('SIMULATED_REPLY_LOST_AFTER_COMMIT');
   }
   return {version:row.version};
  }
  if(name==='core_console_release_lease_v3'){
   row.owner=null;row.until=0;return {released:true};
  }
  throw err('UNEXPECTED_TEST_RPC');
 }
}
