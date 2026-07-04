'use client';

import { useRef, useState, useCallback } from 'react';
import {
  CoinflowCardForm,
  CoinflowCvvForm,
  MerchantStyle,
  type CardFormRef,
  type CardFormTokenResponse,
} from '@coinflowlabs/react';

const API = process.env.NEXT_PUBLIC_COINFLOW_ENV === 'prod'
  ? 'https://api.coinflow.cash/api'
  : 'https://api-sandbox.coinflow.cash/api';
const MERCHANT_ID = process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID || '';
const ENV = (process.env.NEXT_PUBLIC_COINFLOW_ENV || 'sandbox') as 'sandbox' | 'prod' | 'staging';

// ── Types ──

export interface CheckoutSession {
  sessionKey: string;
  jwtToken: string;
  destinationAuthKey: string | null;
  merchantId: string;
}

export type PaymentStatus = 'idle' | 'loading' | 'tokenizing' | 'charging' | '3ds' | 'success' | 'error';

// ── Props ──

interface WhiteLabelCardCheckoutProps {
  /** Server-generated checkout session */
  session: CheckoutSession;
  /** Amount in cents ($10 = 1000) */
  amountCents: number;
  /** Player email for prefill */
  email?: string;
  /** Called when payment settles */
  onSuccess?: (paymentId: string) => void;
  /** Called to go back */
  onBack?: () => void;
}

// ── Helper: call the card checkout API directly ──

