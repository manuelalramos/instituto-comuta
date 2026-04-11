/* global window */

import { createPixCharge, getPixStatus } from 'backend/pix.web';
import { createHostedDonationCheckout } from 'backend/subscriptions.web';
import { lookupAddressByCep } from 'backend/address.web';
import wixLocationFrontend from 'wix-location-frontend';
import wixWindowFrontend from 'wix-window-frontend';

const FIXED_PIX_KEY = 'doe@institutocomuta.org.br';
const CARD_FREQUENCY_BUTTONS = {
  one_time: '#btnFrequencyOneTime',
  weekly: '#btnFrequencyWeekly',
  monthly: '#btnFrequencyMonthly',
  yearly: '#btnFrequencyYearly'
};
const CARD_AMOUNT_PRESETS = {
  '#btnAmount5': { amount: 5, presetCode: 'amount_5' },
  '#btnAmount10': { amount: 10, presetCode: 'amount_10' },
  '#btnAmount20': { amount: 20, presetCode: 'amount_20' },
  '#btnAmount50': { amount: 50, presetCode: 'amount_50' }
};
const CARD_EMAIL_PRIMARY_SELECTORS = ['#inputCardEmail', '#input1DAC883', '#inputEmailCard'];
const CARD_EMAIL_CONFIRM_SELECTORS = ['#inputCardEmailConfirm', '#inputEmailConfirm'];
const CARD_MESSAGE_SELECTORS = ['#txtCardStatus', '#txtCardMessage'];
const CARD_SUMMARY_SELECTORS = ['#txtSubscriptionSummary'];

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
/** @type {'one_time' | 'weekly' | 'monthly' | 'yearly' | ''} */
let cardSelectedRecurrence = '';
/** @type {number | null} */
let cardSelectedPresetAmount = null;
/** @type {string} */
let cardSelectedPresetCode = '';
/** @type {ReturnType<typeof setTimeout> | null} */
let cepLookupTimer = null;
/** @type {boolean} */
let isCreatingCardCheckout = false;
/** @type {boolean} */
let isUpdatingCardAmountInput = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let cardCheckoutFeedbackTimer = null;
/** @type {ReturnType<typeof setTimeout> | null} */
let cardCheckoutRedirectTimer = null;
/** @type {string} */
let pendingCardCheckoutUrl = '';
const cardOriginalButtonLabels = new Map();

