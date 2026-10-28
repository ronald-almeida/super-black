import { OFFERS, money, validDocument } from './offers.js';

const $ = selector => document.querySelector(selector);
const params = new URLSearchParams(location.search);
const selected = OFFERS.find(offer => offer.id === params.get('oferta'));
const checkoutRoute = location.pathname.replace(/\/$/, '') === '/checkout';
let payment = null;
let pollTimer;
let checking = false;
const dialog = $('#pix-dialog');

$('#offer-grid').innerHTML = OFFERS.map((offer, index) => `<article class="offer-card ${index === 2 ? 'featured' : ''}">
  <h2>${offer.title}</h2><p class="offer-description">${offer.description}</p>
  <p class="discount">${Math.round((1 - offer.amount / 3510100) * 100)}% DE DESCONTO</p>
  <s class="old-price">R$ 35.101</s>
  <div class="offer-price"><small>R$</small> ${offer.amount / 100}</div>
  <p class="payment-note">à vista no <strong>Pix</strong></p>
  <p class="savings">Você economiza ${money(3510100 - offer.amount).replace(',00', '')}</p>
  <a class="offer-cta" href="/checkout?oferta=${offer.id}" aria-label="Garantir minha vaga: ${offer.title}, ${money(offer.amount)}"><span>GARANTIR MINHA<br> VAGA</span><span class="arrow" aria-hidden="true">→</span></a>
</article>`).join('');

if (checkoutRoute && selected) {
  $('#offers').hidden = true;
  $('#checkout').hidden = false;
  document.body.classList.add('checkout-active');
  document.title = `Checkout • ${money(selected.amount)} • Super Black Bússola`;
  for (const selector of ['#product-price', '#summary-price', '#modal-price']) $(selector).textContent = money(selected.amount);
} else if (checkoutRoute) {
  history.replaceState(null, '', '/');
}

const form = $('#checkout-form');
const button = $('#generate');
// Start the same server function while the buyer fills in the form, without creating a charge.
if (checkoutRoute && selected) form.addEventListener('focusin', () => {
  void fetch('/api/pix', { method: 'OPTIONS', cache: 'no-store', signal: AbortSignal.timeout(5000) }).catch(() => {});
}, { once: true });
function validateForm() {
  const values = Object.fromEntries(new FormData(form));
  $('#confirmEmail').setCustomValidity(values.email.trim().toLowerCase() === values.confirmEmail.trim().toLowerCase() ? '' : 'Os emails precisam ser iguais.');
  $('#name').setCustomValidity(values.name.trim().split(/\s+/).length >= 2 ? '' : 'Digite seu nome completo.');
  $('#document').setCustomValidity(validDocument(values.document) ? '' : 'Digite um CPF ou CNPJ válido.');
  $('#phone').setCustomValidity(/^\d{10,11}$/.test(values.phone.replace(/\D/g, '')) ? '' : 'Digite o celular com DDD.');
  return values;
}
for (const input of form.querySelectorAll('input')) input.addEventListener('input', () => {
  input.setCustomValidity('');
  if (input.id === 'email') $('#confirmEmail').setCustomValidity('');
});
$('#phone').addEventListener('input', event => {
  const n = event.target.value.replace(/\D/g, '').slice(0, 11);
  event.target.value = n.length > 6 ? `(${n.slice(0, 2)}) ${n.slice(2, n.length > 10 ? 7 : 6)}-${n.slice(n.length > 10 ? 7 : 6)}` : n.length > 2 ? `(${n.slice(0, 2)}) ${n.slice(2)}` : n;
});
$('#document').addEventListener('input', event => {
  const n = event.target.value.replace(/\D/g, '').slice(0, 14);
  event.target.value = n.length <= 11
    ? n.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
    : n.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2}).*/, '$1.$2.$3/$4-$5');
});

function openPixDialog() {
  if (!dialog.open) dialog.showModal();
  document.body.style.overflow = 'hidden';
}

