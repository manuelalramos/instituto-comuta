import { webMethod, Permissions } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import wixData from 'wix-data';

const DEFAULT_API_URL = 'https://api.mercadopago.com';
const DEFAULT_CURRENCY_ID = 'BRL';
const INTENTS_COLLECTION = 'CardDonationIntents';
const RECURRING_COLLECTION = 'RecurringDonations';
const RECURRENCE_LABELS = {
  one_time: 'unica',
  weekly: 'semanal',
  monthly: 'mensal',
  yearly: 'anual'
};

/**
 * @typedef {Object} HostedDonationCheckoutInput
 * @property {string=} firstName
 * @property {string=} lastName
 * @property {string=} email
 * @property {string=} phone
 * @property {string=} cpf
 * @property {number | string=} amount
 * @property {'preset' | 'custom'=} amountSource
 * @property {string=} presetCode
 * @property {'one_time' | 'weekly' | 'monthly' | 'yearly' | ''=} recurrence
 * @property {string=} zipCode
 * @property {string=} street
 * @property {string=} streetNumber
 * @property {string=} complement
 * @property {string=} neighborhood
 * @property {string=} city
 * @property {string=} state
 * @property {boolean=} termsAccepted
 */

/**
 * @typedef {Object} HostedDonationCheckoutResult
 * @property {boolean} ok
 * @property {string} flowType
 * @property {string} externalReference
 * @property {string} checkoutUrl
 * @property {string} status
 * @property {string=} subscriptionId
 * @property {string=} preferenceId
 */

/**
 * @typedef {Object} MercadoPagoConfig
 * @property {string} token
 * @property {string} apiUrl
 * @property {string} backUrl
 * @property {string} notificationUrl
 */

export const createHostedDonationCheckout = webMethod(
  Permissions.Anyone,
  /**
   * @param {HostedDonationCheckoutInput} rawInput
   * @returns {Promise<HostedDonationCheckoutResult>}
   */
  async (rawInput) => {
    const input = normalizeCheckoutInput(rawInput);
    validateCheckoutInput(input);

    const config = await getMercadoPagoConfig();
    const externalReference = makeExternalReference(input.recurrence);
    const donorFullName = `${input.firstName} ${input.lastName}`.trim();
    const recurrenceConfig = getRecurrenceConfig(input.recurrence, input.amount);

    await saveCardDonationIntent({
      title: `Doacao cartao - ${externalReference}`,
      externalReference,
      donorFirstName: input.firstName,
      donorLastName: input.lastName,
      donorFullName,
      email: input.email,
      phone: input.phone,
      cpf: input.cpf,
      amount: input.amount,
      currencyId: DEFAULT_CURRENCY_ID,
      amountSource: input.amountSource,
      presetCode: input.presetCode,
      recurrence: input.recurrence,
      frequency: recurrenceConfig.frequency,
      frequencyType: recurrenceConfig.frequencyType,
      status: 'creating_checkout',
      zipCode: input.zipCode,
      street: input.street,
      streetNumber: input.streetNumber,
      complement: input.complement,
      neighborhood: input.neighborhood,
      city: input.city,
      state: input.state,
      createdAtLocal: new Date(),
      updatedAtLocal: new Date()
    });

    if (input.recurrence === 'one_time') {
      const preference = await createOneTimePreference(config, input, externalReference, donorFullName);

      await saveCardDonationIntent({
        externalReference,
        status: preference.status || 'pending_checkout',
        checkoutUrl: preference.checkoutUrl,
        subscriptionId: '',
        updatedAtLocal: new Date()
      });

      return {
        ok: true,
        flowType: 'one_time',
        externalReference,
        checkoutUrl: preference.checkoutUrl,
        preferenceId: preference.preferenceId,
        status: preference.status || 'pending_checkout'
      };
    }

    const subscription = await createRecurringSubscription(config, input, externalReference);

    await saveCardDonationIntent({
      externalReference,
      status: subscription.status || 'pending',
      checkoutUrl: subscription.checkoutUrl,
      subscriptionId: subscription.subscriptionId,
      updatedAtLocal: new Date()
    });

    await saveRecurringDonation({
      title: `Assinatura Instituto Comuta - ${externalReference}`,
      subscriptionId: subscription.subscriptionId,
      externalReference,
      payerEmail: input.email,
      donorFullName,
      amount: input.amount,
      currencyId: DEFAULT_CURRENCY_ID,
      amountSource: input.amountSource,
      presetCode: input.presetCode,
      recurrence: input.recurrence,
      frequency: recurrenceConfig.frequency,
      frequencyType: recurrenceConfig.frequencyType,
      status: subscription.status || 'pending',
      checkoutUrl: subscription.checkoutUrl,
      nextPaymentDate: subscription.nextPaymentDate,
      dateCreatedMp: subscription.dateCreatedMp,
      lastModifiedMp: subscription.lastModifiedMp,
      cancelledAt: subscription.cancelledAt,
      reason: subscription.reason,
      paymentMethodId: subscription.paymentMethodId,
      liveMode: subscription.liveMode ? 'true' : 'false',
      rawResponse: safeStringify(subscription.rawResponse)
    });

    return {
      ok: true,
      flowType: 'recurring',
      externalReference,
      subscriptionId: subscription.subscriptionId,
      checkoutUrl: subscription.checkoutUrl,
      status: subscription.status || 'pending'
    };
  }
);

