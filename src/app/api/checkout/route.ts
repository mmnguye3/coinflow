import { getCheckoutParams } from '@/lib/coinflow';

// API routes default to Node.js runtime (safe for fetch + env vars)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, walletAddress } = body as {
      userId: string;
      walletAddress?: string;
    };

    if (!userId) {
      return Response.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const params = await getCheckoutParams(userId, walletAddress ?? '');

    return Response.json({
      sessionKey: params.sessionKey,
      jwtToken: params.jwtToken,
      destinationAuthKey: params.destinationAuthKey,
      merchantId: process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Checkout init failed:', message);
    return Response.json({ error: message }, { status: 500 });
  }
}
