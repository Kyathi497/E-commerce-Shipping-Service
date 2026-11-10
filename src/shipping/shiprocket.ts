import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Logger } from "../lib/common/index.js";
import { HttpClient } from "../lib/http-client/index.js";
import type { Serviceability, ShippingProvider } from "./provider.js";

// Where the API token is kept between calls, restarts and replicas.
export interface TokenStore {
  load(provider: string): Promise<{ token: string; expiresAt: Date } | null>;
  save(provider: string, token: string, expiresAt: Date): Promise<void>;
}

interface Courier {
  cod?: number;
  estimated_delivery_days?: string | number;
}

// Shiprocket tokens last 10 days; renew a day early.
const TOKEN_LIFETIME_MS = 9 * 24 * 3600 * 1000;

export class ShiprocketProvider implements ShippingProvider {
  readonly name = "shiprocket";
  private readonly http: HttpClient;
  private token: { value: string; expiresAt: Date } | null = null;
  private loggingIn: Promise<string> | null = null;

  constructor(
    private readonly options: { baseUrl: string; email: string; password: string; pickupPincode: string },
    private readonly store: TokenStore,
    private readonly logger: Logger,
  ) {
    // Third-party API: 5 s timeout (§7). GETs retry once; the login never does.
    this.http = new HttpClient({ target: "shiprocket", timeoutMs: 5000, retries: 1 });
  }

  async serviceability(pincode: string, weightGrams: number): Promise<Serviceability> {
    const query = new URLSearchParams({
      pickup_postcode: this.options.pickupPincode,
      delivery_postcode: pincode,
      weight: (Math.max(weightGrams, 100) / 1000).toFixed(2),
      cod: "0",
    });
    const res = await this.authorised<{ status?: number; data?: { available_courier_companies?: Courier[] } }>(
      `${this.options.baseUrl}/courier/serviceability/?${query}`,
    );
    // Shiprocket answers 404 (sometimes inside a 200 body) when no courier delivers there.
    if (res.status !== 200 && res.status !== 404) throw new Error(`Shiprocket serviceability: HTTP ${res.status}`);
    const couriers = res.status === 200 && res.data?.status !== 404 ? (res.data?.data?.available_courier_companies ?? []) : [];
    if (!couriers.length) return { serviceable: false, codAvailable: false, minDays: null, maxDays: null };
    const days = couriers.map((c) => Number(c.estimated_delivery_days)).filter((d) => Number.isFinite(d) && d > 0);
    return {
      serviceable: true,
      codAvailable: couriers.some((c) => Number(c.cod) === 1),
      minDays: days.length ? Math.min(...days) : null,
      maxDays: days.length ? Math.max(...days) : null,
    };
  }

  // GET with the API token; on 401 log in again once and retry.
  private async authorised<T>(url: string) {
    let res = await this.http.get<T>(url, { headers: { Authorization: `Bearer ${await this.currentToken()}` } });
    if (res.status === 401) {
      this.token = null;
      res = await this.http.get<T>(url, { headers: { Authorization: `Bearer ${await this.currentToken(true)}` } });
    }
    return res;
  }

  private async currentToken(forceLogin = false) {
    if (!forceLogin && this.token && this.token.expiresAt > new Date()) return this.token.value;
    if (!forceLogin) {
      const saved = await this.store.load(this.name);
      if (saved && saved.expiresAt > new Date()) {
        this.token = { value: saved.token, expiresAt: saved.expiresAt };
        return saved.token;
      }
    }
    // One login at a time, shared by every call waiting for it.
    this.loggingIn ??= this.login().finally(() => (this.loggingIn = null));
    return this.loggingIn;
  }

  private async login() {
    const res = await this.http.post<{ token?: string }>(`${this.options.baseUrl}/auth/login`, {
      email: this.options.email,
      password: this.options.password,
    });
    if (res.status !== 200 || !res.data?.token) {
      this.logger.error({ status: res.status }, "Shiprocket login failed; check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD");
      throw new Error(`Shiprocket login failed: HTTP ${res.status}`);
    }
    const expiresAt = new Date(Date.now() + TOKEN_LIFETIME_MS);
    this.token = { value: res.data.token, expiresAt };
    await this.store.save(this.name, res.data.token, expiresAt);
    return res.data.token;
  }
}

// AES-256-GCM for the stored token: "iv.tag.ciphertext", base64url.
export class TokenCipher {
  private readonly key: Buffer;

  constructor(keyBase64: string | undefined, fallbackSecret: string) {
    this.key = keyBase64
      ? Buffer.from(keyBase64, "base64")
      : createHash("sha256").update(`shipping-provider-token:${fallbackSecret}`).digest();
    if (this.key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  }

  encrypt(plain: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64url")).join(".");
  }

  decrypt(stored: string) {
    const [iv, tag, data] = stored.split(".").map((s) => Buffer.from(s, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(data!), decipher.final()]).toString("utf8");
  }
}
