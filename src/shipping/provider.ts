// Couriers sit behind this interface (§6.9): a mock in dev and CI, Shiprocket
// in production, and room for another courier later. Shipment creation and
// tracking join it in phase 5.

export interface Serviceability {
  serviceable: boolean;
  codAvailable: boolean;
  // Estimated delivery time in days, when the provider gives one.
  minDays: number | null;
  maxDays: number | null;
}

export interface ShippingProvider {
  readonly name: string;
  serviceability(pincode: string, weightGrams: number): Promise<Serviceability>;
}

export const SHIPPING_PROVIDER = Symbol("SHIPPING_PROVIDER");

// Deterministic answers with no account: everything is deliverable except
// the configured PIN codes, and the further from the pickup PIN code, the
// longer it takes (same 2-digit region 2–3 days, same zone 3–5, else 4–7).
export class MockProvider implements ShippingProvider {
  readonly name = "mock";

  constructor(private readonly options: { pickupPincode: string; unserviceable: string[]; noCod: string[] }) {}

  async serviceability(pincode: string): Promise<Serviceability> {
    if (this.options.unserviceable.includes(pincode)) {
      return { serviceable: false, codAvailable: false, minDays: null, maxDays: null };
    }
    const from = this.options.pickupPincode;
    const [minDays, maxDays] = pincode.slice(0, 2) === from.slice(0, 2) ? [2, 3] : pincode[0] === from[0] ? [3, 5] : [4, 7];
    return { serviceable: true, codAvailable: !this.options.noCod.includes(pincode), minDays, maxDays };
  }
}