export const getDonationSubscription = webMethod(
  Permissions.Anyone,
  /**
   * @param {string} subscriptionId
   */
  async (subscriptionId) => {
    const normalizedId = normalizeString(subscriptionId);
    if (!normalizedId) {
      throw new Error('subscriptionId obrigatorio.');
    }

    const config = await getMercadoPagoConfig();
    const response = await mercadoPagoRequest(config, 'GET', `/preapproval/${normalizedId}`);
    const recurringItem = buildRecurringDonationFromSubscription(response);

    await saveRecurringDonation(recurringItem);
    await saveCardDonationIntent({
      externalReference: recurringItem.externalReference,
      status: recurringItem.status,
      subscriptionId: recurringItem.subscriptionId,
      checkoutUrl: recurringItem.checkoutUrl,
      updatedAtLocal: new Date()
    });

    return recurringItem;
  }
);

export const cancelDonationSubscription = webMethod(
  Permissions.Anyone,
  /**
   * @param {string} subscriptionId
   */
  async (subscriptionId) => {
    return updateDonationSubscriptionStatus(subscriptionId, 'cancelled');
  }
);

export const pauseDonationSubscription = webMethod(
  Permissions.Anyone,
  /**
   * @param {string} subscriptionId
   */
  async (subscriptionId) => {
    return updateDonationSubscriptionStatus(subscriptionId, 'paused');
  }
);

export const resumeDonationSubscription = webMethod(
  Permissions.Anyone,
  /**
   * @param {string} subscriptionId
   */
  async (subscriptionId) => {
    return updateDonationSubscriptionStatus(subscriptionId, 'authorized');
  }
);

/**
 * @param {MercadoPagoConfig} config
 * @param {HostedDonationCheckoutInput & { amount: number, email: string }} input
 * @param {string} externalReference
 * @param {string} donorFullName
 */
async function createOneTimePreference(config, input, externalReference, donorFullName) {
  const body = {
    items: [
      {
        title: 'Doacao Instituto Comuta',
        description: 'Doacao unica com cartao',
        quantity: 1,
        currency_id: DEFAULT_CURRENCY_ID,
        unit_price: input.amount
      }
    ],
    external_reference: externalReference,
    payer: {
      name: input.firstName,
      surname: input.lastName,
      email: input.email,
      phone: buildPhonePayload(input.phone),
      identification: {
        type: 'CPF',
        number: input.cpf
      },
      address: {
        zip_code: input.zipCode,
        street_name: input.street,
        street_number: input.streetNumber
      }
    },
    back_urls: buildBackUrls(config.backUrl, externalReference, 'one_time'),
    auto_return: 'approved'
  };

  if (config.notificationUrl) {
    body.notification_url = config.notificationUrl;
  }

  const response = await mercadoPagoRequest(config, 'POST', '/checkout/preferences', body);

  return {
    preferenceId: normalizeString(response.id),
    checkoutUrl: normalizeString(response.init_point || response.sandbox_init_point),
    status: 'pending_checkout'
  };
}

/**
 * @param {MercadoPagoConfig} config
 * @param {HostedDonationCheckoutInput & { amount: number, email: string }} input
 * @param {string} externalReference
 */
