import wixLocationFrontend from 'wix-location-frontend';
import { createHostedDonationCheckout } from 'backend/subscriptions.web';
import { lookupAddressByCep } from 'backend/address.web';

const FREQUENCY_BUTTONS = {
  one_time: '#btnFrequencyOneTime',
  weekly: '#btnFrequencyWeekly',
  monthly: '#btnFrequencyMonthly',
  yearly: '#btnFrequencyYearly'
};

const AMOUNT_PRESETS = {
  '#btnAmount5': { amount: 5, presetCode: 'amount_5' },
  '#btnAmount10': { amount: 10, presetCode: 'amount_10' },
  '#btnAmount20': { amount: 20, presetCode: 'amount_20' },
  '#btnAmount50': { amount: 50, presetCode: 'amount_50' }
};

/** @type {'one_time' | 'weekly' | 'monthly' | 'yearly' | ''} */
let selectedRecurrence = '';
/** @type {number | null} */
let selectedPresetAmount = null;
/** @type {string} */
let selectedPresetCode = '';
/** @type {ReturnType<typeof setTimeout> | null} */
let cepLookupTimer = null;
/** @type {boolean} */
let isSubmitting = false;
const originalButtonLabels = new Map();

$w.onReady(function () {
  cacheOriginalLabels();
  preparePage();
  bindFrequencyButtons();
  bindAmountButtons();
  bindCustomAmountInput();
  bindMasks();
  bindCepLookup();
  bindSubmit();
});

function preparePage() {
  setText('#txtCardMessage', 'Preencha os dados para continuar no Mercado Pago.');
  setText('#txtSubscriptionSummary', 'Escolha a frequencia e o valor para continuar.');
  hideAndCollapseIfExists('#loadingStrip');
}

function cacheOriginalLabels() {
  const buttonIds = [
    ...Object.values(FREQUENCY_BUTTONS),
    ...Object.keys(AMOUNT_PRESETS)
  ];

  buttonIds.forEach((buttonId) => {
    const button = getOptionalElement(buttonId);
    if (button && 'label' in button) {
      originalButtonLabels.set(buttonId, button.label);
    }
  });
}

function bindFrequencyButtons() {
  registerClick(FREQUENCY_BUTTONS.one_time, () => selectRecurrence('one_time'));
  registerClick(FREQUENCY_BUTTONS.weekly, () => selectRecurrence('weekly'));
  registerClick(FREQUENCY_BUTTONS.monthly, () => selectRecurrence('monthly'));
  registerClick(FREQUENCY_BUTTONS.yearly, () => selectRecurrence('yearly'));
}

function bindAmountButtons() {
  Object.entries(AMOUNT_PRESETS).forEach(([buttonId, config]) => {
    registerClick(buttonId, () => selectPresetAmount(config.amount, config.presetCode));
  });
}

function bindCustomAmountInput() {
  const input = getOptionalElement('#inputAmountCustom');
  if (!input) {
    return;
  }

  input.onInput(() => {
    const normalized = formatAmountInput(input.value);
    input.value = normalized;

    if (parseAmountValue(normalized) > 0) {
      selectedPresetAmount = null;
      selectedPresetCode = '';
      refreshAmountButtons();
    }

    updateSummary();
  });

  input.onBlur(() => {
    const amount = parseAmountValue(input.value);
    input.value = amount > 0 ? formatCurrency(amount) : '';
    updateSummary();
  });
}

function bindMasks() {
  bindInputMask('#inputCpf', formatCpf);
  bindInputMask('#inputPhone', formatBrazilPhone);
  bindInputMask('#inputZipCode', formatZipCode);

  const stateInput = getOptionalElement('#inputState');
  if (stateInput) {
    stateInput.onInput(() => {
      stateInput.value = formatState(stateInput.value);
    });
  }
}

function bindCepLookup() {
  const cepInput = getOptionalElement('#inputZipCode');
  if (!cepInput) {
    return;
  }

  const triggerLookup = () => {
    clearCepLookupTimer();
    const cep = normalizeZipCode(cepInput.value);
    if (!/^\d{8}$/.test(cep)) {
      return;
    }

    cepLookupTimer = setTimeout(async () => {
      cepLookupTimer = null;
      await searchAddressByCep();
    }, 350);
  };

  cepInput.onInput(triggerLookup);
  cepInput.onBlur(() => {
    void searchAddressByCep();
  });
}

