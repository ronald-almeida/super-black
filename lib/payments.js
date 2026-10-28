import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { OFFERS, PRODUCT, validDocument } from '../public/offers.js';

const BASE = 'https://api.blackcatoficial.com/api';
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
});
const sign = (value, key) => createHmac('sha256', key).update(`super-black-status:${value}`).digest('base64url');
function makeToken(id, amount, key) {
  const payload = Buffer.from(JSON.stringify({ id, amount, exp: Date.now() + 3 * 86400000 })).toString('base64url');
  return `${payload}.${sign(payload, key)}`;
}
function readToken(token, key) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(sign(payload, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof data.id === 'string' && data.id.length < 200 && data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export function createPaymentService({ apiKey = process.env.BLACKCAT_API_KEY, fetchImpl = fetch, log = console.info } = {}) {
  async function gateway(path, options = {}, timing) {
    const start = performance.now();
    if (timing) timing.gatewayAttempted = true;
    try {
      const response = await fetchImpl(`${BASE}${path}`, {
        ...options, headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey }, signal: AbortSignal.timeout(25000)
      });
      let body;
      try { body = await response.json(); } catch (error) {
        if (['TimeoutError','AbortError'].includes(error.name)) throw error;
        throw new Error('GATEWAY_INVALID');
      }
      if (!response.ok || body.success !== true || !body.data) throw new Error('GATEWAY_FAILED');
      return body.data;
    } finally {
      if (timing) timing.gatewayMs = performance.now() - start;
    }
  }

  const handlers = {
    async create(request, timing) {
      // Lightweight preparation on form interaction; never calls Black Cat or creates a sale.
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Allow': 'POST, OPTIONS', 'Cache-Control': 'no-store' } });
      if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
      const origin = request.headers.get('origin');
      if (origin && origin !== new URL(request.url).origin) return json({ error: 'Origem não permitida.' }, 403);
      if (!request.headers.get('content-type')?.startsWith('application/json')) return json({ error: 'Envie os dados em JSON.' }, 415);
      if (!apiKey) return json({ error: 'O pagamento está temporariamente indisponível. Tente novamente mais tarde.' }, 503);
      let body;
      try {
        const raw = await request.text();
        if (raw.length > 12000) return json({ error: 'Requisição muito grande.' }, 413);
        body = JSON.parse(raw);
      } catch { return json({ error: 'Dados inválidos.' }, 400); }
      const offer = OFFERS.find(item => item.id === body?.offerId);
      if (!offer) return json({ error: 'Escolha uma condição válida.' }, 400);
      const c = body.customer;
      if (!c || ['name','email','confirmEmail','phone','document'].some(k => typeof c[k] !== 'string')) return json({ error: 'Preencha seus dados pessoais.' }, 400);
      const name = c.name.trim();
      const email = c.email.trim().toLowerCase();
      const phone = c.phone.replace(/\D/g, '');
      const document = c.document.replace(/\D/g, '');
      if (name.length < 3 || name.length > 120 || name.split(/\s+/).length < 2) return json({ error: 'Digite seu nome completo.' }, 400);
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email !== c.confirmEmail.trim().toLowerCase()) return json({ error: 'Confira se os emails são válidos e iguais.' }, 400);
      if (!validDocument(document)) return json({ error: 'Digite um CPF ou CNPJ válido.' }, 400);
      if (!/^\d{10,11}$/.test(phone)) return json({ error: 'Digite o celular com DDD.' }, 400);
      try {
        const sale = await gateway('/sales/create-sale', {
          method: 'POST', body: JSON.stringify({
            amount: offer.amount, currency: 'BRL', paymentMethod: 'pix',
            items: [{ title: PRODUCT, unitPrice: offer.amount, quantity: 1, tangible: false }],
            customer: { name, email, phone, document: { number: document, type: document.length === 11 ? 'cpf' : 'cnpj' } },
            pix: { expiresInDays: 1 }, externalRef: `SB-${randomUUID()}`, metadata: `Oferta: ${offer.id}`
          })
        }, timing);
        const data = sale.paymentData;
        const code = data?.copyPaste || data?.qrCode;
        if (typeof code !== 'string' || !code || typeof sale.transactionId !== 'string' || sale.amount !== offer.amount) throw new Error('GATEWAY_INVALID');
        const rawImage = data.qrCodeBase64;
        const image = typeof rawImage === 'string' && /^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\r\n]+$/.test(rawImage)
          ? rawImage : typeof rawImage === 'string' && /^[A-Za-z0-9+/=\r\n]+$/.test(rawImage) ? `data:image/png;base64,${rawImage}` : null;
        return json({ copyPaste: code, qrCodeBase64: image, expiresAt: Number.isFinite(Date.parse(data.expiresAt)) ? data.expiresAt : null, amount: offer.amount, statusToken: makeToken(sale.transactionId, offer.amount, apiKey) }, 201);
      } catch (error) {
        if (['TimeoutError','AbortError'].includes(error.name)) return json({ error: 'A operadora demorou para responder. Antes de tentar novamente, confira se já recebeu uma cobrança.' }, 504);
        return json({ error: 'Não foi possível gerar o Pix na operadora. Confira seus dados e tente novamente.' }, 502);
      }
    },
    async status(request) {
      if (request.method !== 'GET') return json({ error: 'Método não permitido.' }, 405);
      if (!apiKey) return json({ error: 'Pagamento indisponível.' }, 503);
      const token = readToken(new URL(request.url).searchParams.get('token'), apiKey);
      if (!token) return json({ error: 'Consulta inválida ou expirada.' }, 403);
      try {
        const sale = await gateway(`/sales/${encodeURIComponent(token.id)}/status`);
        if (sale.transactionId !== token.id || sale.amount !== token.amount || !['PENDING','PAID','CANCELLED','REFUNDED'].includes(sale.status)) throw new Error('GATEWAY_INVALID');
        return json({ status: sale.status });
      } catch { return json({ error: 'Não foi possível consultar o pagamento.' }, 502); }
    }
  };
  return {
    ...handlers,
    async create(request) {
      const start = performance.now();
      const timing = { gatewayAttempted: false, gatewayMs: 0 };
      const response = await handlers.create(request, timing);
      const totalMs = performance.now() - start;
      response.headers.set('Server-Timing', `app;dur=${Math.max(0, totalMs - timing.gatewayMs).toFixed(1)}, blackcat;dur=${timing.gatewayMs.toFixed(1)}, total;dur=${totalMs.toFixed(1)}`);
      if (timing.gatewayAttempted) {
        // Operational timings only: never log the customer, Pix code, token or provider body.
        log(JSON.stringify({ event: 'pix_create_timing', status: response.status, gatewayMs: Math.round(timing.gatewayMs), totalMs: Math.round(totalMs), region: process.env.VERCEL_REGION || 'local' }));
      }
      return response;
    }
  };
}
