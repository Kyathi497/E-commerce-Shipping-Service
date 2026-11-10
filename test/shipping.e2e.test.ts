// End-to-end checks for Phase 3's shipping quotes against the running stack
// (`docker compose up --build` in auth-service, api-gateway and
// shipping-service, with the mock provider), then:  pnpm test:e2e
// GATEWAY_URL, SHIPPING_URL and AUTH_CONTAINER override the defaults.
import { beforeAll, describe, expect, it } from "vitest";
import { signServiceToken } from "../src/lib/auth-guard/index.js";
import { Browser, signedInAdmin } from "./helpers.js";

const SHIPPING = process.env.SHIPPING_URL ?? "http://localhost:4008";
const SECRET = process.env.SERVICE_TOKEN_SECRET ?? "dev-only-service-token-secret-change-me-in-production";

async function quote(body: Record<string, unknown>) {
  const res = await fetch(`${SHIPPING}/internal/shipping/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await signServiceToken(SECRET, "cart-service", "shipping-service")}`,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

let admin: Browser;

beforeAll(async () => {
  admin = await signedInAdmin();
}, 60_000);

describe("PIN code check", () => {
  it("answers in the shopper's words, and validates the PIN code", async () => {
    const guest = new Browser();
    const near = await guest.call("GET", "/api/v1/shipping/serviceability?pincode=520010");
    expect(near.data).toMatchObject({ serviceable: true, codAvailable: true, minDays: 2, maxDays: 3 });
    expect(near.data.message).toBe("Delivers to 520010 in 2–3 days, cash on delivery available.");
    const nowhere = await guest.call("GET", "/api/v1/shipping/serviceability?pincode=999999");
    expect(nowhere.data).toMatchObject({ serviceable: false, message: "Sorry, we don't deliver to 999999 yet." });
    expect((await guest.call("GET", "/api/v1/shipping/serviceability?pincode=12")).status).toBe(422);
  });
});

describe("quotes and rules", () => {
  it("charges today's flat ₹70 and adds packaging to the weight", async () => {
    const res = await quote({ subtotalPaise: 29900, weightGrams: 1000, units: 1 });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ shippingPaise: 7000, weightGrams: 1000 + 150 + 60, serviceability: null });
  });

  it("lets the admin add a free-shipping threshold, which wins by priority", async () => {
    const created = await admin.call("POST", "/api/v1/admin/shipping/rules", {
      name: "E2E free over ₹50,000",
      type: "free_over",
      config: { minSubtotalPaise: 5_000_000 },
      priority: 1,
    });
    expect(created.status).toBe(201);
    const id = created.data.rule.id;
    try {
      expect((await quote({ subtotalPaise: 5_000_000, weightGrams: 1000, units: 1 })).data).toMatchObject({ shippingPaise: 0, rule: { id } });
      expect((await quote({ subtotalPaise: 29900, weightGrams: 1000, units: 1 })).data.shippingPaise).toBe(7000);
    } finally {
      expect((await admin.call("DELETE", `/api/v1/admin/shipping/rules/${id}`)).status).toBe(204);
    }
  });

  it("rejects a rule whose settings don't fit its type", async () => {
    const res = await admin.call("POST", "/api/v1/admin/shipping/rules", { name: "Broken", type: "flat", config: { amountPaise: -5 } });
    expect(res).toMatchObject({ status: 422, data: { fields: { "config.amountPaise": expect.any(String) } } });
  });

  it("keeps quotes for internal callers only", async () => {
    const res = await fetch(`${SHIPPING}/internal/shipping/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtotalPaise: 1, weightGrams: 1, units: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