function bindSubmit() {
  registerClick('#btnContinueToMercadoPago', async () => {
    await handleSubmit();
  });
}

/**
 * @param {'one_time' | 'weekly' | 'monthly' | 'yearly'} recurrence
 */
function selectRecurrence(recurrence) {
  selectedRecurrence = recurrence;
  refreshFrequencyButtons();
  updateSummary();
}

/**
 * @param {number} amount
 * @param {string} presetCode
 */
function selectPresetAmount(amount, presetCode) {
  selectedPresetAmount = amount;
  selectedPresetCode = presetCode;

  const customInput = getOptionalElement('#inputAmountCustom');
  if (customInput) {
    customInput.value = formatCurrency(amount);
  }

  refreshAmountButtons();
  updateSummary();
}

async function searchAddressByCep() {
  const cepInput = getOptionalElement('#inputZipCode');
  if (!cepInput) {
    return;
  }

  const cep = normalizeZipCode(cepInput.value);
  if (!/^\d{8}$/.test(cep)) {
    return;
  }

  try {
    setText('#txtCardMessage', 'Buscando endereco pelo CEP...');
    const address = await lookupAddressByCep(cep);

    setInputValue('#inputStreet', address.street);
    setInputValue('#inputNeighborhood', address.neighborhood);
    setInputValue('#inputCity', address.city);
    setInputValue('#inputState', address.state);

    const complementInput = getOptionalElement('#inputComplement');
    if (complementInput && !normalizeString(complementInput.value) && address.complement) {
      complementInput.value = address.complement;
    }

    setText('#txtCardMessage', 'Endereco preenchido automaticamente. Confira os dados.');
  } catch (error) {
    setText('#txtCardMessage', getErrorMessage(error) || 'Nao foi possivel localizar o CEP.');
  }
}

async function handleSubmit() {
  if (isSubmitting) {
    return;
  }

  const validation = validateForm();
  if (!validation.ok) {
    setText('#txtCardMessage', validation.message);
    if (validation.elementId) {
      await focusElement(validation.elementId);
    }
    return;
  }

  isSubmitting = true;
  setSubmitAvailability(false);
  showAndExpandIfExists('#loadingStrip');
  setText('#txtCardMessage', 'Redirecionando para o Mercado Pago...');

  try {
    const payload = collectPayload();
    const result = await createHostedDonationCheckout(payload);

    if (!result?.checkoutUrl) {
      throw new Error('O Mercado Pago nao retornou a URL do checkout.');
    }

    wixLocationFrontend.to(result.checkoutUrl);
  } catch (error) {
    setText('#txtCardMessage', getErrorMessage(error) || 'Nao foi possivel criar o checkout.');
  } finally {
    isSubmitting = false;
    setSubmitAvailability(true);
    hideAndCollapseIfExists('#loadingStrip');
  }
}

function validateForm() {
  const requiredFields = [
    ['#inputFirstName', 'Informe o nome.'],
    ['#inputLastName', 'Informe o sobrenome.'],
    ['#inputEmail', 'Informe um email valido.'],
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
    const value = getInputValue(elementId);
    if (!normalizeString(value)) {
      return { ok: false, elementId, message };
    }
  }

  if (!isValidEmail(getInputValue('#inputEmail'))) {
    return { ok: false, elementId: '#inputEmail', message: 'Informe um email valido.' };
  }

  const emailConfirm = getOptionalElement('#inputEmailConfirm');
  if (emailConfirm && normalizeString(emailConfirm.value) && normalizeString(emailConfirm.value) !== normalizeString(getInputValue('#inputEmail'))) {
    return { ok: false, elementId: '#inputEmailConfirm', message: 'Os emails precisam ser iguais.' };
  }

  if (!isValidBrazilPhone(getInputValue('#inputPhone'))) {
    return { ok: false, elementId: '#inputPhone', message: 'Informe um celular com DDD.' };
  }

  if (!isValidCpf(getInputValue('#inputCpf'))) {
    return { ok: false, elementId: '#inputCpf', message: 'Informe um CPF valido.' };
  }

  if (!/^\d{8}$/.test(normalizeZipCode(getInputValue('#inputZipCode')))) {
    return { ok: false, elementId: '#inputZipCode', message: 'Informe um CEP valido.' };
  }

  if (!/^[A-Z]{2}$/.test(formatState(getInputValue('#inputState')))) {
    return { ok: false, elementId: '#inputState', message: 'Informe o estado com a UF.' };
  }

  if (!selectedRecurrence) {
    return { ok: false, elementId: '', message: 'Selecione a frequencia da doacao.' };
  }

  if (getSelectedAmount() <= 0) {
    return { ok: false, elementId: '#inputAmountCustom', message: 'Informe um valor valido para a doacao.' };
  }

  const checkboxTerms = getOptionalElement('#checkboxTerms');
  if (!checkboxTerms || checkboxTerms.checked !== true) {
    return { ok: false, elementId: '#checkboxTerms', message: 'Aceite os termos para continuar.' };
  }

  return { ok: true, elementId: '', message: '' };
}

