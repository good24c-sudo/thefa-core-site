export default (_req,res)=>{
 res.statusCode=404;res.setHeader('cache-control','no-store');
 res.setHeader('content-type','application/json');res.setHeader('x-content-type-options','nosniff');
 res.end('{"code":"NOT_FOUND"}');
};
