'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CoinflowCardForm,
  MerchantStyle,
  type CardFormRef,
  type CardFormTokenResponse,
} from '@coinflowlabs/react';

const API = process.env.NEXT_PUBLIC_COINFLOW_ENV === 'prod'
  ? 'https://api.coinflow.cash/api'
  : 'https://api-sandbox.coinflow.cash/api';
const MERCHANT_ID = process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID || '';
const ENV = (process.env.NEXT_PUBLIC_COINFLOW_ENV || 'sandbox') as 'sandbox' | 'prod' | 'staging';

export interface CheckoutSession {
  sessionKey: string;
  jwtToken: string;
  destinationAuthKey: string | null;
  merchantId: string;
}

export type PaymentMethod = 'card' | 'apple-pay' | 'google-pay' | 'paypal' | 'venmo' | 'cashapp';
export type PaymentStatus = 'idle' | 'loading' | 'tokenizing' | 'charging' | 'redirect' | 'success' | 'error';

interface HybridCheckoutProps {
  session: CheckoutSession;
  amountCents: number;
  email?: string;
  playerId?: string;
  onSuccess?: (paymentId: string) => void;
  onBack?: () => void;
}

const METHODS: { id: PaymentMethod; label: string; icon: string }[] = [
  { id: 'card',       label: 'Credit / Debit Card', icon: '💳' },
  { id: 'apple-pay',  label: 'Apple Pay',           icon: '🍎' },
  { id: 'google-pay', label: 'Google Pay',          icon: '💚' },
  { id: 'paypal',     label: 'PayPal',              icon: '💙' },
  { id: 'venmo',      label: 'Venmo',               icon: '⚡' },
  { id: 'cashapp',    label: 'Cash App',            icon: '💵' },
];

// ── Theme shared across card form ──

const CARD_THEME = {
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
};

// ── Direct API helper ──

async function apiPost(path: string, body: any, sessionKey: string): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-coinflow-auth-session-key': sessionKey,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  let details = '';
  try { const j = JSON.parse(text); details = j.message || j.details || text; } catch { details = text; }
  throw new Error(`${res.status}: ${details.substring(0, 200)}`);
}

// ── Proxy for PayPal/Venmo (needs server-side API key) ──