function collectPayload() {
  const amount = getSelectedAmount();

  return {
    firstName: normalizeString(getInputValue('#inputFirstName')),
    lastName: normalizeString(getInputValue('#inputLastName')),
    email: normalizeString(getInputValue('#inputEmail')).toLowerCase(),
    phone: normalizePhone(getInputValue('#inputPhone')),
    cpf: normalizeCpf(getInputValue('#inputCpf')),
    amount,
    amountSource: selectedPresetAmount ? 'preset' : 'custom',
    presetCode: selectedPresetCode,
    recurrence: selectedRecurrence,
    zipCode: normalizeZipCode(getInputValue('#inputZipCode')),
    street: normalizeString(getInputValue('#inputStreet')),
    streetNumber: normalizeString(getInputValue('#inputStreetNumber')),
    complement: normalizeString(getInputValue('#inputComplement')),
    neighborhood: normalizeString(getInputValue('#inputNeighborhood')),
    city: normalizeString(getInputValue('#inputCity')),
    state: formatState(getInputValue('#inputState')),
    termsAccepted: true
  };
}

function updateSummary() {
  const amount = getSelectedAmount();
  if (!selectedRecurrence || amount <= 0) {
    setText('#txtSubscriptionSummary', 'Escolha a frequencia e o valor para continuar.');
    return;
  }

  const formattedAmount = formatCurrency(amount);
  if (selectedRecurrence === 'one_time') {
    setText('#txtSubscriptionSummary', `Voce vai fazer uma doacao unica de ${formattedAmount}.`);
    return;
  }

  if (selectedRecurrence === 'weekly') {
    setText('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por semana ate cancelar.`);
    return;
  }

  if (selectedRecurrence === 'yearly') {
    setText('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por ano ate cancelar.`);
    return;
  }

  setText('#txtSubscriptionSummary', `Voce vai doar ${formattedAmount} por mes ate cancelar.`);
}

function refreshFrequencyButtons() {
  Object.entries(FREQUENCY_BUTTONS).forEach(([recurrence, buttonId]) => {
    updateSelectableButton(buttonId, recurrence === selectedRecurrence);
  });
}

function refreshAmountButtons() {
  Object.entries(AMOUNT_PRESETS).forEach(([buttonId, config]) => {
    updateSelectableButton(buttonId, config.amount === selectedPresetAmount);
  });
}

/**
 * @param {string} buttonId
 * @param {boolean} isSelected
 */
function updateSelectableButton(buttonId, isSelected) {
  const button = getOptionalElement(buttonId);
  if (!button || !('label' in button)) {
    return;
  }

  const originalLabel = originalButtonLabels.get(buttonId) || button.label;
  button.label = isSelected ? `> ${stripSelectedPrefix(originalLabel)}` : stripSelectedPrefix(originalLabel);
}

/**
 * @param {string} label
 */
function stripSelectedPrefix(label) {
  return String(label || '').replace(/^>\s*/, '');
}

function clearCepLookupTimer() {
  if (!cepLookupTimer) {
    return;
  }

  clearTimeout(cepLookupTimer);
  cepLookupTimer = null;
}

function getSelectedAmount() {
  const customAmount = parseAmountValue(getInputValue('#inputAmountCustom'));
  if (customAmount > 0) {
    return customAmount;
  }

  return selectedPresetAmount || 0;
}

/**
 * @param {string} selector
 * @param {(value: string) => string} formatter
 */
function bindInputMask(selector, formatter) {
  const input = getOptionalElement(selector);
  if (!input) {
    return;
  }

  input.onInput(() => {
    input.value = formatter(input.value);
  });
}

/**
 * @param {string} selector
 * @param {() => void | Promise<void>} callback
 */
function registerClick(selector, callback) {
  const element = getOptionalElement(selector);
  if (!element || typeof element.onClick !== 'function') {
    return;
  }

  element.onClick(() => callback());
}

function getOptionalElement(selector) {
  try {
    return $w(selector);
  } catch (error) {
    console.log(`Elemento indisponivel no layout atual: ${selector}`, getErrorMessage(error));
    return null;
  }
}

function getInputValue(selector) {
  const input = getOptionalElement(selector);
  return input && 'value' in input ? String(input.value || '') : '';
}

function setInputValue(selector, value) {
  const input = getOptionalElement(selector);
  if (!input || !('value' in input) || !normalizeString(value)) {
    return;
  }

  if (!normalizeString(input.value)) {
    input.value = value;
  }
}

function setText(selector, text) {
  const element = getOptionalElement(selector);
  if (element && 'text' in element) {
    element.text = text;
  }
}

function showAndExpandIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.expand === 'function') {
    element.expand();
  }

  if (typeof element.show === 'function') {
    element.show();
  }
}

