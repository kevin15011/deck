// External boundary only: actual published plugin code runs unchanged in child processes.
const fs = require('node:fs');
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (process.env.MEMORY_TEST_TRANSPORT && url.href.startsWith(process.env.MEMORY_TEST_TRANSPORT + '/')) return nativeFetch(input, init);
  if (url.origin !== 'http://127.0.0.1:9876') throw new Error('Offline test forbids external requests');
  if (new Headers(init?.headers).get('authorization') !== 'Bearer fake-plugin-credential') throw new Error('Unexpected fake-provider credential');
  const body = JSON.parse(init?.body || '{}');
  const requests = process.env.MEMORY_TEST_REQUESTS;
  const storage = process.env.MEMORY_TEST_STORAGE;
  const documents = fs.existsSync(storage) ? JSON.parse(fs.readFileSync(storage, 'utf8')) : [];
  fs.appendFileSync(requests, JSON.stringify({ path: url.pathname, method: init?.method, body }) + '\n');
  const namespace = url.pathname.startsWith('/ns/') ? decodeURIComponent(url.pathname.split('/')[2]) : body.containerTag;
  const matches = (doc, filter) => !filter || (filter.operator === 'and'
    ? filter.operands.every(f => matches(doc, f))
    : filter.operator === 'eq' && doc.metadata?.[filter.field] === filter.value);
  const found = documents.filter(d => d.namespace === namespace && matches(d, body.filter));
  let result = {};
  if (url.pathname.endsWith('/document') || url.pathname === '/v3/documents') {
    if (process.env.MEMORY_TEST_REJECT === '1') return Response.json({error:'injected rejection'}, {status:403});
    if (process.env.MEMORY_TEST_INVALID_ACCEPTANCE === '1') return Response.json({status:'queued'});
    if (globalThis.MEMORY_TEST_HOLD_ADD) await globalThis.MEMORY_TEST_HOLD_ADD;
    if (process.env.MEMORY_TEST_HOLD_FILE) {
      const release = process.env.MEMORY_TEST_HOLD_FILE;
      fs.writeFileSync(release + '.waiting', '');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { clearInterval(interval); reject(new Error('Held fake provider timed out')); }, 5000);
        const interval = setInterval(() => { if (fs.existsSync(release)) { clearInterval(interval); clearTimeout(timeout); resolve(); } }, 10);
      });
    }
    const id = body.id || body.customId || 'fake-id';
    documents.push({namespace, ...body, id});
    fs.writeFileSync(storage, JSON.stringify(documents));
    result = {id, status:'queued'};
  } else if (url.pathname.endsWith('/search')) {
    const results = found.map(d => ({id:d.id, memory:d.content, metadata:d.metadata, similarity:0.99}));
    result = {results, searchTime:1, total:results.length};
  } else if (url.pathname.endsWith('/profile')) result = {profile:{static:[],dynamic:[]}};
  else if (url.pathname === '/mcp') result = {jsonrpc:'2.0',id:body.id,result:body.params};
  else if (url.pathname !== '/v3/settings') throw new Error('Unexpected fake-provider operation');
  return Response.json(result);
};
