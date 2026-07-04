'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  CoinflowCardForm,
  CoinflowPayPalButton,
  CoinflowVenmoButton,
  CoinflowApplePayButton,
  CoinflowGooglePayButton,
  Currency,
  MerchantStyle,
  type CardFormRef,
  type CardFormTokenResponse,
} from '@coinflowlabs/react';

const PACKS = [
  { credits: 100,  cents: 1000,  tag: null },
  { credits: 250,  cents: 2500,  tag: null },
  { credits: 500,  cents: 5000,  tag: 'POPULAR' },
  { credits: 1000, cents: 10000, tag: 'BEST VALUE' },
];

const API = process.env.NEXT_PUBLIC_COINFLOW_ENV === 'prod'
  ? 'https://api.coinflow.cash/api'
  : 'https://api-sandbox.coinflow.cash/api';
const MERCHANT_ID = process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID || '';
const ENV = (process.env.NEXT_PUBLIC_COINFLOW_ENV || 'sandbox') as 'sandbox' | 'prod';

type Step = 'start' | 'methods' | 'card-form' | 'cashapp' | 'success' | 'error';
type PayStatus = 'idle' | 'loading' | 'success' | 'error';

interface SessionData { sessionKey: string; jwtToken: string; merchantId: string; }

const CARD_THEME = {
  font: 'Chakra Petch', primary: '#a855f7', background: '#ffffff',
  cardBackground: '#f9fafb', textColor: '#111827', textColorAccent: '#6b7280',
  textColorAction: '#ffffff', ctaColor: '#a855f7', style: MerchantStyle.Rounded,
  fontSize: '14px', placeholderColor: '#9ca3af', showCardIcon: true,
};

async function apiPost(path: string, body: Record<string, unknown>, sessionKey: string): Promise<Record<string, any>> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-coinflow-auth-session-key': sessionKey },
    body: JSON.stringify(body),
  });
  if (res.ok) return res.json();
  const text = await res.text();
  let details = '';
  try { const j = JSON.parse(text); details = j.message || j.details || text; } catch { details = text; }
  throw new Error(`${res.status}: ${details.substring(0, 200)}`);
}

function baseBody(amountCents: number) {
  return {
    subtotal: { cents: amountCents, currency: 'USD' }, settlementType: 'USDC',
    webhookInfo: { source: 'white-label-checkout' },
    chargebackProtectionData: [{ productName: 'Gaming Credits', productType: 'topUp', quantity: 1 }],
  };
}