function hideAndCollapseIfExists(selector) {
  const element = getOptionalElement(selector);
  if (!element) {
    return;
  }

  if (typeof element.hide === 'function') {
    element.hide();
  }

  if (typeof element.collapse === 'function') {
    element.collapse();
  }
}

/**
 * @param {string} selector
 */
async function focusElement(selector) {
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
function setSubmitAvailability(available) {
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
function normalizeString(value) {
  return String(value || '').trim();
}

/**
 * @param {unknown} value
 */
function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
}

/**
 * @param {unknown} value
 */
function normalizePhone(value) {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.length >= 12 && digits.startsWith('55')) {
    digits = digits.slice(2);
  }

  return digits.slice(0, 11);
}

/**
 * @param {unknown} value
 */
function normalizeZipCode(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 8);
}

/**
 * @param {unknown} value
 */
function parseAmountValue(value) {
  const normalized = normalizeString(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const amount = Number(normalized);
  return !amount || Number.isNaN(amount) ? 0 : Number(amount.toFixed(2));
}

/**
 * @param {unknown} value
 */
function formatCpf(value) {
  const digits = normalizeCpf(value);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return digits.replace(/(\d{3})(\d+)/, '$1.$2');
  if (digits.length <= 9) return digits.replace(/(\d{3})(\d{3})(\d+)/, '$1.$2.$3');

  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{1,2})/, '$1.$2.$3-$4');
}

/**
 * @param {unknown} value
 */
function formatBrazilPhone(value) {
  const digits = normalizePhone(value);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return digits.replace(/(\d{2})(\d+)/, '($1) $2');
  if (digits.length <= 10) return digits.replace(/(\d{2})(\d{4})(\d+)/, '($1) $2-$3');

  return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
}

/**
 * @param {unknown} value
 */
function formatZipCode(value) {
  const digits = normalizeZipCode(value);

  if (digits.length <= 5) {
    return digits;
  }

  return digits.replace(/(\d{5})(\d{1,3})/, '$1-$2');
}

/**
 * @param {unknown} value
 */
function formatState(value) {
  return String(value || '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * @param {unknown} value
 */
function formatAmountInput(value) {
  return String(value || '')
    .replace(/[^\d,.\sR$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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
 * @param {string} email
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeString(email));
}

/**
 * @param {string} phone
 */
function isValidBrazilPhone(phone) {
  return /^\d{10,11}$/.test(normalizePhone(phone));
}

/**
 * @param {string} value
 */
function isValidCpf(value) {
  const cpf = normalizeCpf(value);

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

/**
 * @param {unknown} error
 */
function getErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error || 'Erro desconhecido');
}
