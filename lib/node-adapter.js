export async function toRequest(req) {
  const host = req.headers.host || 'localhost:3000';
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  let body;
  if (!['GET','HEAD'].includes(req.method)) {
    if (req.body !== undefined) body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    else {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 12000) throw new Error('BODY_TOO_LARGE');
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
  }
  return new Request(`${protocol}://${host}${req.url}`, { method: req.method, headers: req.headers, body });
}
export async function sendResponse(res, response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}
export const nodeHandler = handler => async (req, res) => {
  try { await sendResponse(res, await handler(await toRequest(req))); }
  catch (error) {
    res.writeHead(error.message === 'BODY_TOO_LARGE' ? 413 : 500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: error.message === 'BODY_TOO_LARGE' ? 'Requisição muito grande.' : 'Não foi possível processar a solicitação.' }));
  }
};
