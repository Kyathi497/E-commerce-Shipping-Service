import { Module } from "@nestjs/common";
import { config, SERVICE_NAME } from "./config.js";
import { AuthGuardModule } from "./lib/auth-guard/index.js";
import { HealthModule } from "./lib/common/index.js";
import { logger } from "./logger.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { MockProvider, SHIPPING_PROVIDER } from "./shipping/provider.js";
import { AdminShippingController, InternalShippingController, ShippingController } from "./shipping/shipping.controller.js";
import { ShippingService } from "./shipping/shipping.service.js";
import { ShiprocketProvider, TokenCipher, type TokenStore } from "./shipping/shiprocket.js";

// The Shiprocket token, encrypted, in this service's own database.
function tokenStore(prisma: PrismaService): TokenStore {
  const cipher = new TokenCipher(config.TOKEN_ENCRYPTION_KEY, config.SERVICE_TOKEN_SECRET);
  return {
    async load(provider) {
      const row = await prisma.providerToken.findUnique({ where: { provider } });
      if (!row) return null;
      try {
        return { token: cipher.decrypt(row.token), expiresAt: row.expiresAt };
      } catch {
        // Encrypted with a different key (it was rotated): log in again.
        return null;
      }
    },
    async save(provider, token, expiresAt) {
      const sealed = cipher.encrypt(token);
      await prisma.providerToken.upsert({ where: { provider }, create: { provider, token: sealed, expiresAt }, update: { token: sealed, expiresAt } });
    },
  };
}

@Module({
  imports: [
    PrismaModule,
    AuthGuardModule.forRoot({
      jwksUrl: config.AUTH_JWKS_URL,
      service: { name: SERVICE_NAME, secret: config.SERVICE_TOKEN_SECRET },
    }),
    HealthModule.register({
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => ({ db: () => prisma.$queryRaw`SELECT 1` }),
    }),
  ],
  controllers: [ShippingController, InternalShippingController, AdminShippingController],
  providers: [
    ShippingService,
    {
      provide: SHIPPING_PROVIDER,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => {
        if (config.SHIPPING_PROVIDER === "shiprocket") {
          return new ShiprocketProvider(
            {
              baseUrl: config.SHIPROCKET_BASE_URL,
              email: config.SHIPROCKET_EMAIL!,
              password: config.SHIPROCKET_PASSWORD!,
              pickupPincode: config.PICKUP_PINCODE,
            },
            tokenStore(prisma),
            logger,
          );
        }
        if (config.NODE_ENV === "production") logger.warn("SHIPPING_PROVIDER=mock in production: delivery estimates are made up");
        return new MockProvider({ pickupPincode: config.PICKUP_PINCODE, unserviceable: config.MOCK_UNSERVICEABLE, noCod: config.MOCK_NO_COD });
      },
    },
  ],
})
export class AppModule {}