$w.onReady(function () {
  const textoInicial = 'Clique acima para copiar o Pix';
  setTextIfExists('#ajudaPix', textoInicial);

  const copiarPixFixo = async () => {
    try {
      await wixWindowFrontend.copyToClipboard(FIXED_PIX_KEY);
      setTextIfExists('#ajudaPix', 'Pix copiado');
    } catch (error) {
      console.log('Erro ao copiar Pix:', getErrorMessage(error));
      setTextIfExists('#ajudaPix', 'Nao foi possivel copiar o Pix');
    }

    setTimeout(() => {
      setTextIfExists('#ajudaPix', textoInicial);
    }, 2000);
  };

  registrarCliqueOpcional('#btnCopiarPix', copiarPixFixo);
  registrarCliqueOpcional('#ajudaPix', copiarPixFixo);
  registrarCliqueOpcional('#text2', copiarPixFixo);

  prepararTela();
  configurarBotoesDeValor();
  configurarBotaoGerar();
  configurarCliqueNoCodigo();
  configurarFallbackMobile();
  configurarCheckoutCartao();
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

function registrarCliqueOpcional(seletor, acao) {
  const elemento = getOptionalElement(seletor);
  if (!elemento || typeof elemento.onClick !== 'function') {
    return;
  }

  elemento.onClick(() => {
    return acao();
  });
}

function getOptionalElement(seletor) {
  try {
    return $w(seletor);
  } catch (error) {
    console.log(`Elemento indisponivel no layout atual: ${seletor}`, getErrorMessage(error));
    return null;
  }
}

function setTextIfExists(seletor, texto) {
  const elemento = getOptionalElement(seletor);
  if (elemento && 'text' in elemento) {
    elemento.text = texto;
  }
}

function hideAndCollapseIfExists(seletor) {
  const elemento = getOptionalElement(seletor);
  if (!elemento) {
    return;
  }

  if (typeof elemento.hide === 'function') {
    elemento.hide();
  }

  if (typeof elemento.collapse === 'function') {
    elemento.collapse();
  }
}

function showAndExpandIfExists(seletor) {
  const elemento = getOptionalElement(seletor);
  if (!elemento) {
    return;
  }

  if (typeof elemento.expand === 'function') {
    elemento.expand();
  }

  if (typeof elemento.show === 'function') {
    elemento.show();
  }
}

function prepararTela() {
  $w('#inputValor').value = '';
  $w('#inputEmail').value = '';

  $w('#txtMensagem').text = 'Seu QR Code aparecera aqui';
  setTextIfExists('#txtPix', '');
  setTextIfExists('#txtStatus', '');
  setTextIfExists('#txtExpiracao', '');
  setTextIfExists('#txtAjuda', '');
  setTextIfExists('#txtLinkPix', '');

  hideAndCollapseIfExists('#imgQr');
  hideAndCollapseIfExists('#imgQrMobile');
  hideAndCollapseIfExists('#txtPix');
  hideAndCollapseIfExists('#txtAjuda');
  hideAndCollapseIfExists('#txtStatus');
  hideAndCollapseIfExists('#txtExpiracao');
  hideAndCollapseIfExists('#txtLinkPix');
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

  const amountRaw = getNormalizedAmountInput();
  const email = getNormalizedEmailInput();
  const amount = Number(amountRaw.replace(',', '.'));

  if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
    await $w('#inputValor').scrollTo();
    $w('#inputValor').focus();
    $w('#txtMensagem').text = 'Digite um valor valido para continuar';
    return;
  }

  if (!email) {
    await $w('#inputEmail').scrollTo();
    $w('#inputEmail').focus();
    $w('#txtMensagem').text = 'Digite seu email para gerar o pagamento';
    return;
  }

  if (!isValidEmail(email)) {
    await $w('#inputEmail').scrollTo();
    $w('#inputEmail').focus();
    $w('#txtMensagem').text = 'Digite um email valido para gerar o pagamento';
    return;
  }

  isGeneratingPix = true;
  setGerarPixDisponivel(false);
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
  const imgQr = getOptionalElement('#imgQr');
  if (imgQr && 'src' in imgQr) {
    imgQr.src = result.qrCodeImage;
  }
  showAndExpandIfExists('#imgQr');

  const imgQrMobile = getOptionalElement('#imgQrMobile');
  if (imgQrMobile && 'src' in imgQrMobile) {
    imgQrMobile.src = result.qrCodeImage;
  }
  showAndExpandIfExists('#imgQrMobile');
}

    if (currentTicketUrl) {
      setTextIfExists('#txtPix', '');
      hideAndCollapseIfExists('#txtPix');

      setTextIfExists('#txtLinkPix', 'Abrir pagamento no Mercado Pago');
      showAndExpandIfExists('#txtLinkPix');

      setTextIfExists('#txtAjuda', 'Toque no link do Mercado Pago ou leia o QR Code');
      showAndExpandIfExists('#txtAjuda');
    } else if (currentPixCode) {
      setTextIfExists('#txtPix', currentPixCode);
      showAndExpandIfExists('#txtPix');

      setTextIfExists('#txtAjuda', 'Clique no codigo para copiar ou leia o QR Code');
      showAndExpandIfExists('#txtAjuda');
    }

    if (result.status) {
      setTextIfExists('#txtStatus', 'Status: ' + traduzirStatus(result.status));
      showAndExpandIfExists('#txtStatus');
    }

    if (result.expiresAt) {
      setTextIfExists(
        '#txtExpiracao',
        'Expira em: ' + new Date(result.expiresAt).toLocaleString('pt-BR')
      );
      showAndExpandIfExists('#txtExpiracao');
    }

    $w('#txtMensagem').text = 'QR Code gerado com sucesso';

    iniciarConsultaStatus();
  } catch (error) {
    console.log('Erro ao gerar PIX:', getErrorMessage(error));
    $w('#txtMensagem').text = getErrorMessage(error) || 'Erro ao gerar PIX';
  } finally {
    isGeneratingPix = false;
    setGerarPixDisponivel(true);
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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(mensagem));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function configurarCliqueNoCodigo() {
  registrarCliqueOpcional('#txtPix', async () => {
    await copiarCodigoPix();
  });

  registrarCliqueOpcional('#txtLinkPix', () => {
    abrirLinkPix();
  });
}

