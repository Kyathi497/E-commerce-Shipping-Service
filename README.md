# shipping-service

Shipping charges (rules) and "do you deliver to my PIN code?". Port 4008. Shipments and tracking come in phase 5.

## Run

```sh
docker network create tej-net   # once per machine
docker compose up --build       # service + MySQL (3312)
```

Uses a mock courier by default. For Shiprocket, set in `.env`: `SHIPPING_PROVIDER=shiprocket`,
`SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` (an API user, Settings → API) and, in production,
`TOKEN_ENCRYPTION_KEY`. The Shiprocket token is cached encrypted in the database.

Hot reload: `docker compose up mysql`, then `pnpm install && pnpm dev` (uses `.env`, see `.env.example`).

## Shipping rules

Active rules are tried by `priority` (lowest first); the first that matches sets the charge. The first migration
adds today's flat ₹70.

| type | config | matches |
|---|---|---|
| `flat` | `{amountPaise}` | always |
| `free_over` | `{minSubtotalPaise}` | items after discounts ≥ amount → ₹0 |
| `by_zone` | `{zones:[{name, pincodePrefixes, amountPaise}]}` | PIN code known and in a zone |
| `by_weight` | `{slabs:[{upToGrams, amountPaise}], extraPerKgPaise?}` | always |

Parcel weight = grams of product + `PACKAGING_BASE_GRAMS` + `PACKAGING_PER_UNIT_GRAMS` per jar/box.
PIN code answers are cached for 24 h; if the courier can't be reached an older answer is used, or "couldn't check".

## API

| Endpoint | Who |
|---|---|
| `GET /api/v1/shipping/serviceability?pincode=` | public |
| `GET/POST /api/v1/admin/shipping/rules`, `GET/PATCH/DELETE …/:id` | admin |
| `POST /api/v1/admin/shipping/pincodes/:pincode/refresh` | admin |
| `POST /internal/shipping/quote` `{pincode?, subtotalPaise, weightGrams, units}` | cart-service, order-service |

## Commands

- `pnpm test`: unit tests · `pnpm test:e2e`: end-to-end (stack running, mock provider)
- `pnpm migrate:dev` / `pnpm migrate:deploy`: Prisma migrations

## Shared code

`src/lib/common`, `auth-guard` and `http-client` are shared libraries copied into this service. If you fix a bug in
one, make the same fix in every other service that has a copy.
