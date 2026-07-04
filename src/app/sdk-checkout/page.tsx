'use client';

import { useCallback, useState } from 'react';
import { CoinflowPurchase, MerchantStyle, Currency, SettlementType, PaymentMethods } from '@coinflowlabs/react';

const MERCHANT_ID = process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID || '';
const ENV = (process.env.NEXT_PUBLIC_COINFLOW_ENV || 'sandbox') as 'sandbox' | 'prod' | 'staging';

export default function WhiteLabelPage() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const initCheckout = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'customer_' + Date.now().toString(36),
          amt: 1000,
          wallet: '',
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setSession(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSuccess = useCallback((pid: string | { paymentId: string }) => {
    const id = typeof pid === 'string' ? pid : pid.paymentId;
    setPaymentId(id);
    console.log('🎉 Payment settled:', id);
  }, []);

  const reset = useCallback(() => {
    setSession(null);
    setPaymentId(null);
    setError(null);
  }, []);

  // ── Start screen ──
  if (!session && !paymentId) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-neutral-900 px-6 py-20">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-indigo-600/20">
            <span className="text-4xl">🪙</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Checkout</h1>
          <p className="mt-2 text-neutral-400">Deposit $10.00 to your account</p>

          <div className="mt-10 space-y-3">
            <button
              onClick={initCheckout}
              disabled={loading}
              className="w-full rounded-xl bg-indigo-600 px-6 py-4 text-base font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 transition"
            >
              {loading ? 'Loading…' : 'Continue — $10.00'}
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-800 bg-red-900/50 p-4">
              <p className="text-sm text-red-300">{error}</p>
              <button onClick={() => setError(null)} className="mt-2 text-xs text-indigo-400 underline">
                Try again
              </button>
            </div>
          )}

          <p className="mt-8 text-xs text-neutral-600">🔒 Secured by industry-standard encryption</p>
        </div>
      </main>
    );
  }

  // ── Success ──
  if (paymentId) {
    return (
      <main className="flex min-h-screen flex-col items-center bg-neutral-900 px-6 py-20">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
            <span className="text-3xl">✅</span>
          </div>
          <h2 className="text-xl font-bold text-white">Payment Complete</h2>
          <p className="mt-1 text-sm text-neutral-400 break-all">ID: {paymentId}</p>
          <button onClick={reset} className="mt-6 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
            New Payment
          </button>
        </div>
      </main>
    );
  }

  // ── Checkout (CoinflowPurchase iframe in your UI shell) ──
  return (
    <main className="flex min-h-screen flex-col items-center bg-neutral-900 px-6 py-8">
      <div className="w-full max-w-xl">
        {/* Your header */}
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-white">Checkout</h1>
          <p className="mt-1 text-lg text-neutral-400">$10.00</p>
        </div>

        {/* Back button */}
        <button
          onClick={reset}
          className="mb-4 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-300"
        >
          ← Cancel
        </button>

        {/* Coinflow SDK — handles all payment methods in one iframe */}
        <div className="rounded-xl bg-white overflow-hidden">
          <div className="p-1">
            <CoinflowPurchase
              merchantId={MERCHANT_ID}
              env={ENV}
              sessionKey={session.sessionKey}
              jwtToken={session.jwtToken}
              subtotal={{ cents: 1000, currency: Currency.USD }}
              settlementType={SettlementType.USDC}
              email="customer@example.com"
              supportEmail="support@yourplatform.com"
              onSuccess={handleSuccess}
              allowedPaymentMethods={[
                PaymentMethods.card,
                PaymentMethods.applePay,
                PaymentMethods.googlePay,
                PaymentMethods.paypal,
                PaymentMethods.venmo,
                PaymentMethods.cashApp,
              ]}
              theme={{
                font: 'Inter',
                primary: '#4f46e5',
                background: '#ffffff',
                cardBackground: '#f9fafb',
                textColor: '#111827',
                textColorAccent: '#6b7280',
                textColorAction: '#ffffff',
                ctaColor: '#4f46e5',
                style: MerchantStyle.Rounded,
                fontSize: '16px',
                placeholderColor: '#9ca3af',
                showCardIcon: true,
              }}
            />
          </div>
        </div>

        {/* Your footer */}
        <p className="mt-4 text-center text-xs text-neutral-600">🔒 PCI DSS Level 1 compliant</p>
      </div>
    </main>
  );
}