async function createRecurringSubscription(config, input, externalReference) {
  const recurrence = getRecurrenceConfig(input.recurrence, input.amount);
  const body = {
    reason: `Doacao ${RECURRENCE_LABELS[input.recurrence] || 'recorrente'} Instituto Comuta`,
    external_reference: externalReference,
    payer_email: input.email,
    auto_recurring: {
      frequency: recurrence.frequency,
      frequency_type: recurrence.frequencyType,
      transaction_amount: input.amount,
      currency_id: DEFAULT_CURRENCY_ID
    },
    back_url: appendQuery(config.backUrl, {
      flow: 'recurring',
      external_reference: externalReference
    }),
    status: 'pending'
  };

  if (config.notificationUrl) {
    body.notification_url = config.notificationUrl;
  }

  const response = await mercadoPagoRequest(config, 'POST', '/preapproval', body);
  const recurringItem = buildRecurringDonationFromSubscription(response);

  return {
    subscriptionId: recurringItem.subscriptionId,
    checkoutUrl: recurringItem.checkoutUrl,
    status: recurringItem.status,
    nextPaymentDate: recurringItem.nextPaymentDate,
    dateCreatedMp: recurringItem.dateCreatedMp,
    lastModifiedMp: recurringItem.lastModifiedMp,
    cancelledAt: recurringItem.cancelledAt,
    reason: recurringItem.reason,
    paymentMethodId: recurringItem.paymentMethodId,
    liveMode: recurringItem.liveMode === 'true',
    rawResponse: response
  };
}

/**
 * @param {string} subscriptionId
 * @param {string} status
 */
async function updateDonationSubscriptionStatus(subscriptionId, status) {
  const normalizedId = normalizeString(subscriptionId);
  if (!normalizedId) {
    throw new Error('subscriptionId obrigatorio.');
  }

  const config = await getMercadoPagoConfig();
  const response = await mercadoPagoRequest(config, 'PUT', `/preapproval/${normalizedId}`, { status });
  const recurringItem = buildRecurringDonationFromSubscription(response);

  await saveRecurringDonation(recurringItem);
  await saveCardDonationIntent({
    externalReference: recurringItem.externalReference,
    status: recurringItem.status,
    subscriptionId: recurringItem.subscriptionId,
    checkoutUrl: recurringItem.checkoutUrl,
    updatedAtLocal: new Date()
  });

  return recurringItem;
}

/**
 * @param {MercadoPagoConfig} config
 * @param {'GET' | 'POST' | 'PUT'} method
 * @param {string} path
 * @param {Record<string, unknown>=} body
 */
async function mercadoPagoRequest(config, method, path, body) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': makeIdempotencyKey()
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      normalizeString(data?.message || data?.error || data?.cause?.[0]?.description) ||
      'Erro ao comunicar com o Mercado Pago.'
    );
  }

  return data;
}

async function getMercadoPagoConfig() {
  const token =
    normalizeString(await getSecret('MP_ACCESS_TOKEN')) ||
    normalizeString(await getSecret('PIX_API_TOKEN'));
  const apiUrl =
    normalizeString(await getSecret('MP_API_URL')) ||
    normalizeString(await getSecret('PIX_API_URL')) ||
    DEFAULT_API_URL;
  const backUrl = normalizeString(await getSecret('MP_SUBSCRIPTIONS_BACK_URL'));
  const notificationUrl = normalizeString(await getSecret('MP_NOTIFICATION_URL'));

  if (!token) {
    throw new Error('Segredo MP_ACCESS_TOKEN nao encontrado.');
  }

  if (!backUrl) {
    throw new Error('Segredo MP_SUBSCRIPTIONS_BACK_URL nao encontrado.');
  }

  return { token, apiUrl, backUrl, notificationUrl };
}

/**
 * @param {HostedDonationCheckoutInput} rawInput
 */