async function chargeCard(
  session: CheckoutSession,
  cardToken: string,
  expMonth: string,
  expYear: string,
  amountCents: number,
  email?: string
): Promise<{ paymentId?: string; error?: string; threeDsUrl?: string; threeDsCreq?: string }> {
  const body: Record<string, any> = {
    subtotal: { cents: amountCents, currency: 'USD' },
    card: {
      cardToken: cardToken,
      expYear: expYear,
      expMonth: expMonth,
      email: email || 'player@example.com',
      firstName: '',
      lastName: '',
      address1: '123 Main St',
      city: 'New York',
      zip: '10001',
      state: 'NY',
      country: 'US',
    },
    settlementType: 'USDC',
    webhookInfo: { source: 'white-label-checkout' },
    chargebackProtectionData: [
      { productName: 'Gaming Credits', productType: 'topUp', quantity: 1 },
    ],
  };

  if (session.destinationAuthKey) {
    body.destinationAuthKey = session.destinationAuthKey;
  }

  const res = await fetch(`${API}/checkout/card/${MERCHANT_ID}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-coinflow-auth-session-key': session.sessionKey,
      'x-coinflow-auth-user-id': 'customer_' + Date.now(),
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    const data = await res.json();
    return { paymentId: data.paymentId };
  }

  // 412 = 3DS challenge required
  if (res.status === 412) {
    const data = await res.json();
    return {
      threeDsUrl: data.url,
      threeDsCreq: data.creq,
    };
  }

  const text = await res.text();
  return { error: `Payment failed (${res.status}): ${text.substring(0, 200)}` };
}

// ── 3DS Modal Component ──

function ThreeDsModal({ url, creq, onComplete, onCancel }: {
  url: string;
  creq: string;
  onComplete: (paymentId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="mb-2 text-lg font-semibold text-neutral-900">Verify with Your Bank</h3>
        <p className="mb-4 text-sm text-neutral-500">
          Your bank requires additional verification. Complete the 3D Secure challenge to proceed.
        </p>
        <div className="mb-4 overflow-hidden rounded-lg border border-neutral-200">
          <ThreeDsIframe url={url} creq={creq} onComplete={onComplete} />
        </div>
        <button
          onClick={onCancel}
          className="w-full text-center text-sm text-neutral-400 hover:text-neutral-600"
        >
          Cancel payment
        </button>
      </div>
    </div>
  );
}

function ThreeDsIframe({ url, creq, onComplete }: {
  url: string;
  creq: string;
  onComplete: (paymentId: string) => void;
}) {
  // Build the 3DS challenge URL with the CReq
  const challengeUrl = `${url}?creq=${encodeURIComponent(creq)}`;

  return (
    <iframe
      src={challengeUrl}
      className="h-[400px] w-full"
      sandbox="allow-scripts allow-same-origin allow-forms"
      onLoad={() => {
        // Poll for the response from the iframe
        // In production, you'd listen for postMessage or poll /payment/enhanced
      }}
    />
  );
}

// ── Main Component ──

export default function WhiteLabelCardCheckout({
  session,
  amountCents,
  email,
  onSuccess,
  onBack,
}: WhiteLabelCardCheckoutProps) {
  const cardFormRef = useRef<CardFormRef>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [threeDs, setThreeDs] = useState<{ url: string; creq: string } | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);

  const handlePay = useCallback(async () => {
    try {
      setStatus('tokenizing');
      setErrorMsg(null);

      // Step 1: Tokenize the card via PCI-compliant iframe
      const tokenResult: CardFormTokenResponse | undefined =
        await cardFormRef.current?.tokenize();

      if (!tokenResult?.token) {
        setErrorMsg('Could not tokenize card. Check card details.');
        setStatus('error');
        return;
      }

      console.log('✅ Card tokenized:', tokenResult.token.substring(0, 12) + '...');

      // Step 2: Charge the card via direct API call
      setStatus('charging');

      const result = await chargeCard(
        session,
        tokenResult.token,
        tokenResult.expMonth || '12',
        tokenResult.expYear || '30',
        amountCents,
        email
      );

      if (result.paymentId) {
        setStatus('success');
        setPaymentId(result.paymentId);
        onSuccess?.(result.paymentId);
      } else if (result.threeDsUrl) {
        // Step 3: Handle 3DS challenge
        setThreeDs({ url: result.threeDsUrl, creq: result.threeDsCreq! });
        setStatus('3ds');
      } else {
        setErrorMsg(result.error || 'Unknown error');
        setStatus('error');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment failed');
      setStatus('error');
    }
  }, [session, amountCents, email, onSuccess]);

  const handleThreeDsComplete = useCallback((pid: string) => {
    setThreeDs(null);
    setStatus('success');
    setPaymentId(pid);
    onSuccess?.(pid);
  }, [onSuccess]);

  // ── Success State ──
  if (status === 'success' && paymentId) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="mb-3 text-4xl">✅</div>
        <h3 className="mb-1 text-lg font-semibold text-green-800">Payment Complete</h3>
        <p className="mb-3 text-sm text-green-600">
          USDC has been sent to your Polygon wallet.
        </p>
        <div className="rounded-lg bg-white px-3 py-2 text-xs font-mono text-neutral-500">
          Payment ID: {paymentId}
        </div>
      </div>
    );
  }

  const amountFormatted = `$${(amountCents / 100).toFixed(2)}`;

  return (
    <div className="space-y-5">
      {/* 3DS Modal */}
      {threeDs && (
        <ThreeDsModal
          url={threeDs.url}
          creq={threeDs.creq}
          onComplete={handleThreeDsComplete}
          onCancel={() => { setThreeDs(null); setStatus('idle'); }}
        />
      )}

      {/* Amount Summary */}
      <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
        <span className="text-sm text-neutral-600">Total</span>
        <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
      </div>

      {/* ── Card Form — PCI-compliant iframe, your UI around it ── */}
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500 uppercase tracking-wider">
            Card Information
          </label>
          <CoinflowCardForm
            ref={cardFormRef}
            merchantId={MERCHANT_ID}
            env={ENV}
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
              fontSize: '14px',
              placeholderColor: '#9ca3af',
              showCardIcon: true,
            }}
          />
        </div>
      </div>

      {/* Error */}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {onBack && (
          <button
            onClick={onBack}
            disabled={status === 'tokenizing' || status === 'charging'}
            className="flex-1 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50"
          >
            ← Back
          </button>
        )}
        <button
          onClick={handlePay}
          disabled={status === 'tokenizing' || status === 'charging'}
          className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === 'tokenizing' ? 'Verifying card...' :
           status === 'charging' ? 'Processing payment...' :
           `Pay ${amountFormatted}`}
        </button>
      </div>

      {/* Security Notice */}
      <p className="text-center text-xs text-neutral-400">
        🔒 Card data encrypted — PCI DSS Level 1 compliant
      </p>
    </div>
  );
}