async function copiarCodigoPix() {
  if (!currentPixCode) return;

  try {
    await wixWindowFrontend.copyToClipboard(currentPixCode);
    setTextIfExists('#txtAjuda', 'Codigo copiado com sucesso.');
  } catch (error) {
    console.log('Falha ao copiar:', getErrorMessage(error));
    setTextIfExists('#txtAjuda', 'Nao foi possivel copiar automaticamente.');
  }

  showAndExpandIfExists('#txtAjuda');
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

  hideAndCollapseIfExists('#imgQr');
  hideAndCollapseIfExists('#imgQrMobile');

  setTextIfExists('#txtPix', '');
  hideAndCollapseIfExists('#txtPix');

  setTextIfExists('#txtAjuda', '');
  hideAndCollapseIfExists('#txtAjuda');

  setTextIfExists('#txtStatus', '');
  hideAndCollapseIfExists('#txtStatus');

  setTextIfExists('#txtExpiracao', '');
  hideAndCollapseIfExists('#txtExpiracao');

  setTextIfExists('#txtLinkPix', '');
  hideAndCollapseIfExists('#txtLinkPix');
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

  const amountRaw = getNormalizedAmountInput();
  const email = getNormalizedEmailInput();
  const amount = Number(amountRaw.replace(',', '.'));

  if (!amountRaw || Number.isNaN(amount) || amount <= 0) {
    return;
  }

  if (!email || !isValidEmail(email)) {
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

/**
 * @param {boolean} disponivel
 */
function setGerarPixDisponivel(disponivel) {
  const botao = getOptionalElement('#btnGerarPix');
  if (!botao) {
    return;
  }

  if (disponivel && typeof botao.enable === 'function') {
    botao.enable();
  }

  if (!disponivel && typeof botao.disable === 'function') {
    botao.disable();
  }
}

function getNormalizedAmountInput() {
  return String($w('#inputValor').value || '').trim();
}

function getNormalizedEmailInput() {
  return String($w('#inputEmail').value || '').trim().toLowerCase();
}

/**
 * @param {string} email
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function configurarCheckoutCartao() {
  prepararCheckoutCartao();
  memorizarLabelsOriginaisCartao();
  configurarBotoesFrequenciaCartao();
  configurarBotoesValorCartao();
  configurarInputValorCartao();
  configurarMascarasCartao();
  configurarBuscaCepCartao();
  configurarInvalidacaoCheckoutCartao();
  configurarBotaoCheckoutCartao();
}

function prepararCheckoutCartao() {
  limparCheckoutCartaoPendente();
  setCardMessage('Preencha os dados para continuar no Mercado Pago.');
  setCardSummary('Escolha a frequência e o valor para continuar.');
  restaurarLabelBotaoCheckoutCartao();
  hideAndCollapseIfExists('#loadingStrip');
}

function memorizarLabelsOriginaisCartao() {
  const buttonIds = [
    ...Object.values(CARD_FREQUENCY_BUTTONS),
    ...Object.keys(CARD_AMOUNT_PRESETS),
    '#btnContinueToMercadoPago'
  ];

  buttonIds.forEach((buttonId) => {
    const button = getOptionalElement(buttonId);
    if (button && 'label' in button) {
      cardOriginalButtonLabels.set(buttonId, button.label);
    }
  });
}

function configurarBotoesFrequenciaCartao() {
  habilitarBotoesCartao(Object.values(CARD_FREQUENCY_BUTTONS));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.one_time, () => selecionarFrequenciaCartao('one_time'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.weekly, () => selecionarFrequenciaCartao('weekly'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.monthly, () => selecionarFrequenciaCartao('monthly'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.yearly, () => selecionarFrequenciaCartao('yearly'));
}

function configurarBotoesValorCartao() {
  habilitarBotoesCartao(Object.keys(CARD_AMOUNT_PRESETS));
  Object.entries(CARD_AMOUNT_PRESETS).forEach(([buttonId, config]) => {
    registrarCliqueOpcional(buttonId, () => selecionarValorPresetCartao(config.amount, config.presetCode));
  });
}

function configurarInputValorCartao() {
  const inputValor = getOptionalElement('#inputAmountCustom');
  if (!inputValor || typeof inputValor.onInput !== 'function') {
    return;
  }

  inputValor.onInput(() => {
    if (isUpdatingCardAmountInput) {
      return;
    }

    limparCheckoutCartaoPendente();
    const sanitizedValue = formatarValorDigitadoCartao(inputValor.value);
    if (sanitizedValue !== inputValor.value) {
      isUpdatingCardAmountInput = true;
      inputValor.value = sanitizedValue;
      isUpdatingCardAmountInput = false;
    }

    if (parseValorCartao(sanitizedValue) > 0) {
      cardSelectedPresetAmount = null;
      cardSelectedPresetCode = '';
      atualizarBotoesValorCartao();
    }

    atualizarResumoCartao();
  });

  if (typeof inputValor.onBlur === 'function') {
    inputValor.onBlur(() => {
      if (isUpdatingCardAmountInput) {
        return;
      }

      inputValor.value = formatarValorDigitadoCartao(inputValor.value);
      atualizarResumoCartao();
    });
  }
}

function configurarMascarasCartao() {
  configurarMascaraInput('#inputCpf', formatarCpf);
  configurarMascaraInput('#inputPhone', formatarTelefoneBrasil);
  configurarMascaraInput('#inputZipCode', formatarCep);

  const estado = getOptionalElement('#inputState');
  if (estado && typeof estado.onInput === 'function') {
    estado.onInput(() => {
      estado.value = formatarEstado(estado.value);
    });
  }
}

function configurarBuscaCepCartao() {
  const cepInput = getOptionalElement('#inputZipCode');
  if (!cepInput || typeof cepInput.onInput !== 'function') {
    return;
  }

  const dispararBusca = () => {
    limparBuscaCepAgendada();
    const cep = normalizeZipCodeBrazil(cepInput.value);
    if (!/^\d{8}$/.test(cep)) {
      return;
    }

    cepLookupTimer = setTimeout(async () => {
      cepLookupTimer = null;
      await buscarEnderecoPorCepCartao();
    }, 350);
  };

  cepInput.onInput(dispararBusca);

  if (typeof cepInput.onBlur === 'function') {
    cepInput.onBlur(() => {
      void buscarEnderecoPorCepCartao();
    });
  }
}

function configurarBotaoCheckoutCartao() {
  habilitarBotoesCartao(['#btnContinueToMercadoPago']);
  registrarCliqueOpcional('#btnContinueToMercadoPago', async () => {
    if (pendingCardCheckoutUrl) {
      return;
    }

    await criarCheckoutCartaoHospedado();
  });
}

function configurarInvalidacaoCheckoutCartao() {
  const selectors = [
    '#inputFirstName',
    '#inputLastName',
    '#inputPhone',
    '#inputCpf',
    '#inputZipCode',
    '#inputStreet',
    '#inputStreetNumber',
    '#inputComplement',
    '#inputNeighborhood',
    '#inputCity',
    '#inputState',
    '#inputAmountCustom',
    '#checkboxTerms',
    ...CARD_EMAIL_PRIMARY_SELECTORS,
    ...CARD_EMAIL_CONFIRM_SELECTORS
  ];

  selectors.forEach((selector) => {
    const element = getOptionalElement(selector);
    if (!element) {
      return;
    }

    if (typeof element.onInput === 'function') {
      element.onInput(() => {
        limparCheckoutCartaoPendente();
      });
    }

    if (typeof element.onChange === 'function') {
      element.onChange(() => {
        limparCheckoutCartaoPendente();
      });
    }
  });
}

/**
 * @param {'one_time' | 'weekly' | 'monthly' | 'yearly'} recurrence
 */
function selecionarFrequenciaCartao(recurrence) {
  limparCheckoutCartaoPendente();
  cardSelectedRecurrence = recurrence;
  atualizarBotoesFrequenciaCartao();
  atualizarBotoesValorCartao();
  atualizarResumoCartao();
}

/**
 * @param {number} amount
 * @param {string} presetCode
 */
function selecionarValorPresetCartao(amount, presetCode) {
  limparCheckoutCartaoPendente();
  cardSelectedPresetAmount = amount;
  cardSelectedPresetCode = presetCode;

  escreverValorCartaoNoInput(amount);

  atualizarBotoesFrequenciaCartao();
  atualizarBotoesValorCartao();
  atualizarResumoCartao();
}

async function buscarEnderecoPorCepCartao() {
  const cepInput = getOptionalElement('#inputZipCode');
  if (!cepInput || !('value' in cepInput)) {
    return;
  }

  const cep = normalizeZipCodeBrazil(cepInput.value);
  if (!/^\d{8}$/.test(cep)) {
    return;
  }

  try {
    setCardMessage('Buscando endereco pelo CEP...');
    const address = await lookupAddressByCep(cep);

    preencherInputSeVazio('#inputStreet', address.street);
    preencherInputSeVazio('#inputNeighborhood', address.neighborhood);
    preencherInputSeVazio('#inputCity', address.city);
    preencherInputSeVazio('#inputState', address.state);
    preencherInputSeVazio('#inputComplement', address.complement);

    setCardMessage('Endereco preenchido automaticamente. Confira os dados.');
  } catch (error) {
    setCardMessage(getErrorMessage(error) || 'Nao foi possivel localizar o CEP.');
  }
}

async function criarCheckoutCartaoHospedado() {
  if (isCreatingCardCheckout) {
    return;
  }

  const validation = validarFormularioCartao();
  if (!validation.ok) {
    setCardMessage(validation.message);

    if (validation.elementId) {
      await focarElementoOpcional(validation.elementId);
    }
    return;
  }

  isCreatingCardCheckout = true;
  setCheckoutCartaoDisponivel(false);
  showAndExpandIfExists('#loadingStrip');
  setCardMessage('Te direcionando para o Mercado Pago...');
  definirLabelBotaoCheckoutCartao('Abrindo Mercado Pago...');

  try {
    const payload = coletarPayloadCheckoutCartao();
    const result = await createHostedDonationCheckout(payload);
    const checkoutUrl = normalizeStringCard(result?.checkoutUrl);

    if (!checkoutUrl) {
      throw new Error('O Mercado Pago nao retornou a URL do checkout.');
    }

    pendingCardCheckoutUrl = checkoutUrl;
    configurarLinkBotaoCheckoutCartao(checkoutUrl);
    setCheckoutCartaoDisponivel(true);
    hideAndCollapseIfExists('#loadingStrip');
    definirLabelBotaoCheckoutCartao('Abrir Mercado Pago');
    setCardMessage('Pagamento pronto. Toque no botao para abrir o Mercado Pago.');
  } catch (error) {
    limparCheckoutCartaoPendente();
    setCardMessage(getFriendlyCardCheckoutErrorMessage(error));
    flashLabelBotaoCheckoutCartao(getFriendlyCardCheckoutButtonLabel(error));
    setCheckoutCartaoDisponivel(true);
    hideAndCollapseIfExists('#loadingStrip');
    restaurarLabelBotaoCheckoutCartao();
  } finally {
    isCreatingCardCheckout = false;
  }
}

function validarFormularioCartao() {
  const requiredFields = [
    ['#inputFirstName', 'Informe o nome.'],
    ['#inputLastName', 'Informe o sobrenome.'],
    ['#inputPhone', 'Informe um celular com DDD.'],
    ['#inputCpf', 'Informe um CPF valido.'],
    ['#inputZipCode', 'Informe um CEP valido.'],
    ['#inputStreet', 'Informe o endereco.'],
    ['#inputStreetNumber', 'Informe o numero.'],
    ['#inputNeighborhood', 'Informe o bairro.'],
    ['#inputCity', 'Informe a cidade.'],
    ['#inputState', 'Informe o estado com a UF.']
  ];

  for (const [elementId, message] of requiredFields) {
    const value = getInputValueIfExists(elementId);
    if (!normalizeStringCard(value)) {
      return { ok: false, elementId, message };
    }
  }

  if (!cardSelectedRecurrence) {
    return { ok: false, elementId: '', message: 'Selecione a frequÃªncia da doaÃ§Ã£o.' };
  }

  if (obterValorSelecionadoCartao() <= 0) {
    return { ok: false, elementId: '#inputAmountCustom', message: 'Informe um valor vÃ¡lido para a doaÃ§Ã£o.' };
  }

  const cardEmailSelector = getCardEmailSelector();
  const cardEmail = getInputValueIfExists(cardEmailSelector);

  if (!normalizeStringCard(cardEmail)) {
    return { ok: false, elementId: cardEmailSelector, message: 'Informe um email válido.' };
  }

  if (!isValidEmail(cardEmail)) {
    return { ok: false, elementId: cardEmailSelector, message: 'Informe um email válido.' };
  }

  const emailConfirm = getOptionalElement(getCardEmailConfirmSelector());
  if (emailConfirm && 'value' in emailConfirm) {
    const confirmValue = normalizeStringCard(emailConfirm.value);
    if (confirmValue && confirmValue !== normalizeStringCard(cardEmail)) {
      return { ok: false, elementId: getCardEmailConfirmSelector(), message: 'Os emails precisam ser iguais.' };
    }
  }

  if (!isValidBrazilPhoneCard(getInputValueIfExists('#inputPhone'))) {
    return { ok: false, elementId: '#inputPhone', message: 'Informe um celular com DDD.' };
  }

  if (!isValidCpfCard(getInputValueIfExists('#inputCpf'))) {
    return { ok: false, elementId: '#inputCpf', message: 'Informe um CPF válido.' };
  }

  if (!/^\d{8}$/.test(normalizeZipCodeBrazil(getInputValueIfExists('#inputZipCode')))) {
    return { ok: false, elementId: '#inputZipCode', message: 'Informe um CEP válido.' };
  }

  if (!normalizeStringCard(getStreetValueCartao())) {
    return { ok: false, elementId: '#inputStreet', message: 'Informe o endereco.' };
  }

  if (!/^[A-Z]{2}$/.test(formatarEstado(getInputValueIfExists('#inputState')))) {
    return { ok: false, elementId: '#inputState', message: 'Informe o estado com a UF.' };
  }

  if (!cardSelectedRecurrence) {
    return { ok: false, elementId: '', message: 'Selecione a frequência da doação.' };
  }

  if (obterValorSelecionadoCartao() <= 0) {
    return { ok: false, elementId: '#inputAmountCustom', message: 'Informe um valor válido para a doação.' };
  }

  const checkboxTerms = getOptionalElement('#checkboxTerms');
  if (!checkboxTerms || checkboxTerms.checked !== true) {
    return { ok: false, elementId: '#checkboxTerms', message: 'Aceite os termos para continuar.' };
  }

  return { ok: true, elementId: '', message: '' };
}

function coletarPayloadCheckoutCartao() {
  const cardEmailSelector = getCardEmailSelector();
  const street = getStreetValueCartao();
  const streetNumber = normalizeStringCard(getInputValueIfExists('#inputStreetNumber')) || getStreetNumberFromAddressCartao();

  return {
    firstName: normalizeStringCard(getInputValueIfExists('#inputFirstName')),
    lastName: normalizeStringCard(getInputValueIfExists('#inputLastName')),
    email: normalizeStringCard(getInputValueIfExists(cardEmailSelector)).toLowerCase(),
    phone: normalizePhoneBrazil(getInputValueIfExists('#inputPhone')),
    cpf: normalizeCpfCard(getInputValueIfExists('#inputCpf')),
    amount: obterValorSelecionadoCartao(),
    amountSource: cardSelectedPresetAmount ? 'preset' : 'custom',
    presetCode: cardSelectedPresetCode,
    recurrence: cardSelectedRecurrence,
    zipCode: normalizeZipCodeBrazil(getInputValueIfExists('#inputZipCode')),
    street,
    streetNumber,
    complement: normalizeStringCard(getInputValueIfExists('#inputComplement')),
    neighborhood: normalizeStringCard(getInputValueIfExists('#inputNeighborhood')),
    city: normalizeStringCard(getInputValueIfExists('#inputCity')),
    state: formatarEstado(getInputValueIfExists('#inputState')),
    termsAccepted: true
  };
}

function atualizarResumoCartao() {
  const amount = obterValorSelecionadoCartao();
  if (!cardSelectedRecurrence || amount <= 0) {
    setCardSummary('Escolha a frequência e o valor para continuar.');
    return;
  }

  const formattedAmount = formatCurrency(amount);

  if (cardSelectedRecurrence === 'one_time') {
    setCardSummary(`Você vai fazer uma doação única de ${formattedAmount}.`);
    return;
  }

  if (cardSelectedRecurrence === 'weekly') {
    setCardSummary(`Você vai doar ${formattedAmount} por semana até cancelar.`);
    return;
  }

  if (cardSelectedRecurrence === 'yearly') {
    setCardSummary(`Você vai doar ${formattedAmount} por ano até cancelar.`);
    return;
  }

  setCardSummary(`Você vai doar ${formattedAmount} por mês até cancelar.`);
}

function atualizarBotoesFrequenciaCartao() {
  Object.entries(CARD_FREQUENCY_BUTTONS).forEach(([recurrence, buttonId]) => {
    atualizarBotaoSelecionavelCartao(buttonId, recurrence === cardSelectedRecurrence);
  });
}

function atualizarBotoesValorCartao() {
  Object.entries(CARD_AMOUNT_PRESETS).forEach(([buttonId, config]) => {
    atualizarBotaoSelecionavelCartao(buttonId, config.amount === cardSelectedPresetAmount);
  });
}

/**
 * @param {string} buttonId
 * @param {boolean} isSelected
 */
function atualizarBotaoSelecionavelCartao(buttonId, isSelected) {
  const button = getOptionalElement(buttonId);
  if (!button || !('label' in button)) {
    return;
  }

  const originalLabel = cardOriginalButtonLabels.get(buttonId) || button.label;
  button.label = isSelected ? `> ${removerPrefixoSelecionadoCartao(originalLabel)}` : removerPrefixoSelecionadoCartao(originalLabel);
}

/**
 * @param {string} label
 */
function removerPrefixoSelecionadoCartao(label) {
  return String(label || '').replace(/^>\s*/, '');
}

function limparBuscaCepAgendada() {
  if (!cepLookupTimer) {
    return;
  }

  clearTimeout(cepLookupTimer);
  cepLookupTimer = null;
}

function obterValorSelecionadoCartao() {
  const customAmount = parseValorCartao(getInputValueIfExists('#inputAmountCustom'));
  if (customAmount > 0) {
    return customAmount;
  }

  return cardSelectedPresetAmount || 0;
}

/**
 * @param {string} selector
 * @param {(value: string) => string} formatter
 */
function configurarMascaraInput(selector, formatter) {
  const input = getOptionalElement(selector);
  if (!input || typeof input.onInput !== 'function') {
    return;
  }

  input.onInput(() => {
    input.value = formatter(input.value);
  });
}

/**
 * @param {string} selector
 */
function getInputValueIfExists(selector) {
  if (!selector) {
    return '';
  }

  const input = getOptionalElement(selector);
  if (!input || !('value' in input)) {
    return '';
  }

  return normalizeInputValue(input.value);
}

function getCardEmailSelector() {
  return (
    getFirstFilledSelector([...CARD_EMAIL_PRIMARY_SELECTORS, '#inputEmail']) ||
    getFirstExistingSelector(CARD_EMAIL_PRIMARY_SELECTORS) ||
    '#inputEmail'
  );
}

function getCardEmailConfirmSelector() {
  return (
    getFirstFilledSelector(CARD_EMAIL_CONFIRM_SELECTORS) ||
    getFirstExistingSelector(CARD_EMAIL_CONFIRM_SELECTORS)
  );
}

/**
 * @param {string[]} selectors
 */
function getFirstExistingSelector(selectors) {
  for (const selector of selectors) {
    if (getOptionalElement(selector)) {
      return selector;
    }
  }

  return '';
}

/**
 * @param {string[]} selectors
 */
function getFirstFilledSelector(selectors) {
  for (const selector of selectors) {
    if (normalizeStringCard(getInputValueIfExists(selector))) {
      return selector;
    }
  }

  return '';
}

/**
 * @param {string} selector
 * @param {string} value
 */
function preencherInputSeVazio(selector, value) {
  const input = getOptionalElement(selector);
  if (!input || !('value' in input) || !normalizeStringCard(value)) {
    return;
  }

  if (!normalizeStringCard(normalizeInputValue(input.value))) {
    if (selector === '#inputStreet') {
      input.value = {
        formatted: value,
        streetAddress: {
          name: value
        }
      };
      return;
    }

    input.value = value;
  }
}

/**
 * @param {number} amount
 */
function escreverValorCartaoNoInput(amount) {
  const inputValor = getOptionalElement('#inputAmountCustom');
  if (!inputValor || !('value' in inputValor)) {
    return;
  }

  const formatted = formatarValorPresetInputCartao(amount);

  isUpdatingCardAmountInput = true;
  inputValor.value = formatted;
  isUpdatingCardAmountInput = false;

  setTimeout(() => {
    const currentInput = getOptionalElement('#inputAmountCustom');
    if (!currentInput || !('value' in currentInput)) {
      return;
    }

    isUpdatingCardAmountInput = true;
    currentInput.value = formatted;
    isUpdatingCardAmountInput = false;
  }, 0);
}

/**
 * @param {string} selector
 */
async function focarElementoOpcional(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.scrollTo === 'function') {
    await element.scrollTo();
  }

  if (typeof element.focus === 'function') {
    element.focus();
  }
}

/**
 * @param {boolean} available
 */
function setCheckoutCartaoDisponivel(available) {
  const button = getOptionalElement('#btnContinueToMercadoPago');
  if (!button) {
    return;
  }

  if (available && typeof button.enable === 'function') {
    button.enable();
  }

  if (!available && typeof button.disable === 'function') {
    button.disable();
  }
}

/**
 * @param {string} checkoutUrl
 */
function redirecionarParaCheckoutCartao(checkoutUrl) {
  const url = normalizeStringCard(checkoutUrl);
  if (!url) {
    return;
  }

  pendingCardCheckoutUrl = url;
  configurarLinkBotaoCheckoutCartao(url);
  definirLabelBotaoCheckoutCartao('Abrindo Mercado Pago...');
  setCardMessage('Te direcionando para o Mercado Pago...');
  setCheckoutCartaoDisponivel(false);

  try {
    if (typeof window !== 'undefined' && window.location && typeof window.location.assign === 'function') {
      window.location.assign(url);
      return;
    }

    wixLocationFrontend.to(url);
  } catch (error) {
    console.log('Falha ao redirecionar para o checkout:', getErrorMessage(error));
  }

  clearTimeoutIfExists(cardCheckoutRedirectTimer);
  cardCheckoutRedirectTimer = setTimeout(() => {
    finalizarFallbackCheckoutCartao(url);
  }, 800);
}

/**
 * @param {string} checkoutUrl
 */
function finalizarFallbackCheckoutCartao(checkoutUrl) {
  const url = normalizeStringCard(checkoutUrl);
  if (!url) {
    return;
  }

  clearTimeoutIfExists(cardCheckoutRedirectTimer);
  cardCheckoutRedirectTimer = setTimeout(() => {
    if (pendingCardCheckoutUrl !== url) {
      return;
    }

    setCheckoutCartaoDisponivel(true);
    hideAndCollapseIfExists('#loadingStrip');
    definirLabelBotaoCheckoutCartao('Abrir Mercado Pago');
    setCardMessage('Se o Mercado Pago nao abriu automaticamente, toque no botao novamente.');
  }, 1200);
}

/**
 * @param {string} checkoutUrl
 */
function configurarLinkBotaoCheckoutCartao(checkoutUrl) {
  const button = getOptionalElement('#btnContinueToMercadoPago');
  if (!button) {
    return;
  }

  if ('link' in button) {
    button.link = checkoutUrl;
  }

  if ('target' in button) {
    button.target = '_self';
  }
}

function limparCheckoutCartaoPendente() {
  pendingCardCheckoutUrl = '';
  clearTimeoutIfExists(cardCheckoutRedirectTimer);
  cardCheckoutRedirectTimer = null;

  const button = getOptionalElement('#btnContinueToMercadoPago');
  if (!button) {
    return;
  }

  if ('link' in button) {
    button.link = '';
  }

  if ('target' in button) {
    button.target = '_self';
  }
}

function setCardMessage(text) {
  const wroteMessage = setFirstExistingText(CARD_MESSAGE_SELECTORS, text);
  if (!wroteMessage && normalizeStringCard(text)) {
    flashLabelBotaoCheckoutCartao(getCardCheckoutFallbackLabel(text));
  }
}

function setCardSummary(text) {
  setFirstExistingText(CARD_SUMMARY_SELECTORS, text);
}

/**
 * @param {string[]} selectors
 * @param {string} text
 */
function setFirstExistingText(selectors, text) {
  for (const selector of selectors) {
    const element = getOptionalElement(selector);
    if (element && 'text' in element) {
      element.text = text;
      return true;
    }
  }

  return false;
}

/**
 * @param {string[]} selectors
 */
function habilitarBotoesCartao(selectors) {
  selectors.forEach((selector) => {
    const button = getOptionalElement(selector);
    if (button && typeof button.enable === 'function') {
      button.enable();
    }
  });
}

/**
 * @param {unknown} value
 */
function normalizeStringCard(value) {
  return String(value || '').trim();
}

/**
 * @param {unknown} value
 */
function normalizeInputValue(value) {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value || '');
  }

  if (value && typeof value === 'object') {
    return getAddressFormattedValue(value);
  }

  return '';
}