function showPayment({ open = true } = {}) {
  $('#pix-loading').hidden = true;
  $('#dialog-error').hidden = true;
  $('#pix-result').hidden = false;
  $('#pix-title').textContent = 'Falta pouco para garantir sua vaga!';
  $('#pix-description').textContent = 'Escaneie o QR code ou copie o código abaixo.';
  $('#pix-code').value = payment.copyPaste;
  $('#copy-pix').disabled = false;
  $('#copy-pix').textContent = 'Copiar código Pix';
  $('#copy-feedback').textContent = '';
  $('#qr-image').hidden = !payment.qrCodeBase64;
  if (payment.qrCodeBase64) $('#qr-image').src = payment.qrCodeBase64;
  $('#expiration').textContent = payment.expiresAt ? `Válido até ${new Date(payment.expiresAt).toLocaleString('pt-BR')}` : 'Confira o prazo de pagamento no aplicativo do banco.';
  $('#payment-status').textContent = 'Aguardando pagamento';
  $('#payment-status').classList.remove('paid');
  if (payment.status === 'PAID' || payment.status === 'REFUNDED') {
    $('#payment-status').textContent = payment.status === 'PAID' ? 'Pagamento confirmado! Obrigado pela sua compra.' : 'Pagamento estornado.';
    $('#payment-status').classList.toggle('paid', payment.status === 'PAID');
    $('#copy-pix').disabled = true;
    $('#qr-image').hidden = true;
  }
  if (open) openPixDialog();
  if (!['PAID','REFUNDED'].includes(payment.status)) checkPayment();
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (payment) { showPayment(); return; }
  const values = validateForm();
  if (!form.reportValidity() || !selected || button.disabled) return;
  $('#form-error').hidden = true;
  button.disabled = true;
  button.textContent = 'Gerando seu Pix…';
  $('#pix-title').textContent = 'Gerando seu Pix';
  $('#pix-description').textContent = 'Estamos preparando seu pagamento.';
  $('#pix-result').hidden = true;
  $('#dialog-error').hidden = true;
  $('#pix-loading').hidden = false;
  $('#generation-status').textContent = 'Solicitando seu Pix…';
  openPixDialog();
  const progressTimers = [
    setTimeout(() => { $('#generation-status').textContent = 'Aguardando a emissão do código pela operadora…'; }, 3000),
    setTimeout(() => { $('#generation-status').textContent = 'A operadora ainda está processando. Aguarde para evitar outra solicitação.'; }, 10000)
  ];
  try {
    const response = await fetch('/api/pix', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId: selected.id, customer: values }),
      signal: AbortSignal.timeout(35000)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Não foi possível gerar seu Pix.');
    payment = result;
    // Dados de pagamento ficam somente na memória desta página, nunca em localStorage.
    for (const input of form.querySelectorAll('input')) input.readOnly = true;
    showPayment({ open: dialog.open });
  } catch (error) {
    $('#form-error').textContent = error.name === 'TimeoutError' || error.name === 'AbortError'
      ? 'A resposta demorou mais que o esperado. Antes de tentar novamente, verifique se já recebeu uma cobrança.'
      : error.message === 'Failed to fetch' ? 'Não foi possível conectar. Verifique sua internet e tente novamente.' : error.message;
    $('#form-error').hidden = false;
    $('#pix-loading').hidden = true;
    $('#pix-title').textContent = 'Não foi possível concluir';
    $('#pix-description').textContent = 'Feche esta janela para voltar ao checkout.';
    $('#dialog-error').textContent = $('#form-error').textContent;
    $('#dialog-error').hidden = false;
  } finally {
    progressTimers.forEach(clearTimeout);
    button.disabled = false;
    button.textContent = payment ? 'Visualizar meu Pix' : 'Gerar Pix';
  }
});

async function checkPayment() {
  clearTimeout(pollTimer);
  if (!dialog.open || !payment || checking) return;
  checking = true;
  let terminal = false;
  try {
    const response = await fetch(`/api/status?token=${encodeURIComponent(payment.statusToken)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error();
    if (result.status === 'PAID') {
      payment.status = 'PAID';
      $('#payment-status').textContent = 'Pagamento confirmado! Obrigado pela sua compra.';
      $('#payment-status').classList.add('paid');
      $('#copy-pix').disabled = true;
      $('#qr-image').hidden = true;
      terminal = true;
    } else if (result.status === 'CANCELLED' || result.status === 'REFUNDED' || (payment.expiresAt && Date.parse(payment.expiresAt) < Date.now())) {
      payment.status = result.status;
      $('#payment-status').textContent = result.status === 'REFUNDED' ? 'Pagamento estornado.' : 'Este Pix foi cancelado ou expirou. Feche esta janela para gerar outro.';
      $('#copy-pix').disabled = true;
      $('#qr-image').hidden = true;
      terminal = true;
      if (result.status !== 'REFUNDED') {
        payment = null;
        button.textContent = 'Gerar novo Pix';
        for (const input of form.querySelectorAll('input')) input.readOnly = false;
      }
    } else $('#payment-status').textContent = 'Aguardando pagamento';
  } catch {
    $('#payment-status').textContent = 'Não foi possível atualizar o status. Consultando novamente em instantes…';
  } finally {
    checking = false;
    if (!terminal && dialog.open && payment) pollTimer = setTimeout(checkPayment, 8000);
  }
}

$('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { clearTimeout(pollTimer); document.body.style.overflow = ''; });
dialog.addEventListener('click', event => {
  const bounds = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
});
$('#copy-pix').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#pix-code').value);
    $('#copy-pix').textContent = 'Código copiado!';
    $('#copy-feedback').textContent = 'Agora cole o código no aplicativo do seu banco.';
  } catch {
    $('#pix-code').focus();
    $('#pix-code').select();
    $('#copy-feedback').textContent = 'Selecione o código e use a opção Copiar do seu dispositivo.';
  }
});