export default function BuyCredits() {
  const [sel, setSel] = useState(0);
  const [email, setEmail] = useState('');
  const [cardName, setCardName] = useState('');
  const [step, setStep] = useState<Step>('start');
  const [errMsg, setErrMsg] = useState('');
  const [session, setSession] = useState<SessionData | null>(null);
  const [payStatus, setPayStatus] = useState<PayStatus>('idle');
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [cashAppLink, setCashAppLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [appleH, setAppleH] = useState(54);
  const [googleH, setGoogleH] = useState(54);
  const [paypalH, setPaypalH] = useState(54);
  const [venmoH, setVenmoH] = useState(54);
  const [paypalOverlayOpen, setPaypalOverlayOpen] = useState(false);
  const cardFormRef = useRef<CardFormRef>(null);

  const pack = PACKS[sel];
  const amountCents = pack.cents;
  const amountFmt = `$${(amountCents / 100).toFixed(2)}`;

  // Success + error callbacks shared by wallet buttons.
  // SDK contract: onSuccess?: OnSuccessMethod, onError?: (message: string) => void
  const onWalletSuccess = useCallback((...args: unknown[]) => {
    const first = args[0] as any;
    const pid = typeof first === 'string' ? first : first?.paymentId;
    if (pid) setPaymentId(String(pid));
    setStep('success');
  }, []);
  const onWalletError = useCallback((message: string) => {
    setErrMsg(message || 'Payment failed');
  }, []);

  // Height handlers — SDK sends the rendered iframe height as a string
  const hApple  = useCallback((h: string) => { const n = Number(h); if (n > 0) setAppleH(n); }, []);
  const hGoogle = useCallback((h: string) => { const n = Number(h); if (n > 0) setGoogleH(n); }, []);
  const hPaypal = useCallback((h: string) => {
    const n = Number(h);
    if (n > 0) setPaypalH(n);
    // PayPal grows its iframe substantially when the approval overlay opens
    setPaypalOverlayOpen(n > 200);
  }, []);
  const hVenmo  = useCallback((h: string) => { const n = Number(h); if (n > 0) setVenmoH(n); }, []);

  async function initCheckout() {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setErrMsg('Enter a valid email first.'); return; }
    setErrMsg(''); setPayStatus('loading');
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'customer_' + Date.now().toString(36), amt: amountCents, wallet: '' }),
      });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error || `HTTP ${res.status}`); }
      const data = await res.json();
      setSession(data); setStep('methods'); setPayStatus('idle');
    } catch (err) { setErrMsg(err instanceof Error ? err.message : 'Failed'); setPayStatus('idle'); }
  }

  async function handleCardPay() {
    if (!session) return;
    setPayStatus('loading'); setErrMsg('');
    try {
      const tokenResult: CardFormTokenResponse | undefined = await cardFormRef.current?.tokenize();
      if (!tokenResult?.token) throw new Error('Could not tokenize card.');
      const nameParts = cardName.trim().split(/\s+/);
      const firstName = nameParts[0] || 'Customer';
      const lastName = nameParts.slice(1).join(' ') || firstName;
      const result = await apiPost(`/checkout/card/${MERCHANT_ID}`, {
        ...baseBody(amountCents), jwtToken: session.jwtToken,
        card: { cardToken: tokenResult.token, expYear: tokenResult.expYear || '30', expMonth: tokenResult.expMonth || '12', email, firstName, lastName, country: 'US' },
      }, session.sessionKey);
      setPaymentId(result.paymentId); setStep('success');
    } catch (err) { setErrMsg(err instanceof Error ? err.message : 'Card failed'); setPayStatus('idle'); }
  }

  async function handleCashApp() {
    if (!session) return;
    setPayStatus('loading'); setErrMsg('');
    try {
      const result = await apiPost(`/checkout/cashapp/${MERCHANT_ID}`, { ...baseBody(amountCents), email }, session.sessionKey);
      setCashAppLink(result.cashAppLink); setPaymentId(result.paymentId); setExpiresAt(result.expiresAt || null); setStep('cashapp');
      setPayStatus('idle');
    } catch (err) { setErrMsg(err instanceof Error ? err.message : 'Cash App failed'); setPayStatus('idle'); }
  }

  useEffect(() => {
    if (cashAppLink && /iPad|iPhone|iPod|Android/.test(navigator.userAgent)) window.location.href = cashAppLink;
  }, [cashAppLink]);

  const resetAll = () => { setStep('start'); setSession(null); setPaymentId(null); setErrMsg(''); setCashAppLink(null); setPayStatus('idle'); };
  const back = () => { setStep('methods'); setErrMsg(''); setPayStatus('idle'); };

  // Styles
  const bg = '#050507'; const card = '#131318'; const row = '#1a1a21'; const line = '#26262e'; const text = '#f2f2f5';
  const muted = '#8a8a99'; const purple = '#a855f7'; const pbg = '#2b1440'; const pline = '#5b2d8a'; const green = '#2dd4a0'; const red = '#ff6b81';
  const cardStyle: React.CSSProperties = { width: '100%', maxWidth: 440, background: card, border: `1px solid ${line}`, borderRadius: 26, padding: '26px 22px 24px', boxShadow: `0 0 60px rgba(168,85,247,.12), 0 24px 60px rgba(0,0,0,.6)` };
  const rowCss: React.CSSProperties = { background: row, border: `1px solid ${line}`, borderRadius: 16, padding: '14px 16px' };
  const btnBase: React.CSSProperties = { width: '100%', border: 'none', borderRadius: 16, cursor: 'pointer', fontSize: 15, fontWeight: 700, fontFamily: 'inherit', color: '#fff', letterSpacing: '.08em', textTransform: 'uppercase', background: `linear-gradient(135deg,${purple},#6d28d9)`, boxShadow: `0 8px 28px rgba(168,85,247,.3)`, padding: 17 };
  const footer = <div style={{ textAlign: 'center', fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: muted, marginTop: 18, lineHeight: '2' }}>🔒 <b style={{ color: green }}>Secure Checkout</b> · PCI · 3DS<br /><span style={{ opacity: 0.7 }}>Sandbox · Test card 4111 1111 1111 1111</span></div>;

  // ── SUCCESS ──
  if (step === 'success') return (
    <div style={{ fontFamily: "'Chakra Petch',sans-serif", background: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 14px 60px' }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', padding: '30px 10px' }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>✅</div>
          <h2 style={{ fontSize: 17, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>Payment Complete</h2>
          <p style={{ fontSize: 12, color: muted, letterSpacing: '.04em', lineHeight: 1.7 }}>{amountFmt} processed.</p>
          {paymentId && <div style={{ margin: '16px auto 0', maxWidth: 280, background: row, border: `1px solid ${line}`, borderRadius: 12, padding: '10px 14px', fontSize: 11, fontFamily: 'monospace', color: muted, wordBreak: 'break-all' }}>ID: {paymentId}</div>}
          <button onClick={resetAll} style={{ ...btnBase, marginTop: 24 }}>New Purchase</button>
        </div>
        {footer}
      </div>
    </div>
  );

  // ── CASH APP QR ──
  if (step === 'cashapp' && cashAppLink) return (
    <div style={{ fontFamily: "'Chakra Petch',sans-serif", background: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 14px 60px' }}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center' }}>
          <button onClick={back} style={{ background: 'none', border: 'none', color: muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 16 }}>← Back</button>
          <div style={{ width: 48, height: 48, borderRadius: 14, margin: '0 auto 12px', background: pbg, border: `1px solid ${pline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: purple, fontSize: 22 }}>$</div>
          <h2 style={{ fontSize: 17, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 4 }}>Cash App</h2>
          <p style={{ fontSize: 12, color: muted, marginBottom: 20 }}>Scan QR code with your phone camera</p>
          <div style={{ display: 'inline-block', background: '#fff', padding: 14, borderRadius: 16 }}><QRCodeSVG value={cashAppLink} size={180} /></div>
          <div style={{ margin: '16px auto 0', maxWidth: 280, background: row, border: `1px solid ${line}`, borderRadius: 12, padding: '10px 14px', fontSize: 11, color: muted, wordBreak: 'break-all' }}>
            <div>Link: <span style={{ color: text }}>{cashAppLink}</span></div>
            {expiresAt && <div style={{ marginTop: 4 }}>Expires: {new Date(expiresAt).toLocaleTimeString()}</div>}
          </div>
          <button onClick={resetAll} style={{ marginTop: 20, width: '100%', padding: 14, border: 'none', borderRadius: 14, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', color: '#fff', letterSpacing: '.08em', textTransform: 'uppercase', background: green, cursor: 'pointer' }}>Done</button>
        </div>
        {footer}
      </div>
    </div>
  );

  // ── CARD FORM ──
  if (step === 'card-form') return (
    <div style={{ fontFamily: "'Chakra Petch',sans-serif", background: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 14px 60px' }}>
      <div style={cardStyle}>
        <button onClick={back} style={{ background: 'none', border: 'none', color: muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 16 }}>← Back</button>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, letterSpacing: '.06em', textTransform: 'uppercase' }}>Credit / Debit Card</h2>
          <p style={{ fontSize: 14, color: muted, marginTop: 4 }}>{amountFmt}</p>
        </div>
        <input
          value={cardName}
          onChange={e => setCardName(e.target.value)}
          placeholder="Name on card"
          autoComplete="cc-name"
          style={{ width: '100%', background: row, border: `1px solid ${line}`, borderRadius: 14, color: text, fontSize: 14, fontWeight: 600, padding: '14px 16px', outline: 'none', fontFamily: 'inherit', marginBottom: 12 }}
        />
        <div style={{ background: '#fff', borderRadius: 16, padding: 16, boxShadow: '0 4px 20px rgba(0,0,0,.3)' }}>
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 8 }}>Card Information</div>
          <CoinflowCardForm ref={cardFormRef} merchantId={MERCHANT_ID} env={ENV} theme={CARD_THEME} />
        </div>
        {errMsg && <div style={{ color: red, fontSize: 12, fontWeight: 600, marginTop: 12 }}>{errMsg}</div>}
        <button onClick={handleCardPay} disabled={payStatus === 'loading'} style={{ ...btnBase, marginTop: 12, opacity: payStatus === 'loading' ? 0.5 : 1 }}>
          {payStatus === 'loading' ? 'Processing…' : `Pay ${amountFmt}`}
        </button>
        <div style={{ marginTop: 12, borderRadius: 12, border: `1px dashed ${line}`, background: row, padding: '10px 14px', fontSize: 11, color: muted }}>Test card: <span style={{ fontFamily: 'monospace', color: text }}>4111 1111 1111 1111</span> · any CVV · future expiry</div>
        {footer}
      </div>
    </div>
  );

  // ── METHOD SELECTOR ──
  if (step === 'methods' && session) return (
    <div style={{ fontFamily: "'Chakra Petch',sans-serif", background: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 14px 60px' }}>
      {/* Full-screen backdrop PayPal fills while its approval overlay is open.
          Must exist in the DOM at all times; pointerEvents toggles so it never
          blocks the page when closed. */}
      <div
        id="paypal-overlay"
        style={{
          position: 'fixed', inset: 0, zIndex: 50,
          pointerEvents: paypalOverlayOpen ? 'auto' : 'none',
          background: paypalOverlayOpen ? 'rgba(5,5,7,.7)' : 'transparent',
          transition: 'background .2s',
        }}
      />
      <div style={cardStyle}>
        <button onClick={resetAll} style={{ background: 'none', border: 'none', color: muted, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 16 }}>← Cancel</button>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 17, letterSpacing: '.06em', textTransform: 'uppercase' }}>Select Payment</h2>
          <p style={{ fontSize: 14, color: muted, marginTop: 4 }}>{amountFmt}</p>
        </div>
        <div style={{ height: 1, background: line, margin: '0 -22px 16px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

          {/* Card */}
          <button onClick={() => setStep('card-form')} style={{ ...rowCss, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: text, width: '100%', textAlign: 'left' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: pbg, border: `1px solid ${pline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: purple, fontSize: 16 }}>💳</div>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '.04em' }}>Credit / Debit Card</span>
            <span style={{ marginLeft: 'auto', color: muted, fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase' }}>Pay</span>
          </button>

          {/* Apple Pay — renders only in Safari/WebKit with Wallet available */}
          <div style={{ width: '100%', height: appleH, borderRadius: 12, overflow: 'hidden' }}>
            <CoinflowApplePayButton
              env={ENV}
              sessionKey={session.sessionKey}
              merchantId={MERCHANT_ID}
              subtotal={{ cents: amountCents, currency: Currency.USD }}
              email={email}
              color="black"
              handleHeightChange={hApple}
              onSuccess={onWalletSuccess}
              onError={onWalletError}
            />
          </div>

          {/* Google Pay — color is REQUIRED by MobileWalletButtonProps */}
          <div style={{ width: '100%', height: googleH, borderRadius: 12, overflow: 'hidden' }}>
            <CoinflowGooglePayButton
              env={ENV}
              sessionKey={session.sessionKey}
              merchantId={MERCHANT_ID}
              subtotal={{ cents: amountCents, currency: Currency.USD }}
              email={email}
              color="black"
              handleHeightChange={hGoogle}
              onSuccess={onWalletSuccess}
              onError={onWalletError}
            />
          </div>

          {/* PayPal — overlayId + onApprove are required */}
          <div style={{ width: '100%', height: paypalH, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <CoinflowPayPalButton
              env={ENV}
              sessionKey={session.sessionKey}
              merchantId={MERCHANT_ID}
              subtotal={{ cents: amountCents, currency: Currency.USD }}
              email={email}
              color="white"
              overlayId="paypal-overlay"
              handleHeightChange={hPaypal}
              onApprove={({ paymentId }: { paymentId: string }) => { setPaymentId(paymentId); setStep('success'); }}
              onError={onWalletError}
            />
          </div>

          {/* Venmo — popup flow: no overlayId prop exists on this component */}
          <div style={{ width: '100%', height: venmoH, borderRadius: 12, overflow: 'hidden', background: '#fff' }}>
            <CoinflowVenmoButton
              env={ENV}
              sessionKey={session.sessionKey}
              merchantId={MERCHANT_ID}
              subtotal={{ cents: amountCents, currency: Currency.USD }}
              email={email}
              color="white"
              handleHeightChange={hVenmo}
              onApprove={({ paymentId }: { paymentId: string }) => { setPaymentId(paymentId); setStep('success'); }}
              onError={onWalletError}
            />
          </div>

          {/* Cash App — official Cash App Pay button style */}
          <button onClick={handleCashApp} disabled={payStatus === 'loading'}
            style={{
              width: '100%', borderRadius: 12, overflow: 'hidden',
              background: '#000', border: 'none', cursor: 'pointer',
              padding: '14px 16px', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              opacity: payStatus === 'loading' ? 0.5 : 1,
            }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="24" height="24" rx="5" fill="#29ABE2"/>
              <text x="12" y="17" textAnchor="middle" fill="white" fontSize="15" fontWeight="700" fontFamily="sans-serif">$</text>
            </svg>
            <span style={{ color: '#fff', fontSize: 15, fontWeight: 600, letterSpacing: '.02em' }}>Cash App Pay</span>
          </button>
        </div>

        {errMsg && <div style={{ color: red, fontSize: 12, fontWeight: 600, marginTop: 14 }}>{errMsg}</div>}
        {footer}
      </div>
    </div>
  );

  // ── START SCREEN ──
  return (
    <div style={{ fontFamily: "'Chakra Petch',sans-serif", background: bg, color: text, minHeight: '100vh', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '28px 14px 60px' }}>
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 21, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase' }}>Buy Credits</h1>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: muted, marginTop: 5 }}>Choose amount &amp; checkout</div>
          </div>
          <button onClick={() => window.location.href = '/'} style={{ width: 38, height: 38, borderRadius: 12, background: row, border: `1px solid ${line}`, color: muted, fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ height: 1, background: line, margin: '0 -22px 20px' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, ...rowCss, marginBottom: 18 }}>
          <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: pbg, border: `1px solid ${pline}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: purple, fontSize: 16 }}>⚡</div>
          <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase', color: muted, flex: 1 }}>Total Amount</div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>{amountFmt}</div>
        </div>
        <div style={{ fontSize: '10.5px', fontWeight: 600, letterSpacing: '.18em', textTransform: 'uppercase', color: muted, margin: '0 2px 10px' }}>Select Amount</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 18 }}>
          {PACKS.map((p, i) => (
            <button key={i} onClick={() => setSel(i)} style={{ background: i === sel ? pbg : row, border: `1px solid ${i === sel ? purple : line}`, borderRadius: 16, padding: '16px 10px', textAlign: 'center', cursor: 'pointer', color: text, fontFamily: 'inherit', fontSize: 'inherit' }}>
              <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-.02em' }}>{p.credits.toLocaleString()} <span style={{ color: purple }}>⬢</span></div>
              <div style={{ fontSize: 12, color: i === sel ? purple : muted, marginTop: 4, fontWeight: 600 }}>${(p.cents / 100).toFixed(2)}</div>
              {p.tag && <div style={{ display: 'inline-block', marginTop: 8, fontSize: 9, fontWeight: 700, letterSpacing: '.1em', color: green, border: '1px solid rgba(45,212,160,.4)', padding: '3px 8px', borderRadius: 99 }}>{p.tag}</div>}
            </button>
          ))}
        </div>
        <div style={{ marginBottom: 16 }}>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email for receipt"
            style={{ width: '100%', background: row, border: `1px solid ${line}`, borderRadius: 14, color: text, fontSize: 14, fontWeight: 600, padding: '14px 16px', outline: 'none', fontFamily: 'inherit' }}
            onFocus={e => e.target.style.borderColor = purple} onBlur={e => e.target.style.borderColor = line} />
        </div>
        <button onClick={initCheckout} disabled={payStatus === 'loading'} style={{ ...btnBase, opacity: payStatus === 'loading' ? 0.5 : 1 }}>
          {payStatus === 'loading' ? 'Creating session…' : `Checkout — ${amountFmt}`}
        </button>
        {errMsg && <div style={{ color: red, fontSize: 12, fontWeight: 600, marginTop: 14 }}>{errMsg}</div>}
        {footer}
      </div>
    </div>
  );
}