function getStreetValueCartao() {
  const input = getOptionalElement('#inputStreet');
  if (!input || !('value' in input)) {
    return '';
  }

  const value = input.value;

  if (value && typeof value === 'object') {
    return normalizeStringCard(
      value?.streetAddress?.name ||
      value?.formatted ||
      ''
    );
  }

  return normalizeStringCard(value);
}

function getStreetNumberFromAddressCartao() {
  const input = getOptionalElement('#inputStreet');
  if (!input || !('value' in input)) {
    return '';
  }

  const value = input.value;
  if (!value || typeof value !== 'object') {
    return '';
  }

  return normalizeStringCard(value?.streetAddress?.number || '');
}

/**
 * @param {unknown} value
 */
function getAddressFormattedValue(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const formatted = normalizeStringCard(value?.formatted || '');
  if (formatted) {
    return formatted;
  }

  const streetName = normalizeStringCard(value?.streetAddress?.name || '');
  const streetNumber = normalizeStringCard(value?.streetAddress?.number || '');

  if (streetName && streetNumber) {
    return `${streetName}, ${streetNumber}`;
  }

  return streetName;
}

/**
 * @param {unknown} value
 */
function normalizeCpfCard(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

/**
 * @param {unknown} value
 */
function normalizePhoneBrazil(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  return digits.slice(0, 11);
}

/**
 * @param {unknown} value
 */
function normalizeZipCodeBrazil(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

/**
 * @param {unknown} value
 */
function parseValorCartao(value) {
  const raw = normalizeStringCard(value).replace(/[^\d,.\-]/g, '');
  if (!raw) {
    return 0;
  }

  const lastCommaIndex = raw.lastIndexOf(',');
  const lastDotIndex = raw.lastIndexOf('.');
  const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);

  let normalized = '';
  if (decimalIndex >= 0) {
    const integerPart = raw.slice(0, decimalIndex).replace(/\D/g, '');
    const decimalPart = raw.slice(decimalIndex + 1).replace(/\D/g, '').slice(0, 2);
    normalized = decimalPart ? `${integerPart || '0'}.${decimalPart}` : integerPart;
  } else {
    normalized = raw.replace(/\D/g, '');
  }

  const amount = Number(normalized);
  return !amount || Number.isNaN(amount) ? 0 : Number(amount.toFixed(2));
}

/**
 * @param {unknown} value
 */
function formatarCpf(value) {
  const digits = normalizeCpfCard(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.replace(/(\d{3})(\d+)/, '$1.$2');
  if (digits.length <= 9) return digits.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');

  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
}

/**
 * @param {unknown} value
 */
function formatarTelefoneBrasil(value) {
  const digits = normalizePhoneBrazil(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return digits.replace(/(\d{2})(\d+)/, '($1) $2');
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d{4})(\d+)/, '($1) $2-$3');

  return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
}

/**
 * @param {unknown} value
 */
function formatarCep(value) {
  const digits = normalizeZipCodeBrazil(value);

  if (digits.length <= 5) {
    return digits;
  }

  return digits.replace(/(\d{5})(\d{1,3})/, '$1-$2');
}

/**
 * @param {unknown} value
 */
function formatarEstado(value) {
  return String(value || '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * @param {unknown} value
 */
function formatarValorDigitadoCartao(value) {
  const raw = String(value || '').replace(/[^\d,.\sR$]/g, '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return '';
  }

  const digitsOnly = raw.replace(/\D/g, '');
  const lastCommaIndex = raw.lastIndexOf(',');
  const lastDotIndex = raw.lastIndexOf('.');
  const decimalIndex = Math.max(lastCommaIndex, lastDotIndex);

  if (decimalIndex < 0) {
    return digitsOnly;
  }

  const integerPart = raw.slice(0, decimalIndex).replace(/\D/g, '');
  const decimalPart = raw.slice(decimalIndex + 1).replace(/\D/g, '').slice(0, 2);

  return decimalPart ? `${integerPart || '0'},${decimalPart}` : (integerPart || '0');
}

/**
 * @param {number} amount
 */
function formatarValorPresetInputCartao(amount) {
  return String(Number(amount || 0));
}

/**
 * @param {number} amount
 */
function formatCurrency(amount) {
  return amount.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

/**
 * @param {number} ms
 */
function esperarCheckoutCartao(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {unknown} error
 */
function getFriendlyCardCheckoutErrorMessage(error) {
  const message = getErrorMessage(error) || 'Nao foi possivel criar o checkout.';

  if (message.includes('MP_SUBSCRIPTIONS_BACK_URL')) {
    return 'Falta configurar a URL de retorno do Mercado Pago no painel do Wix.';
  }

  if (message.includes('MP_ACCESS_TOKEN')) {
    return 'Falta configurar o token do Mercado Pago no painel do Wix.';
  }

  if (message.includes('Mercado Pago nao retornou a URL do checkout')) {
    return 'O Mercado Pago nao devolveu o link de pagamento. Confira as credenciais e o modo de teste.';
  }

  return message;
}

/**
 * @param {unknown} error
 */
function getFriendlyCardCheckoutButtonLabel(error) {
  return getCardCheckoutFallbackLabel(getFriendlyCardCheckoutErrorMessage(error));
}

/**
 * @param {string} text
 */
function getCardCheckoutFallbackLabel(text) {
  const message = normalizeStringCard(text).toLowerCase();

  if (!message) {
    return getCheckoutCartaoOriginalLabel();
  }

  if (message.includes('preencha os dados')) {
    return getCheckoutCartaoOriginalLabel();
  }

  if (message.includes('te direcionando') || message.includes('abrindo mercado pago')) {
    return 'Abrindo Mercado Pago...';
  }

  if (message.includes('email')) {
    return 'Revise o email';
  }

  if (message.includes('cpf')) {
    return 'Revise o CPF';
  }

  if (message.includes('celular')) {
    return 'Revise o celular';
  }

  if (message.includes('cep')) {
    return 'Revise o CEP';
  }

  if (message.includes('valor')) {
    return 'Informe o valor';
  }

  if (message.includes('frequ')) {
    return 'Escolha a frequencia';
  }

  if (message.includes('termos')) {
    return 'Aceite os termos';
  }

  return 'Tente novamente';
}

function getCheckoutCartaoOriginalLabel() {
  return cardOriginalButtonLabels.get('#btnContinueToMercadoPago') || 'Continuar';
}

/**
 * @param {string} label
 */
function definirLabelBotaoCheckoutCartao(label) {
  limparTimerFeedbackBotaoCheckoutCartao();
  const button = getOptionalElement('#btnContinueToMercadoPago');
  if (button && 'label' in button) {
    button.label = label;
  }
}

function restaurarLabelBotaoCheckoutCartao() {
  limparTimerFeedbackBotaoCheckoutCartao();
  const button = getOptionalElement('#btnContinueToMercadoPago');
  if (button && 'label' in button) {
    button.label = getCheckoutCartaoOriginalLabel();
  }
}

/**
 * @param {string} label
 */
function flashLabelBotaoCheckoutCartao(label) {
  definirLabelBotaoCheckoutCartao(label);
  cardCheckoutFeedbackTimer = setTimeout(() => {
    cardCheckoutFeedbackTimer = null;
    if (!isCreatingCardCheckout) {
      restaurarLabelBotaoCheckoutCartao();
    }
  }, 2400);
}

function limparTimerFeedbackBotaoCheckoutCartao() {
  if (!cardCheckoutFeedbackTimer) {
    return;
  }

  clearTimeout(cardCheckoutFeedbackTimer);
  cardCheckoutFeedbackTimer = null;
}

/**
 * @param {ReturnType<typeof setTimeout> | null} timer
 */
function clearTimeoutIfExists(timer) {
  if (!timer) {
    return;
  }

  clearTimeout(timer);
}

/**
 * @param {string} phone
 */
function isValidBrazilPhoneCard(phone) {
  return /^\d{10,11}$/.test(normalizePhoneBrazil(phone));
}

/**
 * @param {string} value
 */
function isValidCpfCard(value) {
  const cpf = normalizeCpfCard(value);

  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(cpf[index]) * (10 - index);
  }

  let firstDigit = (sum * 10) % 11;
  if (firstDigit === 10) firstDigit = 0;
  if (firstDigit !== Number(cpf[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(cpf[index]) * (11 - index);
  }

  let secondDigit = (sum * 10) % 11;
  if (secondDigit === 10) secondDigit = 0;

  return secondDigit === Number(cpf[10]);
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
        setTextIfExists('#txtStatus', 'Status: ' + traduzirStatus(result.status));
        showAndExpandIfExists('#txtStatus');
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
  if (status === 'approved') return 'Pago';
  if (status === 'pending') return 'Aguardando pagamento';
  if (status === 'in_process') return 'Em processamento';
  if (status === 'rejected') return 'Rejeitado';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}