function normalizeCheckoutInput(rawInput) {
  return {
    firstName: normalizeString(rawInput?.firstName),
    lastName: normalizeString(rawInput?.lastName),
    email: normalizeString(rawInput?.email).toLowerCase(),
    phone: normalizePhone(rawInput?.phone),
    cpf: normalizeCpf(rawInput?.cpf),
    amount: normalizeAmount(rawInput?.amount),
    amountSource: rawInput?.amountSource === 'preset' ? 'preset' : 'custom',
    presetCode: normalizeString(rawInput?.presetCode),
    recurrence: normalizeRecurrence(rawInput?.recurrence),
    zipCode: normalizeZipCode(rawInput?.zipCode),
    street: normalizeString(rawInput?.street),
    streetNumber: normalizeString(rawInput?.streetNumber),
    complement: normalizeString(rawInput?.complement),
    neighborhood: normalizeString(rawInput?.neighborhood),
    city: normalizeString(rawInput?.city),
    state: normalizeState(rawInput?.state),
    termsAccepted: rawInput?.termsAccepted === true
  };
}

/**
 * @param {ReturnType<typeof normalizeCheckoutInput>} input
 */
function validateCheckoutInput(input) {
  if (!input.firstName) throw new Error('Informe o nome.');
  if (!input.lastName) throw new Error('Informe o sobrenome.');
  if (!isValidEmail(input.email)) throw new Error('Informe um email valido.');
  if (!isValidBrazilPhone(input.phone)) throw new Error('Informe um celular com DDD.');
  if (!isValidCpf(input.cpf)) throw new Error('Informe um CPF valido.');
  if (!input.amount || Number.isNaN(input.amount) || input.amount <= 0) {
    throw new Error('Informe um valor valido para a doacao.');
  }
  if (!input.recurrence) throw new Error('Selecione a frequencia da doacao.');
  if (!isValidZipCode(input.zipCode)) throw new Error('Informe um CEP valido.');
  if (!input.street) throw new Error('Informe o endereco.');
  if (!input.streetNumber) throw new Error('Informe o numero.');
  if (!input.neighborhood) throw new Error('Informe o bairro.');
  if (!input.city) throw new Error('Informe a cidade.');
  if (!/^[A-Z]{2}$/.test(input.state)) throw new Error('Informe o estado com a UF.');
  if (!input.termsAccepted) throw new Error('Aceite os termos para continuar.');
}

/**
 * @param {'one_time' | 'weekly' | 'monthly' | 'yearly' | ''} recurrence
 * @param {number} amount
 */
function getRecurrenceConfig(recurrence, amount) {
  if (recurrence === 'one_time') {
    return { frequency: 0, frequencyType: 'one_time', amount };
  }

  if (recurrence === 'weekly') {
    return { frequency: 7, frequencyType: 'days', amount };
  }

  if (recurrence === 'yearly') {
    return { frequency: 12, frequencyType: 'months', amount };
  }

  return { frequency: 1, frequencyType: 'months', amount };
}

/**
 * @param {unknown} raw
 */
function buildRecurringDonationFromSubscription(raw) {
  const autoRecurring = raw?.auto_recurring || {};

  return {
    title: `Assinatura Instituto Comuta - ${normalizeString(raw?.external_reference || raw?.id)}`,
    subscriptionId: normalizeString(raw?.id),
    externalReference: normalizeString(raw?.external_reference),
    payerEmail: normalizeString(raw?.payer_email).toLowerCase(),
    donorFullName: '',
    amount: Number(autoRecurring?.transaction_amount || 0),
    currencyId: normalizeString(autoRecurring?.currency_id) || DEFAULT_CURRENCY_ID,
    amountSource: '',
    presetCode: '',
    recurrence: normalizeRecurrenceFromApi(autoRecurring),
    frequency: Number(autoRecurring?.frequency || 0),
    frequencyType: normalizeString(autoRecurring?.frequency_type),
    status: normalizeString(raw?.status) || 'pending',
    checkoutUrl: normalizeString(raw?.init_point),
    nextPaymentDate: parseOptionalDate(raw?.next_payment_date),
    dateCreatedMp: parseOptionalDate(raw?.date_created),
    lastModifiedMp: parseOptionalDate(raw?.last_modified),
    cancelledAt: parseOptionalDate(raw?.date_of_cancellation),
    reason: normalizeString(raw?.reason),
    paymentMethodId: normalizeString(raw?.payment_method_id),
    liveMode: raw?.live_mode === true ? 'true' : 'false',
    rawResponse: safeStringify(raw)
  };
}

/**
 * @param {Record<string, unknown>} itemData
 */
async function saveCardDonationIntent(itemData) {
  await upsertCollectionItem(INTENTS_COLLECTION, 'externalReference', itemData);
}

