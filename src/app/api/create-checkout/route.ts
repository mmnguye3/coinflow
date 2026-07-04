/**
 * Creates a Coinflow hosted-checkout session and returns the link.
 * POST /api/create-checkout  { cents, email, productName }
 */

const ENV = process.env.NEXT_PUBLIC_COINFLOW_ENV === 'prod' ? 'prod' : 'sandbox';
const API_BASE = ENV === 'prod'
  ? 'https://api.coinflow.cash'
  : 'https://api-sandbox.coinflow.cash';
const API_KEY = process.env.COINFLOW_API_KEY || process.env.NEXT_PUBLIC_COINFLOW_API_KEY || '';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@example.com';
const PRODUCT_TYPE = process.env.PRODUCT_TYPE || 'gameOfSkill';

export async function POST(req: Request) {
  try {
    const { cents, email, productName } = await req.json();

    if (!Number.isInteger(cents) || cents < 100) {
      return Response.json({ error: 'cents must be an integer ≥ 100' }, { status: 400 });
    }
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return Response.json({ error: 'valid email required' }, { status: 400 });
    }

    const userId = 'customer-' + crypto.randomUUID().slice(0, 8);
    const orderId = crypto.randomUUID();

    const body = {
      subtotal: { currency: 'USD', cents },
      settlementType: 'Credits',
      email,
      blockchain: 'solana',
      webhookInfo: {
        orderId,
        customerId: userId,
        productName: productName || 'Game Credits',
      },
      chargebackProtectionData: [
        {
          productType: PRODUCT_TYPE,
          productName: productName || 'Game Credits',
          quantity: 1,
          rawProductData: {
            description: `${productName || 'Game Credits'} purchase, order ${orderId}`,
          },
        },
      ],
      supportEmail: SUPPORT_EMAIL,
    };

    const r = await fetch(`${API_BASE}/api/checkout/link`, {
      method: 'POST',
      headers: {
        'Authorization': API_KEY,
        'accept': 'application/json',
        'content-type': 'application/json',
        'x-coinflow-auth-blockchain': 'solana',
        'x-coinflow-auth-user-id': userId,
      },
      body: JSON.stringify(body),
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok || !data.link) {
      console.error('Coinflow error', r.status, data);
      return Response.json({
        error: 'Coinflow rejected the request',
        status: r.status,
        detail: data,
      }, { status: 502 });
    }

    return Response.json({ link: data.link, orderId });
  } catch (err) {
    console.error(err);
    return Response.json({ error: 'server error creating checkout' }, { status: 500 });
  }
}
