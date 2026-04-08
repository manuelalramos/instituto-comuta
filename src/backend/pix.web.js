import { webMethod, Permissions } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';
import wixData from 'wix-data';

/**
 * @typedef {Object} PixApiResponse
 * @property {string | number=} id
 * @property {string=} status
 * @property {string | null=} date_of_expiration
 * @property {string | null=} date_approved
 * @property {{
 *   transaction_data?: {
 *     qr_code?: string,
 *     qr_code_base64?: string,
 *     ticket_url?: string
 *   }
 * }=} point_of_interaction
 * @property {string=} message
 * @property {string=} error
 */

function makeIdempotencyKey() {
  return `pix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getMercadoPagoConfig() {
  const token = await getSecret('PIX_API_TOKEN');
  const apiUrl = await getSecret('PIX_API_URL');

  if (!token) {
    throw new Error('Segredo PIX_API_TOKEN não encontrado.');
  }

  if (!apiUrl) {
    throw new Error('Segredo PIX_API_URL não encontrado.');
  }

  return { token, apiUrl };
}

/**
 * @param {PixApiResponse} raw
 */
function extractPixData(raw) {
  const tx = raw?.point_of_interaction?.transaction_data || {};

  const qrCode = tx.qr_code || '';
  const qrCodeBase64 = tx.qr_code_base64 || '';
  const ticketUrl = tx.ticket_url || '';

  return {
    donationId: String(raw?.id || ''),
    status: raw?.status || 'pending',
    expiresAt: raw?.date_of_expiration || null,
    pixCode: qrCode,
    qrCodeImage: qrCodeBase64 ? `data:image/png;base64,${qrCodeBase64}` : '',
    ticketUrl
  };
}

/**
 * Mantem a colecao PixDonations em sincronia com o pagamento do Mercado Pago.
 * @param {{
 *   donationId: string,
 *   status?: string,
 *   expiresAt?: string | null
 * }} pix
 */
async function syncPixDonation(pix) {
  if (!pix?.donationId) {
    return;
  }

  try {
    const itemData = {
      donationId: pix.donationId,
      status: pix.status || 'pending',
      title: `Doacao PIX ${pix.donationId}`,
      expiresAt: pix.expiresAt || null
    };

    const existing = await wixData.query('PixDonations')
      .eq('donationId', pix.donationId)
      .limit(1)
      .find();

    if (existing.items.length > 0) {
      await wixData.update('PixDonations', {
        ...existing.items[0],
        ...itemData
      });
      return;
    }

    await wixData.insert('PixDonations', itemData);
  } catch (error) {
    console.warn('PixDonations sync skipped:', error);
  }
}

export const createPixCharge = webMethod(Permissions.Anyone, async ({ amount, email }) => {
  const normalizedAmount = Number(amount);
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedAmount || Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Valor invalido.');
  }

  if (!normalizedEmail) {
    throw new Error('Email obrigatorio.');
  }

  if (!isValidEmail(normalizedEmail)) {
    throw new Error('Email invalido.');
  }

  const { token, apiUrl } = await getMercadoPagoConfig();

  const response = await fetch(`${apiUrl}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'X-Idempotency-Key': makeIdempotencyKey()
    },
    body: JSON.stringify({
      transaction_amount: normalizedAmount,
      description: 'Doação Instituto Comuta',
      payment_method_id: 'pix',
      payer: {
        email: normalizedEmail
      }
    })
  });

  const raw = await response.json();
  console.log('MERCADO_PAGO_CREATE_RAW', JSON.stringify(raw, null, 2));

  if (!response.ok) {
    throw new Error(raw?.message || raw?.error || 'Erro ao criar pagamento PIX.');
  }

  const pix = extractPixData(raw);

  if (!pix.donationId) {
    throw new Error('Mercado Pago não retornou o ID do pagamento.');
  }

  await syncPixDonation({
    donationId: pix.donationId,
    status: pix.status,
    expiresAt: pix.expiresAt
  });

  return pix;
});

export const getPixStatus = webMethod(Permissions.Anyone, async (donationId) => {
  const paymentId = String(donationId || '').trim();

  if (!paymentId) {
    throw new Error('donationId obrigatorio.');
  }

  const { token, apiUrl } = await getMercadoPagoConfig();

  const response = await fetch(`${apiUrl}/v1/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const raw = await response.json();
  console.log('MERCADO_PAGO_STATUS_RAW', JSON.stringify(raw, null, 2));

  if (!response.ok) {
    throw new Error(raw?.message || raw?.error || 'Erro ao consultar pagamento PIX.');
  }

  const status = raw?.status || 'pending';

  await syncPixDonation({
    donationId: paymentId,
    status,
    expiresAt: raw?.date_of_expiration || null
  });

  return {
    donationId: paymentId,
    status,
    paidAt: raw?.date_approved || null
  };
});

/**
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
