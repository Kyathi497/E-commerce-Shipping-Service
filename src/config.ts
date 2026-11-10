import { envList, loadConfig, nodeEnv } from "./lib/common/index.js";
import { z } from "zod";

// Dev-only default so services agree out of the box; production must set its own.
const DEV_SERVICE_TOKEN_SECRET = "dev-only-service-token-secret-change-me-in-production";

const schema = z
  .object({
    NODE_ENV: nodeEnv,
    PORT: z.coerce.number().int().default(4008),

    DB_HOST: z.string().default("localhost"),
    DB_PORT: z.coerce.number().int().default(3306),
    MYSQL_USER: z.string().min(1),
    MYSQL_PASSWORD: z.string().min(1),
    MYSQL_DATABASE: z.string().min(1),

    // auth-service's public keys, for checking admin tokens.
    AUTH_JWKS_URL: z.url().default("http://localhost:4001/internal/.well-known/jwks.json"),
    // Shared by every service for service-to-service tokens (§7). At least 32 characters.
    SERVICE_TOKEN_SECRET: z.string().min(32).default(DEV_SERVICE_TOKEN_SECRET),

    // Who answers "do you deliver to this PIN code?" (§6.9). The mock needs
    // no account and is what dev and CI use.
    SHIPPING_PROVIDER: z.enum(["mock", "shiprocket"]).default("mock"),
    SHIPROCKET_BASE_URL: z.url().default("https://apiv2.shiprocket.in/v1/external"),
    // A Shiprocket API user (Settings → API → Configure), not the main login.
    SHIPROCKET_EMAIL: z.string().optional(),
    SHIPROCKET_PASSWORD: z.string().optional(),
    // Encrypts the cached Shiprocket token at rest: 32 random bytes, base64
    // (`openssl rand -base64 32`). Required with Shiprocket in production.
    TOKEN_ENCRYPTION_KEY: z.base64().optional(),
    // Where parcels are picked up: the store in Vijayawada.
    PICKUP_PINCODE: z.string().regex(/^[1-9]\d{5}$/).default("520003"),
    // Mock provider only: PIN codes it treats as undeliverable or without COD.
    MOCK_UNSERVICEABLE: envList(["999999"]),
    MOCK_NO_COD: envList([]),

    // How long a PIN code answer is reused before asking the provider again.
    PINCODE_CACHE_HOURS: z.coerce.number().positive().default(24),
    // Box, jar and padding weight added to the contents for the courier.
    PACKAGING_BASE_GRAMS: z.coerce.number().int().min(0).default(150),
    PACKAGING_PER_UNIT_GRAMS: z.coerce.number().int().min(0).default(60),
    // Charged when no shipping rule matches. Today's flat ₹70.
    FALLBACK_SHIPPING_PAISE: z.coerce.number().int().min(0).default(7000),
  })
  .refine((c) => c.NODE_ENV !== "production" || c.SERVICE_TOKEN_SECRET !== DEV_SERVICE_TOKEN_SECRET, {
    message: "SERVICE_TOKEN_SECRET must be set in production",
    path: ["SERVICE_TOKEN_SECRET"],
  })
  .refine((c) => c.SHIPPING_PROVIDER !== "shiprocket" || (c.SHIPROCKET_EMAIL && c.SHIPROCKET_PASSWORD), {
    message: "SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD are needed when SHIPPING_PROVIDER=shiprocket",
    path: ["SHIPROCKET_EMAIL"],
  })
  .refine((c) => c.NODE_ENV !== "production" || c.SHIPPING_PROVIDER !== "shiprocket" || c.TOKEN_ENCRYPTION_KEY, {
    message: "TOKEN_ENCRYPTION_KEY must be set in production",
    path: ["TOKEN_ENCRYPTION_KEY"],
  });

export const config = loadConfig(schema);
export type Config = typeof config;

export const SERVICE_NAME = "shipping-service";
