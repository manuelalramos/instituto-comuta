import { webMethod, Permissions } from 'wix-web-module';
import { getSecret } from 'wix-secrets-backend';
import { fetch } from 'wix-fetch';

function makeIdempotencyKey() {
  return `pix_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function getMercadoPagoConfig() {
  const token = await getSecret('PIX_API_TOKEN');
  const apiUrl = await getSecret('PIX_API_URL');

  if (!token) {
    throw new Error('Segredo PIX_API_TOKEN nao encontrado.');
  }

  if (!apiUrl) {
    throw new Error('Segredo PIX_API_URL nao encontrado.');
  }

  return { token, apiUrl };
}

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

export const createPixCharge = webMethod(Permissions.Anyone, async ({ amount, email }) => {
  const normalizedAmount = Number(amount);
  const normalizedEmail = String(email || '').trim();

  if (!normalizedAmount || Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
    throw new Error('Valor invalido.');
  }

  if (!normalizedEmail || !normalizedEmail.includes('@')) {
    throw new Error('Email obrigatorio.');
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
      description: 'Doacao Instituto Comuta',
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
    throw new Error('Mercado Pago nao retornou o ID do pagamento.');
  }

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

  return {
    donationId: paymentId,
    status: raw?.status || 'pending',
    paidAt: raw?.date_approved || null
  };
});