async function proxyCheckout(endpoint: string, body: any, sessionKey: string): Promise<any> {
  const res = await fetch(`/api/proxy-checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint, body, sessionKey }),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  let details = '';
  try { const j = JSON.parse(text); details = j.message || j.details || text; } catch { details = text; }
  throw new Error(`${res.status}: ${details.substring(0, 200)}`);
}

// ── Common checkout body shared by most methods ──

function baseBody(amountCents: number, email?: string) {
  return {
    subtotal: { cents: amountCents, currency: 'USD' },
    settlementType: 'USDC',
    webhookInfo: { source: 'gamecredits-hybrid-checkout' },
    chargebackProtectionData: [
      { productName: 'Gaming Credits', productType: 'topUp', quantity: 1 },
    ],
  };
}

// ── Success view ──

function SuccessView({ paymentId }: { paymentId: string }) {
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

// ── Main Component ──

export default function HybridCheckout({
  session, amountCents, email, playerId, onSuccess, onBack,
}: HybridCheckoutProps) {
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [cashAppLink, setCashAppLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [ppEmail, setPpEmail] = useState('');
  const cardFormRef = useRef<CardFormRef>(null);

  // Auto-redirect Cash App on mobile
  useEffect(() => {
    if (status === 'redirect' && cashAppLink && typeof window !== 'undefined') {
      const ua = navigator.userAgent || navigator.vendor;
      const isMobile = /iPad|iPhone|iPod|Android/.test(ua);
      if (isMobile) {
        window.location.href = cashAppLink;
      }
    }
  }, [status, cashAppLink]);

  const amountFormatted = `$${(amountCents / 100).toFixed(2)}`;

  // ── Success state ──
  if (status === 'success' && paymentId) {
    return <SuccessView paymentId={paymentId} />;
  }

  // ── Method selector ──
  if (!method) {
    return (
      <div className="space-y-5">
        {onBack && (
          <button onClick={onBack} className="flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700">
            ← Back to amount selection
          </button>
        )}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-600">Total</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-medium text-neutral-500 uppercase tracking-wider">Select payment method</p>
          {METHODS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMethod(m.id)}
              className="flex w-full items-center gap-3 rounded-lg border border-neutral-200 px-4 py-3 text-left text-sm font-medium text-neutral-700 transition hover:border-indigo-300 hover:bg-indigo-50"
            >
              <span className="text-lg">{m.icon}</span>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-center text-xs text-neutral-400">
          🔒 PCI DSS Level 1 compliant
        </p>
      </div>
    );
  }

  // ── Method-specific checkout UIs ──

  const commonError = errorMsg && (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">⚠️ {errorMsg}</div>
  );

  const backButton = (
    <button onClick={() => { setMethod(null); setErrorMsg(null); setStatus('idle'); }} className="text-sm text-neutral-400 hover:text-neutral-600">← Change payment method</button>
  );

  // ── Card Form ──
  if (method === 'card') {
    const handlePayCard = async () => {
      try {
        setStatus('tokenizing');
        setErrorMsg(null);
        const tokenResult: CardFormTokenResponse | undefined = await cardFormRef.current?.tokenize();
        if (!tokenResult?.token) {
          setErrorMsg('Could not tokenize card. Check card details.');
          setStatus('error');
          return;
        }
        setStatus('charging');
        const result = await apiPost(`/checkout/card/${MERCHANT_ID}`, {
          ...baseBody(amountCents, email),
          jwtToken: session.jwtToken,
          card: {
            cardToken: tokenResult.token,
            expYear: tokenResult.expYear || '30',
            expMonth: tokenResult.expMonth || '12',
            email: email || 'player@example.com',
            firstName: 'John',
            lastName: 'Doe',
            country: 'US',
          },
        }, session.sessionKey);
        setPaymentId(result.paymentId);
        setStatus('success');
        onSuccess?.(result.paymentId);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Payment failed');
        setStatus('error');
      }
    };

    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">💳 Credit / Debit Card</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-neutral-500 uppercase tracking-wider">Card Information</p>
          <CoinflowCardForm ref={cardFormRef} merchantId={MERCHANT_ID} env={ENV} theme={CARD_THEME} />
        </div>
        {commonError}
        <div className="flex gap-3">
          <button onClick={() => setMethod(null)} className="flex-1 rounded-lg border border-neutral-200 px-4 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50">← Back</button>
          <button onClick={handlePayCard} disabled={status === 'tokenizing' || status === 'charging'}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {status === 'tokenizing' ? 'Verifying card…' : status === 'charging' ? 'Processing…' : `Pay ${amountFormatted}`}
          </button>
        </div>
        <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-400">
          Test card: <span className="font-mono text-neutral-500">4111 1111 1111 1111</span> · any CVV · future expiry
        </div>
      </div>
    );
  }

  // ── Apple Pay ──
  if (method === 'apple-pay') {
    const handleApplePay = async () => {
      try {
        setStatus('loading');
        setErrorMsg(null);

        if (!window.ApplePaySession || !window.ApplePaySession.canMakePayments()) {
          setErrorMsg('Apple Pay is not available on this device');
          setStatus('error');
          return;
        }

        // Step 1: Get merchant validation from Coinflow
        const validateRes = await fetch(`${API}/checkout/apple-pay/validate-merchant/${MERCHANT_ID}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-coinflow-auth-session-key': session.sessionKey,
          },
          body: JSON.stringify({
            url: window.location.origin,
            displayName: 'GameCredits',
          }),
        });
        if (!validateRes.ok) throw new Error('Merchant validation failed');
        const { merchantSession } = await validateRes.json();

        // Step 2: Create Apple Pay session
        const applePayVersion = window.ApplePaySession.supportsVersion(6) ? 6 :
                                window.ApplePaySession.supportsVersion(5) ? 5 :
                                window.ApplePaySession.supportsVersion(4) ? 4 : 3;

        const paymentRequest = {
          countryCode: 'US',
          currencyCode: 'USD',
          supportedNetworks: ['visa', 'masterCard', 'amex', 'discover'],
          merchantCapabilities: ['supports3DS'],
          total: { label: 'GameCredits', amount: (amountCents / 100).toFixed(2) },
        };

        const appleSession = new window.ApplePaySession(applePayVersion, paymentRequest);

        appleSession.onvalidatemerchant = async (event) => {
          const validationRes = await fetch(merchantSession, {
            method: 'POST',
            body: JSON.stringify(event.validationURL),
            headers: { 'Content-Type': 'application/json' },
          });
          const validationData = await validationRes.json();
          appleSession.completeMerchantValidation(validationData);
        };

        appleSession.onpaymentauthorized = async (event) => {
          try {
            const result = await apiPost(`/checkout/v2/apple-pay/${MERCHANT_ID}`, {
              ...baseBody(amountCents, email),
              applePayPayment: event.payment,
            }, session.sessionKey);
            appleSession.completePayment(window.ApplePaySession.STATUS_SUCCESS);
            setPaymentId(result.paymentId);
            setStatus('success');
            onSuccess?.(result.paymentId);
          } catch {
            appleSession.completePayment(window.ApplePaySession.STATUS_FAILURE);
            setErrorMsg('Apple Pay payment failed');
            setStatus('error');
          }
        };

        appleSession.oncancel = () => {
          setStatus('idle');
        };

        appleSession.begin();
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Apple Pay failed');
        setStatus('error');
      }
    };

    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">🍎 Apple Pay</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        {!window.ApplePaySession?.canMakePayments() ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            Apple Pay is not available on this device or browser.
          </div>
        ) : (
          <button onClick={handleApplePay} disabled={status === 'loading'}
            className="w-full rounded-xl bg-black px-4 py-4 text-center text-lg font-semibold text-white hover:bg-gray-800 disabled:opacity-60">
            {status === 'loading' ? 'Opening Apple Pay…' : `Pay ${amountFormatted}`}
          </button>
        )}
        {commonError}
      </div>
    );
  }

  // ── Google Pay ──
  if (method === 'google-pay') {
    const handleGooglePay = async () => {
      try {
        setStatus('loading');
        setErrorMsg(null);

        // Load Google Pay client
        const paymentsClient = new window.google.payments.api.PaymentsClient({
          environment: 'TEST',
        });

        const isReady = await paymentsClient.isReadyToPay({
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: [{
            type: 'CARD',
            parameters: {
              allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
              allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
            },
          }],
        });

        if (!isReady) {
          setErrorMsg('Google Pay is not available on this device');
          setStatus('error');
          return;
        }

        const paymentDataRequest = {
          apiVersion: 2,
          apiVersionMinor: 0,
          allowedPaymentMethods: [{
            type: 'CARD',
            parameters: {
              allowedAuthMethods: ['PAN_ONLY', 'CRYPTOGRAM_3DS'],
              allowedCardNetworks: ['VISA', 'MASTERCARD', 'AMEX', 'DISCOVER'],
            },
            tokenizationSpecification: {
              type: 'PAYMENT_GATEWAY',
              parameters: {
                gateway: 'coinflow',
                gatewayMerchantId: MERCHANT_ID,
              },
            },
          }],
          merchantInfo: {
            merchantId: MERCHANT_ID,
            merchantName: 'GameCredits',
          },
          transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: (amountCents / 100).toFixed(2),
            currencyCode: 'USD',
          },
        };

        const paymentData = await paymentsClient.loadPaymentData(paymentDataRequest);

        const result = await apiPost(`/checkout/google-pay/${MERCHANT_ID}`, {
          ...baseBody(amountCents, email),
          paymentData,
        }, session.sessionKey);
        setPaymentId(result.paymentId);
        setStatus('success');
        onSuccess?.(result.paymentId);
      } catch (err: any) {
        if (err?.statusCode === 'CANCELED') {
          setStatus('idle');
          return;
        }
        setErrorMsg(err instanceof Error ? err.message : 'Google Pay failed');
        setStatus('error');
      }
    };

    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">💚 Google Pay</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        <button onClick={handleGooglePay} disabled={status === 'loading'}
          className="w-full rounded-xl bg-black px-4 py-4 text-center text-lg font-semibold text-white hover:bg-gray-800 disabled:opacity-60">
          {status === 'loading' ? 'Opening Google Pay…' : `Pay ${amountFormatted}`}
        </button>
        {commonError}
      </div>
    );
  }

  // ── PayPal / Venmo — email input, POST to raw API ──
  if (method === 'paypal' || method === 'venmo') {
    const handlePpPay = async () => {
      try {
        setStatus('loading');
        setErrorMsg(null);
        if (!ppEmail && !email) {
          setErrorMsg('Please enter your PayPal email');
          setStatus('error');
          return;
        }
        const targetEmail = ppEmail || email || '';
        const endpoint = method === 'venmo' ? 'venmo' : 'paypal';
        const result = await proxyCheckout(`/checkout/${endpoint}/${MERCHANT_ID}`, {
          subtotal: { cents: amountCents, currency: 'USD' },
          settlementType: 'USDC',
          webhookInfo: { source: 'gamecredits-hybrid-checkout' },
          chargebackProtectionData: [{ productName: 'Gaming Credits', productType: 'topUp', quantity: 1 }],
          [endpoint]: { email: targetEmail },
        }, session.sessionKey);
        setPaymentId(result.paymentId);
        setStatus('success');
        onSuccess?.(result.paymentId);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : `${method === 'venmo' ? 'Venmo' : 'PayPal'} payment failed`);
        setStatus('error');
      }
    };

    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">{method === 'paypal' ? '💙 PayPal' : '⚡ Venmo'}</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-500 uppercase tracking-wider">
            {method === 'paypal' ? 'PayPal' : 'Venmo'} Email
          </label>
          <input
            type="email"
            value={ppEmail}
            onChange={(e) => setPpEmail(e.target.value)}
            placeholder="your@email.com"
            className="w-full rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-indigo-400"
          />
        </div>
        {commonError}
        <button onClick={handlePpPay} disabled={status === 'loading'}
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-center text-lg font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
          {status === 'loading' ? 'Processing…' : `Pay ${amountFormatted} with ${method === 'paypal' ? 'PayPal' : 'Venmo'}`}
        </button>
        <div className="rounded-lg border border-dashed border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-400">
          Any email address works in sandbox (e.g. <span className="font-mono text-neutral-500">test@example.com</span>)
        </div>
      </div>
    );
  }

  // ── Cash App ──
  if (method === 'cashapp') {
    const handleCashApp = async () => {
      try {
        setStatus('loading');
        setErrorMsg(null);
        const result = await apiPost(`/checkout/cashapp/${MERCHANT_ID}`, {
          ...baseBody(amountCents, email),
          email: email || 'customer@example.com',
        }, session.sessionKey);
        setCashAppLink(result.cashAppLink);
        setPaymentId(result.paymentId);
        setExpiresAt(result.expiresAt || null);
        setStatus('redirect');
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Cash App failed');
        setStatus('error');
      }
    };

    if (status === 'redirect' && cashAppLink) {
      return (
        <div className="space-y-4">
          <div className="rounded-xl border border-indigo-100 bg-indigo-50 p-6 text-center">
            <div className="mb-2 text-3xl">💵</div>
            <h3 className="mb-1 text-sm font-semibold text-indigo-800">Scan with Cash App</h3>
            <p className="mb-4 text-xs text-indigo-600">
              Scan this QR code with the Cash App on your phone to complete payment.
            </p>
            {/* QR Code */}
            <div className="mx-auto mb-4 inline-block rounded-lg bg-white p-4 shadow-sm">
              <QRCodeSVG value={cashAppLink} size={200} />
            </div>
            <p className="mb-2 text-xs text-indigo-500">
              Or open the link directly on your phone:
            </p>
            <a href={cashAppLink} target="_blank" rel="noopener noreferrer"
              className="inline-block rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
              Open Cash App
            </a>
            <p className="mt-3 text-xs text-indigo-400">
              Payment ID: {paymentId} &middot; Expires: {expiresAt ? new Date(expiresAt).toLocaleTimeString() : ''}
            </p>
          </div>
          {backButton}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {backButton}
        <div className="flex items-center justify-between rounded-lg bg-neutral-50 px-4 py-3">
          <span className="text-sm text-neutral-500">💵 Cash App</span>
          <span className="text-xl font-bold text-neutral-900">{amountFormatted}</span>
        </div>
        <button onClick={handleCashApp} disabled={status === 'loading'}
          className="w-full rounded-xl bg-green-600 px-4 py-4 text-center text-lg font-semibold text-white hover:bg-green-700 disabled:opacity-60">
          {status === 'loading' ? 'Creating request…' : `Pay ${amountFormatted} with Cash App`}
        </button>
        {commonError}
      </div>
    );
  }

  return null;
}


