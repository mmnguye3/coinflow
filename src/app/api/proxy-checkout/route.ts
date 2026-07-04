import { NextRequest, NextResponse } from 'next/server';

const API = process.env.COINFLOW_ENV === 'prod'
  ? 'https://api.coinflow.cash/api'
  : 'https://api-sandbox.coinflow.cash/api';

export async function POST(request: NextRequest) {
  try {
    const { endpoint, body, sessionKey } = await request.json();

    if (!endpoint || !body || !sessionKey) {
      return NextResponse.json(
        { error: 'endpoint, body, and sessionKey are required' },
        { status: 400 }
      );
    }

    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': process.env.COINFLOW_API_KEY || '',
        'x-coinflow-auth-session-key': sessionKey,
        'x-coinflow-auth-user-id': 'customer_' + Date.now().toString(36),
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    const text = await res.text();
    return NextResponse.json(
      { error: text.substring(0, 300) },
      { status: res.status }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Proxy failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
