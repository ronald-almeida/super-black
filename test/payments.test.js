import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPaymentService } from '../lib/payments.js';
import { validDocument } from '../public/offers.js';

const customer = { name: 'Cliente Teste', email: 'teste@example.com', confirmEmail: 'teste@example.com', phone: '11999999999', document: '52998224725' };
const request = (body, headers = {}) => new Request('https://checkout.example/api/pix', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});
const response = data => new Response(JSON.stringify({ success: true, data }), { status: 201 });
const sale = amount => ({ transactionId: 'TEST-TRANSACTION', amount, paymentData: {
  copyPaste: 'CODIGO-EXCLUSIVO-DE-TESTE-NAO-PAGAVEL', qrCodeBase64: 'data:image/png;base64,AAAA', expiresAt: '2030-01-01T00:00:00Z'
} });

for (const [offerId, amount] of [['nao-aluno',34700],['aluno',29700],['club',24700]]) {
  test(`envia o total correto de ${amount} centavos para ${offerId}, ignorando valor adulterado`, async () => {
    let sent;
    const service = createPaymentService({ apiKey: 'test-secret', fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.blackcatoficial.com/api/sales/create-sale');
      assert.equal(options.headers['X-API-Key'], 'test-secret');
      sent = JSON.parse(options.body);
      return response(sale(amount));
    } });
    const result = await service.create(request({ offerId, amount: 1, customer }));
    assert.equal(result.status, 201);
    assert.equal(sent.amount, amount);
    assert.equal(sent.items[0].unitPrice, amount);
    assert.equal(sent.items[0].tangible, false);
    assert.equal(sent.paymentMethod, 'pix');
    assert.equal(sent.customer.document.type, 'cpf');
    const text = await result.text();
    assert.ok(!text.includes('test-secret'));
    assert.ok(!text.includes(customer.email));
    assert.equal(JSON.parse(text).copyPaste, 'CODIGO-EXCLUSIVO-DE-TESTE-NAO-PAGAVEL');
  });
}
test('rejeita oferta, CPF, celular e confirmação de email inválidos antes de cobrar', async () => {
  const service = createPaymentService({ apiKey: 'test', fetchImpl: async () => { throw new Error('Não deve chamar o gateway'); } });
  for (const body of [
    {offerId:'inexistente',customer}, {offerId:'club',customer:{...customer,document:'11111111111'}},
    {offerId:'club',customer:{...customer,phone:'123'}}, {offerId:'club',customer:{...customer,confirmEmail:'outro@example.com'}},
    {offerId:'club',customer:{...customer,name:'Teste'}}, null
  ]) assert.equal((await service.create(request(body))).status, 400);
});
test('valida dígitos de CPF e CNPJ', () => {
  assert.equal(validDocument('529.982.247-25'), true);
  assert.equal(validDocument('529.982.247-24'), false);
  assert.equal(validDocument('11.222.333/0001-81'), true);
  assert.equal(validDocument('11.222.333/0001-82'), false);
});
test('consulta status só aceita token assinado e resposta da transação correta', async () => {
  let returnedId = 'TEST-TRANSACTION';
  const service = createPaymentService({ apiKey: 'test', fetchImpl: async (url) => url.endsWith('/status')
    ? response({ transactionId: returnedId, amount: 24700, status: 'PAID' }) : response(sale(24700)) });
  const created = await (await service.create(request({offerId:'club',customer}))).json();
  const statusRequest = token => new Request(`https://checkout.example/api/status?token=${token}`);
  assert.equal((await service.status(statusRequest(created.statusToken + 'x'))).status, 403);
  assert.equal((await service.status(statusRequest('TEST-TRANSACTION'))).status, 403);
  const paid = await service.status(statusRequest(created.statusToken));
  assert.equal(paid.status, 200);
  assert.deepEqual(await paid.json(), {status:'PAID'});
  returnedId = 'OTHER-TRANSACTION';
  assert.equal((await service.status(statusRequest(created.statusToken))).status, 502);
});
test('chave ausente falha de forma explícita sem gerar Pix fictício', async () => {
  const service = createPaymentService({apiKey:''});
  assert.equal((await service.create(request({offerId:'club',customer}))).status, 503);
});
test('não expõe mensagens privadas de erro do gateway', async () => {
  const service = createPaymentService({apiKey:'test',fetchImpl:async()=>new Response(JSON.stringify({message:'SECRET_PROVIDER_DETAIL'}),{status:400})});
  const result = await service.create(request({offerId:'club',customer}));
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes('SECRET_PROVIDER_DETAIL'));
});
test('rejeita resposta do gateway com valor diferente', async () => {
  const service = createPaymentService({apiKey:'test',fetchImpl:async()=>response(sale(1))});
  assert.equal((await service.create(request({offerId:'club',customer}))).status, 502);
});
test('bloqueia origem externa, método incorreto e corpo excessivo', async () => {
  const service = createPaymentService({apiKey:'test'});
  assert.equal((await service.create(request({},{Origin:'https://other.example'}))).status,403);
  assert.equal((await service.create(new Request('https://checkout.example/api/pix'))).status,405);
  assert.equal((await service.create(request({large:'a'.repeat(13000)}))).status,413);
});
