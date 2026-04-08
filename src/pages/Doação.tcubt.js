import { createPixCharge, getPixStatus } from 'backend/pix.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';

const DEFAULT_PAYER_EMAIL = 'doe@institutocomuta.org.br';

/** @type {string | null} */
let currentDonationId = null;
/** @type {string} */
let currentPixCode = '';
/** @type {string} */
let currentTicketUrl = '';
/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
/** @type {boolean} */
let isGeneratingPix = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let autoGenerateTimer = null;
const MOBILE_AUTO_GENERATE_DELAY_MS = 1500;

$w.onReady(function () {
  const textoInicial = 'Clique acima para copiar o Pix';

  $w('#ajudaPix').text = textoInicial;

  const copiarPixFixo = async () => {
    try {
      await wixWindowFrontend.copyToClipboard(DEFAULT_PAYER_EMAIL);
      $w('#ajudaPix').text = 'Pix copiado';
    } catch (error) {
      console.log('Erro ao copiar Pix:', getErrorMessage(error));
      $w('#ajudaPix').text = 'Nao foi possivel copiar o Pix';
    }

    setTimeout(() => {
      $w('#ajudaPix').text = textoInicial;
    }, 2000);
  };

  registrarClique('#btnCopiarPix', copiarPixFixo);
  registrarClique('#ajudaPix', copiarPixFixo);
  registrarClique('#text2', copiarPixFixo);

  prepararTela();
  configurarBotoesDeValor();
  configurarBotaoGerar();
  configurarCliqueNoCodigo();
  configurarFallbackMobile();
});

/**
 * Na Wix website, `onClick` e o evento oficial para mouse e toque.
 * Misturar `onPress` aqui virou a regressao mais provavel do mobile.
 * @param {string} seletor
 * @param {() => void | Promise<void>} acao
 */
function registrarClique(seletor, acao) {
  $w(seletor).onClick(() => {
    return acao();
  });
}

function prepararTela() {
  $w('#inputValor').value = '';
  $w('#inputEmail').value = '';

  $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
  $w('#txtPix').text = '';
  $w('#txtStatus').text = '';
  $w('#txtExpiracao').text = '';
  $w('#txtAjuda').text = '';
  $w('#txtLinkPix').text = '';

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function configurarBotoesDeValor() {
  registrarClique('#btn20', () => selecionarValor('20'));
  registrarClique('#btn30', () => selecionarValor('30'));
  registrarClique('#btn50', () => selecionarValor('50'));
  registrarClique('#btn100', () => selecionarValor('100'));

  $w('#btn20').enable();
  $w('#btn30').enable();
  $w('#btn50').enable();
  $w('#btn100').enable();
}

/**
 * @param {string} valor
 */
function selecionarValor(valor) {
  $w('#inputValor').value = valor;
  $w('#txtMensagem').text = `Valor selecionado: R$${valor},00`;

  if (isMobileFormFactor()) {
    agendarGeracaoMobile();
  }
}

function configurarBotaoGerar() {
  $w('#btnGerarPix').enable();

  registrarClique('#btnGerarPix', async () => {
    await gerarPix();
  });
}

async function gerarPix() {
  limparGeracaoMobileAgendada();

  if (isGeneratingPix) {
    return;
  }

  const amountRaw = String($w('#inputValor').value || '').trim();
  const emailInput = String($w('#inputEmail').value || '').trim();
  const email = emailInput || DEFAULT_PAYER_EMAIL;
  const amount = Number(amountRaw.replace(',', '.'));

  if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
    await $w('#inputValor').scrollTo();
    $w('#inputValor').focus();
    $w('#txtMensagem').text = 'Digite um valor valido para continuar';
    return;
  }

  if (emailInput && (!email.includes('@') || !email.includes('.'))) {
    await $w('#inputEmail').scrollTo();
    $w('#inputEmail').focus();
    $w('#txtMensagem').text = 'Digite um email valido para gerar o pagamento';
    return;
  }

  isGeneratingPix = true;
  limparResultado();
  $w('#txtMensagem').text = 'Gerando QR Code...';

  try {
    const result = await comTimeout(
      createPixCharge({ amount, email }),
      20000,
      'A geracao do Pix demorou demais. Tente novamente.'
    );

    currentDonationId = result.donationId || null;
    currentPixCode = result.pixCode || '';
    currentTicketUrl = result.ticketUrl || '';

    if (result.qrCodeImage) {
      $w('#imgQr').src = result.qrCodeImage;
      $w('#imgQr').expand();
      $w('#imgQr').show();
    }

    if (currentTicketUrl) {
      $w('#txtPix').text = '';
      $w('#txtPix').hide();
      $w('#txtPix').collapse();

      $w('#txtLinkPix').text = 'Abrir pagamento no Mercado Pago';
      $w('#txtLinkPix').expand();
      $w('#txtLinkPix').show();

      $w('#txtAjuda').text = 'Toque no link do Mercado Pago ou leia o QR Code';
      $w('#txtAjuda').expand();
      $w('#txtAjuda').show();
    } else if (currentPixCode) {
      $w('#txtPix').text = currentPixCode;
      $w('#txtPix').expand();
      $w('#txtPix').show();

      $w('#txtAjuda').text = 'Clique no codigo para copiar ou leia o QR Code';
      $w('#txtAjuda').expand();
      $w('#txtAjuda').show();
    }

    if (result.status) {
      $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
      $w('#txtStatus').expand();
      $w('#txtStatus').show();
    }

    if (result.expiresAt) {
      $w('#txtExpiracao').text =
        'Expira em: ' + new Date(result.expiresAt).toLocaleString('pt-BR');
      $w('#txtExpiracao').expand();
      $w('#txtExpiracao').show();
    }

    $w('#txtMensagem').text = emailInput
      ? 'Seu QR Code aparecera aqui'
      : 'QR Code gerado com email padrao';

    iniciarConsultaStatus();
  } catch (error) {
    console.log('Erro ao gerar PIX:', getErrorMessage(error));
    $w('#txtMensagem').text = getErrorMessage(error) || 'Erro ao gerar PIX';
  } finally {
    isGeneratingPix = false;
  }
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} timeoutMs
 * @param {string} mensagem
 * @returns {Promise<T>}
 */