/**
 * @param {Record<string, unknown>} itemData
 */
async function saveRecurringDonation(itemData) {
  await upsertCollectionItem(RECURRING_COLLECTION, 'externalReference', itemData);
}

/**
 * @param {string} collectionName
 * @param {string} key
 * @param {Record<string, unknown>} itemData
 */
async function upsertCollectionItem(collectionName, key, itemData) {
  const keyValue = normalizeString(itemData[key]);
  if (!keyValue) {
    return;
  }

  try {
    const existing = await wixData.query(collectionName).eq(key, keyValue).limit(1).find();

    if (existing.items.length > 0) {
      await wixData.update(collectionName, {
        ...existing.items[0],
        ...itemData
      });
      return;
    }

    await wixData.insert(collectionName, itemData);
  } catch (error) {
    console.warn(`${collectionName} sync skipped:`, error);
  }
}

/**
 * @param {string} baseUrl
 * @param {string} externalReference
 * @param {'one_time' | 'recurring'} flow
 */
function buildBackUrls(baseUrl, externalReference, flow) {
  return {
    success: appendQuery(baseUrl, { status: 'success', flow, external_reference: externalReference }),
    pending: appendQuery(baseUrl, { status: 'pending', flow, external_reference: externalReference }),
    failure: appendQuery(baseUrl, { status: 'failure', flow, external_reference: externalReference })
  };
}

/**
 * @param {string} baseUrl
 * @param {Record<string, string>} params
 */
function appendQuery(baseUrl, params) {
  const url = new URL(baseUrl);

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    }
  });

  return url.toString();
}

function makeIdempotencyKey() {
  return `mp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * @param {'one_time' | 'weekly' | 'monthly' | 'yearly'} recurrence
 */
function makeExternalReference(recurrence) {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const tag = recurrence === 'one_time' ? 'CARD' : 'REC';
  return `COMUTA-${tag}-${Date.now()}-${suffix}`;
}

/**
 * @param {string} phone
 */
function buildPhonePayload(phone) {
  const digits = normalizePhone(phone);
  return {
    area_code: digits.slice(0, 2),
    number: digits.slice(2)
  };
}

/**
 * @param {unknown} value
 */
function normalizeAmount(value) {
  if (typeof value === 'number') {
    return Number(value.toFixed(2));
  }

  const normalized = normalizeString(value).replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const amount = Number(normalized);

  if (!amount || Number.isNaN(amount)) {
    return 0;
  }

  return Number(amount.toFixed(2));
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
function normalizeCpf(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 11);
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
function normalizeState(value) {
  return String(value || '').replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
}

/**
 * @param {unknown} value
 * @returns {'one_time' | 'weekly' | 'monthly' | 'yearly' | ''}
 */
function normalizeRecurrence(value) {
  const recurrence = normalizeString(value).toLowerCase();

  if (recurrence === 'one_time' || recurrence === 'weekly' || recurrence === 'monthly' || recurrence === 'yearly') {
    return recurrence;
  }

  return '';
}

/**
 * @param {{ frequency?: number, frequency_type?: string }} autoRecurring
 */
function normalizeRecurrenceFromApi(autoRecurring) {
  const frequency = Number(autoRecurring?.frequency || 0);
  const frequencyType = normalizeString(autoRecurring?.frequency_type);

  if (frequencyType === 'days' && frequency === 7) {
    return 'weekly';
  }

  if (frequencyType === 'months' && frequency === 12) {
    return 'yearly';
  }

  if (frequencyType === 'months' && frequency === 1) {
    return 'monthly';
  }

  return 'monthly';
}

/**
 * @param {string} email
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * @param {string} phone
 */
function isValidBrazilPhone(phone) {
  return /^\d{10,11}$/.test(normalizePhone(phone));
}

/**
 * @param {string} zipCode
 */
function isValidZipCode(zipCode) {
  return /^\d{8}$/.test(normalizeZipCode(zipCode));
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
 * @param {unknown} value
 */
function parseOptionalDate(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * @param {unknown} value
 */
function safeStringify(value) {
  if (value == null) {
    return '';
  }

  try {
    return JSON.stringify(value).slice(0, 5000);
  } catch (error) {
    return normalizeString(error instanceof Error ? error.message : value);
  }
}
