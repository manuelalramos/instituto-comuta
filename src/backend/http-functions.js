import { ok, badRequest } from 'wix-http-functions';
import wixData from 'wix-data';

export async function post_mercadoPagoWebhook(request) {
  try {
    const body = await request.body.json();

    const paymentId = body?.data?.id ? String(body.data.id) : null;
    if (!paymentId) {
      return badRequest({ body: { error: 'payment id ausente' } });
    }

    const results = await wixData.query('PixDonations')
      .eq('donationId', paymentId)
      .limit(1)
      .find();

    if (results.items.length > 0) {
      const item = results.items[0];
      item.status = 'notified';
      await wixData.update('PixDonations', item);
    }

    return ok({ body: { received: true } });
  } catch (error) {
    return badRequest({ body: { error: error.message } });
  }
}
