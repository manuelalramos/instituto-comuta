import { ok, badRequest, notFound, response, serverError } from 'wix-http-functions';
import wixData from 'wix-data';
import { fetch } from 'wix-fetch';
import { getSecret } from 'wix-secrets-backend';

const DEFAULT_API_URL = 'https://api.mercadopago.com';

export async function get_cardCheckoutRedirect(request) {
  try {
    const externalReference = normalizeString(getQueryValue(request, 'externalReference'));
    if (!externalReference) {
      return badRequest({ body: { error: 'externalReference obrigatorio.' } });
    }

    const results = await wixData.query('CardDonationIntents')
      .eq('externalReference', externalReference)
      .limit(1)
      .find();

    if (results.items.length === 0) {
      return notFound({ body: { error: 'Checkout não encontrado.' } });
    }

    const checkoutUrl = normalizeString(results.items[0]?.checkoutUrl);
    if (!checkoutUrl) {
      return notFound({ body: { error: 'URL do checkout ainda não disponível.' } });
    }

    return response({
      status: 302,
      headers: {
        Location: checkoutUrl,
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      },
      body: ''
    });
  } catch (error) {
    return serverError({ body: { error: error instanceof Error ? error.message : String(error) } });
  }
}

export async function post_mercadoPagoWebhook(request) {
  try {
    const body = await safeReadRequestJson(request);
    const topic = normalizeString(
      body?.type ||
      body?.topic ||
      getQueryValue(request, 'type') ||
      getQueryValue(request, 'topic')
    );
    const resourceId = normalizeString(
      body?.data?.id ||
      body?.id ||
      getQueryValue(request, 'id') ||
      getQueryValue(request, 'data.id')
    );

    if (!resourceId) {
      return ok({ body: { received: true, skipped: 'missing_resource_id' } });
    }

    if (topic.includes('preapproval')) {
      await syncRecurringDonation(resourceId);
      return ok({ body: { received: true, topic, resourceId } });
    }

    if (topic === 'payment' || topic === 'subscription_authorized_payment') {
      await syncPaymentNotification(resourceId);
      return ok({ body: { received: true, topic, resourceId } });
    }

    await markPixDonationNotified(resourceId);
    return ok({ body: { received: true, topic, resourceId } });
  } catch (error) {
    return badRequest({ body: { error: error instanceof Error ? error.message : String(error) } });
  }
}

async function syncRecurringDonation(subscriptionId) {
  const data = await mercadoPagoGet(`/preapproval/${subscriptionId}`);
  const externalReference = normalizeString(data?.external_reference);

  if (!externalReference) {
    return;
  }

  const autoRecurring = data?.auto_recurring || {};
  const recurringItem = {
    title: `Assinatura Instituto Comuta - ${externalReference}`,
    subscriptionId: normalizeString(data?.id),
    externalReference,
    payerEmail: normalizeString(data?.payer_email).toLowerCase(),
    amount: Number(autoRecurring?.transaction_amount || 0),
    currencyId: normalizeString(autoRecurring?.currency_id) || 'BRL',
    recurrence: normalizeRecurrenceFromApi(autoRecurring),
    frequency: Number(autoRecurring?.frequency || 0),
    frequencyType: normalizeString(autoRecurring?.frequency_type),
    status: normalizeString(data?.status) || 'pending',
    checkoutUrl: normalizeString(data?.init_point),
    nextPaymentDate: parseOptionalDate(data?.next_payment_date),
    dateCreatedMp: parseOptionalDate(data?.date_created),
    lastModifiedMp: parseOptionalDate(data?.last_modified),
    cancelledAt: parseOptionalDate(data?.date_of_cancellation),
    reason: normalizeString(data?.reason),
    paymentMethodId: normalizeString(data?.payment_method_id),
    liveMode: data?.live_mode === true ? 'true' : 'false',
    rawResponse: safeStringify(data)
  };

  await upsertByKey('RecurringDonations', 'externalReference', recurringItem);
  await upsertByKey('CardDonationIntents', 'externalReference', {
    externalReference,
    status: recurringItem.status,
    subscriptionId: recurringItem.subscriptionId,
    checkoutUrl: recurringItem.checkoutUrl,
    updatedAtLocal: new Date()
  });
}

async function syncPaymentNotification(paymentId) {
  const data = await mercadoPagoGet(`/v1/payments/${paymentId}`);
  const externalReference = normalizeString(data?.external_reference);

  if (!externalReference) {
    await markPixDonationNotified(paymentId);
    return;
  }

  const paymentStatus = normalizeString(data?.status) || 'pending';

  await upsertByKey('CardDonationIntents', 'externalReference', {
    externalReference,
    status: paymentStatus,
    updatedAtLocal: new Date()
  });

  await upsertByKey('RecurringDonations', 'externalReference', {
    externalReference,
    status: paymentStatus,
    lastModifiedMp: new Date(),
    paymentMethodId: normalizeString(data?.payment_method_id),
    rawResponse: safeStringify(data)
  });
}

async function markPixDonationNotified(paymentId) {
  const results = await wixData.query('PixDonations')
    .eq('donationId', paymentId)
    .limit(1)
    .find();

  if (results.items.length === 0) {
    return;
  }

  const item = results.items[0];
  item.status = 'notified';
  await wixData.update('PixDonations', item);
}

/**
 * @param {string} collectionName
 * @param {string} key
 * @param {Record<string, unknown>} itemData
 */
async function upsertByKey(collectionName, key, itemData) {
  const keyValue = normalizeString(itemData[key]);
  if (!keyValue) {
    return;
  }

  try {
    const results = await wixData.query(collectionName).eq(key, keyValue).limit(1).find();

    if (results.items.length > 0) {
      await wixData.update(collectionName, {
        ...results.items[0],
        ...itemData
      });
      return;
    }

    await wixData.insert(collectionName, itemData);
  } catch (error) {
    console.warn(`${collectionName} webhook sync skipped:`, error);
  }
}

async function mercadoPagoGet(path) {
  const token =
    normalizeString(await getSecret('MP_ACCESS_TOKEN')) ||
    normalizeString(await getSecret('PIX_API_TOKEN'));
  const apiUrl =
    normalizeString(await getSecret('MP_API_URL')) ||
    normalizeString(await getSecret('PIX_API_URL')) ||
    DEFAULT_API_URL;

  if (!token) {
    throw new Error('Segredo MP_ACCESS_TOKEN não encontrado.');
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      normalizeString(data?.message || data?.error || data?.cause?.[0]?.description) ||
      'Erro ao consultar o Mercado Pago.'
    );
  }

  return data;
}

async function safeReadRequestJson(request) {
  try {
    return await request.body.json();
  } catch (error) {
    return {};
  }
}

/**
 * @param {import('wix-http-functions').WixHttpFunctionRequest} request
 * @param {string} key
 */
function getQueryValue(request, key) {
  const query = request?.query;

  if (!query) {
    return '';
  }

  if (typeof query[key] === 'string') {
    return query[key];
  }

  if (Array.isArray(query[key]) && query[key].length > 0) {
    return String(query[key][0]);
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

/**
 * @param {unknown} value
 */
function normalizeString(value) {
  return String(value || '').trim();
}
