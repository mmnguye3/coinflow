'use client';

import { useEffect } from 'react';
import { CoinflowPurchase, MerchantStyle, Currency, SettlementType, PaymentMethods } from '@coinflowlabs/react';

const MERCHANT_ID = process.env.NEXT_PUBLIC_COINFLOW_MERCHANT_ID || '';
const ENV = (process.env.NEXT_PUBLIC_COINFLOW_ENV || 'sandbox') as 'sandbox' | 'prod' | 'staging';

export interface CheckoutSession {
  sessionKey: string;
  jwtToken: string;
  destinationAuthKey: string | null;
  merchantId: string;
}

interface CoinflowCheckoutProps {
  session: CheckoutSession;
  amountCents: number;
  email?: string;
  onSuccess?: (paymentId: string | { paymentId: string }) => void;
  onBack?: () => void;
  /** Payment methods to hide from the UI */
  disabledMethods?: PaymentMethods[];
}

export default function CoinflowCheckout({
  session,
  amountCents,
  email,
  onSuccess,
  onBack,
  disabledMethods,
}: CoinflowCheckoutProps) {
  // Force the Coinflow iframe to fill the wrapper height
  useEffect(() => {
    const id = setInterval(() => {
      const iframe = document.querySelector('.coinflow-wrapper iframe') as HTMLIFrameElement | null;
      if (iframe) {
        iframe.style.height = '750px';
        iframe.style.minHeight = '750px';
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, []);

  // All available methods
  const allMethods = [
    PaymentMethods.card,
    PaymentMethods.applePay,
    PaymentMethods.googlePay,
    PaymentMethods.paypal,
    PaymentMethods.venmo,
    PaymentMethods.cashApp,
    PaymentMethods.ach,
    PaymentMethods.sepa,
    PaymentMethods.fasterPayments,
    PaymentMethods.pix,
    PaymentMethods.usdc,
    PaymentMethods.wire,
    PaymentMethods.interac,
    PaymentMethods.apa,
    PaymentMethods.crypto,
  ];

  // Show only methods not in disabledMethods
  const allowedMethods = disabledMethods?.length
    ? allMethods.filter((m) => !disabledMethods.includes(m))
    : undefined; // undefined = show all

  return (
    <div className="coinflow-wrapper" style={{ minHeight: '750px' }}>
      {/* Back button overlay */}
      {onBack && (
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-700"
        >
          ← Back to amount selection
        </button>
      )}

      <CoinflowPurchase
        merchantId={MERCHANT_ID}
        env={ENV}
        sessionKey={session.sessionKey}
        jwtToken={session.jwtToken}
        subtotal={{ cents: amountCents, currency: Currency.USD }}
        settlementType={SettlementType.USDC}
        email={email}
        destinationAuthKey={session.destinationAuthKey ?? undefined}
        chargebackProtectionData={[
          { productName: 'Gaming Credits', productType: 'topUp', quantity: 1 },
        ]}
        webhookInfo={{ source: 'coinflow-demo', platform: 'gaming-credits' }}
        supportEmail="support@gamecredits.com"
        onSuccess={onSuccess}
        allowedPaymentMethods={allowedMethods}
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
          fontSize: '20px',
          fontWeight: '600',
          placeholderColor: '#9ca3af',
          showCardIcon: true,
        }}
      />
    </div>
  );
}