function comTimeout(promise, timeoutMs, mensagem) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(mensagem));
      }, timeoutMs);
    })
  ]);
}

function configurarCliqueNoCodigo() {
  registrarClique('#txtPix', async () => {
    await copiarCodigoPix();
  });

  registrarClique('#txtLinkPix', () => {
    abrirLinkPix();
  });
}

async function copiarCodigoPix() {
  if (!currentPixCode) return;

  try {
    await wixWindowFrontend.copyToClipboard(currentPixCode);
    $w('#txtAjuda').text = 'Codigo copiado com sucesso.';
  } catch (error) {
    console.log('Falha ao copiar:', getErrorMessage(error));
    $w('#txtAjuda').text = 'Nao foi possivel copiar automaticamente.';
  }

  $w('#txtAjuda').expand();
  $w('#txtAjuda').show();
}

function abrirLinkPix() {
  if (!currentTicketUrl) return;

  wixLocationFrontend.to(currentTicketUrl);
}

function limparResultado() {
  currentDonationId = null;
  currentPixCode = '';
  currentTicketUrl = '';
  limparGeracaoMobileAgendada();

  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  $w('#imgQr').hide();
  $w('#imgQr').collapse();

  $w('#txtPix').text = '';
  $w('#txtPix').hide();
  $w('#txtPix').collapse();

  $w('#txtAjuda').text = '';
  $w('#txtAjuda').hide();
  $w('#txtAjuda').collapse();

  $w('#txtStatus').text = '';
  $w('#txtStatus').hide();
  $w('#txtStatus').collapse();

  $w('#txtExpiracao').text = '';
  $w('#txtExpiracao').hide();
  $w('#txtExpiracao').collapse();

  $w('#txtLinkPix').text = '';
  $w('#txtLinkPix').hide();
  $w('#txtLinkPix').collapse();
}

function configurarFallbackMobile() {
  if (!isMobileFormFactor()) {
    return;
  }

  $w('#inputValor').onInput(() => {
    agendarGeracaoMobile();
  });

  $w('#inputValor').onChange(() => {
    agendarGeracaoMobile();
  });

  $w('#inputEmail').onInput(() => {
    agendarGeracaoMobile();
  });

  $w('#inputEmail').onChange(() => {
    agendarGeracaoMobile();
  });
}

function agendarGeracaoMobile() {
  limparGeracaoMobileAgendada();

  const amountRaw = String($w('#inputValor').value || '').trim();
  if (!amountRaw) {
    return;
  }

  autoGenerateTimer = setTimeout(() => {
    autoGenerateTimer = null;
    void gerarPix();
  }, MOBILE_AUTO_GENERATE_DELAY_MS);
}

function limparGeracaoMobileAgendada() {
  if (!autoGenerateTimer) {
    return;
  }

  clearTimeout(autoGenerateTimer);
  autoGenerateTimer = null;
}

function isMobileFormFactor() {
  return String(wixWindowFrontend.formFactor || '').toLowerCase() === 'mobile';
}

function iniciarConsultaStatus() {
  if (pollTimer) {
    clearInterval(pollTimer);
  }

  pollTimer = setInterval(async () => {
    if (!currentDonationId) return;

    try {
      const result = await getPixStatus(currentDonationId);

      if (result && result.status) {
        $w('#txtStatus').text = 'Status: ' + traduzirStatus(result.status);
        $w('#txtStatus').expand();
        $w('#txtStatus').show();
      }
    } catch (error) {
      console.log('Erro ao consultar status:', getErrorMessage(error));
    }
  }, 15000);
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || 'Erro desconhecido');
}

/**
 * @param {string} status
 */
function traduzirStatus(status) {
  if (status === 'approved') return 'pago';
  if (status === 'pending') return 'aguardando pagamento';
  if (status === 'in_process') return 'em processamento';
  if (status === 'rejected') return 'rejeitado';
  if (status === 'cancelled') return 'cancelado';
  return status;
}
