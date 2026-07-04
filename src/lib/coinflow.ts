const API = process.env.COINFLOW_ENV === 'prod'
  ? 'https://api.coinflow.cash/api'
  : 'https://api-sandbox.coinflow.cash/api';

interface CoinflowConfig {
  merchantId: string;
  apiKey: string;
}

function getConfig(): CoinflowConfig {
  const merchantId = process.env.COINFLOW_MERCHANT_ID;
  const apiKey = process.env.COINFLOW_API_KEY;
  if (!merchantId || !apiKey) {
    throw new Error(
      'Missing COINFLOW_MERCHANT_ID or COINFLOW_API_KEY in environment'
    );
  }
  return { merchantId, apiKey };
}

// Session Key
// Short-lived JWT tying a checkout to a specific end-user (24h expiry)
export async function getSessionKey(userId: string): Promise<string> {
  const { apiKey } = getConfig();

  const res = await fetch(`${API}/auth/session-key`, {
    method: 'GET',
    headers: {
      'Authorization': apiKey,
      'x-coinflow-auth-user-id': userId,
      'accept': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`getSessionKey failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.key;
}

// Checkout JWT
// Signs the cart payload server-side to prevent front-end tampering
export async function getCheckoutJwt(): Promise<string> {
  const { merchantId, apiKey } = getConfig();

  const res = await fetch(`${API}/checkout/jwt-token`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    throw new Error(`getCheckoutJwt failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.checkoutJwtToken;
}

// Destination Auth Key (USDC to your wallet)
// Tokenizes the wallet address where USDC settles
export async function getDestinationAuthKey(
  walletAddress: string,
  blockchain: string = 'polygon'
): Promise<string> {
  const { apiKey } = getConfig();

  const res = await fetch(`${API}/checkout/destination-auth-key`, {
    method: 'POST',
    headers: {
      'Authorization': apiKey,
      'accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      blockchain,
      destination: walletAddress,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `getDestinationAuthKey failed: ${res.status} ${await res.text()}`
    );
  }

  const data = await res.json();
  return data.destinationAuthKey;
}

// Pricing Totals
// Get a quote inclusive of all fees before showing the checkout
export async function getPricingTotals(
  sessionKey: string,
  amountCents: number,
  settlementType: 'USDC' | 'Bank' | 'Credits' = 'USDC'
): Promise<{
  subtotal: { cents: number; currency: string };
  total: { cents: number; currency: string };
  fees: { cents: number; currency: string };
}> {
  const { merchantId } = getConfig();

  const res = await fetch(`${API}/checkout/totals/${merchantId}`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'Content-Type': 'application/json',
      'x-coinflow-auth-session-key': sessionKey,
    },
    body: JSON.stringify({
      subtotal: { cents: amountCents },
      settlementType,
    }),
  });

  if (!res.ok) {
    throw new Error(
      `getPricingTotals failed: ${res.status} ${await res.text()}`
    );
  }

  return res.json();
}

// Batch: get all checkout params in one call
export async function getCheckoutParams(
  userId: string,
  walletAddress: string
): Promise<{
  sessionKey: string;
  jwtToken: string;
  destinationAuthKey: string | null;
}> {
  const [sessionKey, jwtToken] = await Promise.all([
    getSessionKey(userId),
    getCheckoutJwt(),
  ]);

  let destinationAuthKey: string | null = null;
  if (walletAddress) {
    try {
      destinationAuthKey = await getDestinationAuthKey(walletAddress);
    } catch {
      console.warn('destinationAuthKey unavailable (disabled in sandbox) — continuing without it');
    }
  }

  return { sessionKey, jwtToken, destinationAuthKey };
}
