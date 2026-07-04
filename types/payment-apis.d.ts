// Global type declarations for native payment APIs (Apple Pay, Google Pay, PayPal)

// ── Apple Pay ──

interface ApplePayJS {
  ApplePaySession: {
    new(version: number, paymentRequest: {
      countryCode: string;
      currencyCode: string;
      supportedNetworks: string[];
      merchantCapabilities: string[];
      total: { label: string; amount: string };
    }): {
      onvalidatemerchant: ((event: { validationURL: string }) => void) | null;
      onpaymentauthorized: ((event: { payment: any }) => void) | null;
      oncancel: (() => void) | null;
      completeMerchantValidation(validationData: any): void;
      completePayment(status: number): void;
      begin(): void;
    };
    supportsVersion(version: number): boolean;
    canMakePayments(): boolean;
    canMakePaymentsWithActiveCard(merchantIdentifier: string): Promise<boolean>;
    readonly STATUS_SUCCESS: number;
    readonly STATUS_FAILURE: number;
  };
}

// ── Google Pay ──

interface GooglePaymentsClient {
  isReadyToPay(request: {
    apiVersion: number;
    apiVersionMinor: number;
    allowedPaymentMethods: any[];
  }): Promise<any>;
  loadPaymentData(request: any): Promise<any>;
}

interface GooglePaymentsGlobal {
  payments: {
    api: {
      PaymentsClient: new (options: { environment: string }) => GooglePaymentsClient;
    };
  };
}

// ── PayPal ──

interface PayPalButtonsComponent {
  render(container: HTMLElement | string): Promise<void>;
}

interface PayPalSDK {
  Buttons(options: {
    fundingSource?: string;
    createOrder: () => Promise<string>;
    onApprove: (data: any) => void;
    onError: (err: any) => void;
    onCancel: () => void;
  }): PayPalButtonsComponent;
  FUNDING: {
    VENMO: string;
    PAYPAL: string;
  };
}

// Augment Window
interface Window extends ApplePayJS {
  google: GooglePaymentsGlobal;
  paypal?: PayPalSDK;
}
