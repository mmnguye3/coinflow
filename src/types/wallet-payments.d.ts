// Apple Pay JS type declarations for Coinflow checkout
interface ApplePaySession {
  static canMakePayments(): boolean;
  static supportsVersion(version: number): boolean;
  static STATUS_SUCCESS: number;
  static STATUS_FAILURE: number;

  onvalidatemerchant: ((event: any) => void) | null;
  onpaymentauthorized: ((event: any) => void) | null;
  oncancel: (() => void) | null;

  completeMerchantValidation(validationData: any): void;
  completePayment(status: number): void;
  abort(): void;
  begin(): void;
}

interface ApplePaySessionConstructor {
  new (version: number, paymentRequest: any): ApplePaySession;
  canMakePayments(): boolean;
  supportsVersion(version: number): boolean;
  readonly STATUS_SUCCESS: number;
  readonly STATUS_FAILURE: number;
}

declare var ApplePaySession: ApplePaySessionConstructor;

interface Window {
  ApplePaySession: ApplePaySessionConstructor;
}

// Google Pay types
declare namespace google.payments.api {
  class PaymentsClient {
    constructor(options: { environment: string });
    isReadyToPay(request: any): Promise<any>;
    loadPaymentData(request: any): Promise<any>;
  }
}

interface Window {
  google?: {
    payments?: {
      api?: {
        PaymentsClient?: new (options: { environment: string }) => any;
      };
    };
  };
  ApplePaySession?: {
    new (version: number, paymentRequest: any): any;
    canMakePayments(): boolean;
    supportsVersion(version: number): boolean;
    STATUS_SUCCESS: number;
    STATUS_FAILURE: number;
  };
}
