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
  configurarBotaoCheckoutCartao();
}

function prepararCheckoutCartao() {
  setTextIfExists('#txtCardMessage', 'Preencha os dados para continuar no Mercado Pago.');
  setTextIfExists('#txtSubscriptionSummary', 'Escolha a frequencia e o valor para continuar.');
  hideAndCollapseIfExists('#loadingStrip');
}

function memorizarLabelsOriginaisCartao() {
  const buttonIds = [
    ...Object.values(CARD_FREQUENCY_BUTTONS),
    ...Object.keys(CARD_AMOUNT_PRESETS)
  ];

  buttonIds.forEach((buttonId) => {
    const button = getOptionalElement(buttonId);
    if (button && 'label' in button) {
      cardOriginalButtonLabels.set(buttonId, button.label);
    }
  });
}

function configurarBotoesFrequenciaCartao() {
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.one_time, () => selecionarFrequenciaCartao('one_time'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.weekly, () => selecionarFrequenciaCartao('weekly'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.monthly, () => selecionarFrequenciaCartao('monthly'));
  registrarCliqueOpcional(CARD_FREQUENCY_BUTTONS.yearly, () => selecionarFrequenciaCartao('yearly'));
}

function configurarBotoesValorCartao() {
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

    inputValor.value = formatarValorDigitadoCartao(inputValor.value);

    if (parseValorCartao(inputValor.value) > 0) {
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

      const amount = parseValorCartao(inputValor.value);
      inputValor.value = amount > 0 ? formatarValorPresetInputCartao(amount) : '';
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
  registrarCliqueOpcional('#btnContinueToMercadoPago', async () => {
    await criarCheckoutCartaoHospedado();
  });
}

/**
 * @param {'one_time' | 'weekly' | 'monthly' | 'yearly'} recurrence
 */
function selecionarFrequenciaCartao(recurrence) {
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
  cardSelectedPresetAmount = amount;
  cardSelectedPresetCode = presetCode;

  const inputValor = getOptionalElement('#inputAmountCustom');
  if (inputValor && 'value' in inputValor) {
    isUpdatingCardAmountInput = true;
    inputValor.value = formatarValorPresetInputCartao(amount);
    isUpdatingCardAmountInput = false;
  }

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
    setTextIfExists('#txtCardMessage', 'Buscando endereco pelo CEP...');
    const address = await lookupAddressByCep(cep);

    preencherInputSeVazio('#inputStreet', address.street);
    preencherInputSeVazio('#inputNeighborhood', address.neighborhood);
    preencherInputSeVazio('#inputCity', address.city);
    preencherInputSeVazio('#inputState', address.state);
    preencherInputSeVazio('#inputComplement', address.complement);

    setTextIfExists('#txtCardMessage', 'Endereco preenchido automaticamente. Confira os dados.');
  } catch (error) {
    setTextIfExists('#txtCardMessage', getErrorMessage(error) || 'Nao foi possivel localizar o CEP.');
  }
}

async function criarCheckoutCartaoHospedado() {
  if (isCreatingCardCheckout) {
    return;
  }

  const validation = validarFormularioCartao();
  if (!validation.ok) {
    setTextIfExists('#txtCardMessage', validation.message);

    if (validation.elementId) {
      await focarElementoOpcional(validation.elementId);
    }
    return;
  }

  isCreatingCardCheckout = true;
  setCheckoutCartaoDisponivel(false);
  showAndExpandIfExists('#loadingStrip');
  setTextIfExists('#txtCardMessage', 'Redirecionando para o Mercado Pago...');

  try {
    const payload = coletarPayloadCheckoutCartao();
    const result = await createHostedDonationCheckout(payload);

    if (!result?.checkoutUrl) {
      throw new Error('O Mercado Pago nao retornou a URL do checkout.');
    }

    wixLocationFrontend.to(result.checkoutUrl);
  } catch (error) {
    setTextIfExists('#txtCardMessage', getErrorMessage(error) || 'Nao foi possivel criar o checkout.');
  } finally {
    isCreatingCardCheckout = false;
    setCheckoutCartaoDisponivel(true);
    hideAndCollapseIfExists('#loadingStrip');
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

  const cardEmailSelector = getCardEmailSelector();
  const cardEmail = getInputValueIfExists(cardEmailSelector);

  if (!normalizeStringCard(cardEmail)) {
    return { ok: false, elementId: cardEmailSelector, message: 'Informe um email valido.' };
  }

  if (!isValidEmail(cardEmail)) {
    return { ok: false, elementId: cardEmailSelector, message: 'Informe um email valido.' };
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
    return { ok: false, elementId: '#inputCpf', message: 'Informe um CPF valido.' };
  }

  if (!/^\d{8}$/.test(normalizeZipCodeBrazil(getInputValueIfExists('#inputZipCode')))) {
    return { ok: false, elementId: '#inputZipCode', message: 'Informe um CEP valido.' };
  }

  if (!/^[A-Z]{2}$/.test(formatarEstado(getInputValueIfExists('#inputState')))) {
    return { ok: false, elementId: '#inputState', message: 'Informe o estado com a UF.' };
  }

  if (!cardSelectedRecurrence) {
    return { ok: false, elementId: '', message: 'Selecione a frequencia da doacao.' };
  }

  if (obterValorSelecionadoCartao() <= 0) {
    return { ok: false, elementId: '#inputAmountCustom', message: 'Informe um valor valido para a doacao.' };
  }

  const checkboxTerms = getOptionalElement('#checkboxTerms');
  if (!checkboxTerms || checkboxTerms.checked !== true) {
    return { ok: false, elementId: '#checkboxTerms', message: 'Aceite os termos para continuar.' };
  }

  return { ok: true, elementId: '', message: '' };
}

function coletarPayloadCheckoutCartao() {
  const cardEmailSelector = getCardEmailSelector();

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
    street: normalizeStringCard(getInputValueIfExists('#inputStreet')),
    streetNumber: normalizeStringCard(getInputValueIfExists('#inputStreetNumber')),
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
    setTextIfExists('#txtSubscriptionSummary', 'Escolha a frequencia e o valor para continuar.');
    return;
  }

  const formattedAmount = formatCurrency(amount);

  if (cardSelectedRecurrence === 'one_time') {
    setTextIfExists('#txtSubscriptionSummary', `Voce vai fazer uma doacao unica de ${formattedAmount}.`);
    return;
  }

  if (cardSelectedRecurrence === 'weekly') {
    setTextIfExists('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por semana ate cancelar.`);
    return;
  }

  if (cardSelectedRecurrence === 'yearly') {
    setTextIfExists('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por ano ate cancelar.`);
    return;
  }

  setTextIfExists('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por mes ate cancelar.`);
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
  return input && 'value' in input ? String(input.value || '') : '';
}

function getCardEmailSelector() {
  return getFirstExistingSelector(CARD_EMAIL_PRIMARY_SELECTORS) || '#inputEmail';
}

function getCardEmailConfirmSelector() {
  return getFirstExistingSelector(CARD_EMAIL_CONFIRM_SELECTORS);
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
 * @param {string} selector
 * @param {string} value
 */
function preencherInputSeVazio(selector, value) {
  const input = getOptionalElement(selector);
  if (!input || !('value' in input) || !normalizeStringCard(value)) {
    return;
  }

  if (!normalizeStringCard(input.value)) {
    input.value = value;
  }
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
 * @param {unknown} value
 */
function normalizeStringCard(value) {
  return String(value || '').trim();
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
  const normalized = normalizeStringCard(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
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
  return String(value || '')
    .replace(/[^\d,.\sR$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {number} amount
 */
function formatarValorPresetInputCartao(amount) {
  return amount.toFixed(2).replace('.', ',');
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
  if (status === 'approved') return 'pago';
  if (status === 'pending') return 'aguardando pagamento';
  if (status === 'in_process') return 'em processamento';
  if (status === 'rejected') return 'rejeitado';
  if (status === 'cancelled') return 'cancelado';
  return status;
}
