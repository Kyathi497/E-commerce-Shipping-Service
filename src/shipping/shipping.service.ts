import { Inject, Injectable } from "@nestjs/common";
import { config } from "../config.js";
import type { Prisma } from "../generated/prisma/client.js";
import { AppError } from "../lib/common/index.js";
import { logger } from "../logger.js";
import { PrismaService } from "../prisma/prisma.service.js";
import type { CreateRuleDto, QuoteDto, UpdateRuleDto } from "./dto.js";
import { SHIPPING_PROVIDER, type Serviceability, type ShippingProvider } from "./provider.js";
import { parseRuleConfig, quote, type RuleType } from "./rules.js";

type Tx = Prisma.TransactionClient;

export interface Actor {
  id: string;
}

// What the store shows under the PIN code box. `serviceable: null` means we
// couldn't ask the courier just now; the order can still go ahead.
export interface ServiceabilityAnswer extends Omit<Serviceability, "serviceable"> {
  pincode: string;
  serviceable: boolean | null;
  message: string;
  checkedAt: Date | null;
}

export function describe(pincode: string, s: Serviceability | null): string {
  if (!s) return `We couldn't check delivery to ${pincode} just now. You can still place your order.`;
  if (!s.serviceable) return `Sorry, we don't deliver to ${pincode} yet.`;
  const days = s.minDays && s.maxDays ? (s.minDays === s.maxDays ? ` in ${s.minDays} days` : ` in ${s.minDays}–${s.maxDays} days`) : "";
  return `Delivers to ${pincode}${days}${s.codAvailable ? ", cash on delivery available" : ", prepaid only"}.`;
}

// Box, jar and padding on top of what's inside.
export const billableGrams = (contentGrams: number, units: number) =>
  contentGrams + (units > 0 ? config.PACKAGING_BASE_GRAMS + units * config.PACKAGING_PER_UNIT_GRAMS : 0);

@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
  ) {}

  // "Delivers to 520003 in 2–3 days, cash on delivery available" (§6.9).
  // Answers are cached per PIN code; if the courier can't be reached, an
  // older answer is better than none.
  async serviceability(pincode: string, weightGrams = 1000, fresh = false): Promise<ServiceabilityAnswer> {
    const cached = await this.prisma.pincodeCache.findUnique({ where: { pincode } });
    const maxAge = config.PINCODE_CACHE_HOURS * 3600 * 1000;
    if (!fresh && cached && cached.provider === this.provider.name && Date.now() - cached.checkedAt.getTime() < maxAge) {
      return this.answer(pincode, cached, cached.checkedAt);
    }
    try {
      const result = await this.provider.serviceability(pincode, weightGrams);
      const row = { ...result, provider: this.provider.name, checkedAt: new Date() };
      await this.prisma.pincodeCache.upsert({ where: { pincode }, create: { pincode, ...row }, update: row });
      return this.answer(pincode, result, row.checkedAt);
    } catch (err) {
      logger.warn({ err, pincode, provider: this.provider.name }, "serviceability check failed");
      if (cached) return this.answer(pincode, cached, cached.checkedAt);
      return { pincode, serviceable: null, codAvailable: false, minDays: null, maxDays: null, message: describe(pincode, null), checkedAt: null };
    }
  }

  // The shipping charge for a cart or order (§6.9 POST /internal/shipping/quote).
  // Rules are local, so a quote never waits on the courier; the delivery
  // check rides along when a PIN code is known.
  async quote(dto: QuoteDto) {
    const weightGrams = billableGrams(dto.weightGrams, dto.units);
    const rules = await this.prisma.shippingRule.findMany({ where: { active: true } });
    const result = quote(
      rules.map((r) => ({ ...r, type: r.type as RuleType })),
      { pincode: dto.pincode, subtotalPaise: dto.subtotalPaise, weightGrams },
      config.FALLBACK_SHIPPING_PAISE,
    );
    const serviceability = dto.pincode ? await this.serviceability(dto.pincode, weightGrams) : null;
    return { ...result, weightGrams, serviceability };
  }

  async listRules() {
    return { items: await this.prisma.shippingRule.findMany({ orderBy: [{ active: "desc" }, { priority: "asc" }, { createdAt: "asc" }] }) };
  }

  async getRule(id: string) {
    const rule = await this.prisma.shippingRule.findUnique({ where: { id } });
    if (!rule) throw notFound();
    return { rule };
  }

  async createRule(actor: Actor, dto: CreateRuleDto) {
    const ruleConfig = parseRuleConfig(dto.type, dto.config);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.shippingRule.create({
        data: { name: dto.name, type: dto.type, config: ruleConfig, priority: dto.priority ?? 100, active: dto.active ?? true, createdBy: actor.id },
      });
      await audit(tx, actor, "shipping_rule.create", rule.id, { type: rule.type });
      return { rule };
    });
  }

  async updateRule(actor: Actor, id: string, dto: UpdateRuleDto) {
    const { version, config: newConfig, ...fields } = dto;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.shippingRule.findUnique({ where: { id } });
      if (!current) throw notFound();
      const type = (fields.type ?? current.type) as RuleType;
      // A new type must come with a config of its shape; otherwise recheck the old one.
      const ruleConfig = parseRuleConfig(type, newConfig ?? current.config);
      const { count } = await tx.shippingRule.updateMany({
        where: { id, version },
        data: { ...fields, config: ruleConfig, version: { increment: 1 } },
      });
      if (count === 0) {
        throw new AppError(409, "VERSION_CONFLICT", "Someone else saved a change to this first. Reload to see it, then try again.");
      }
      await audit(tx, actor, "shipping_rule.update", id, { fields: Object.keys(dto).filter((k) => k !== "version") });
      return { rule: await tx.shippingRule.findUniqueOrThrow({ where: { id } }) };
    });
  }

  async deleteRule(actor: Actor, id: string) {
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.shippingRule.deleteMany({ where: { id } });
      if (count === 0) throw notFound();
      await audit(tx, actor, "shipping_rule.delete", id, {});
    });
  }

  private answer(pincode: string, s: Serviceability, checkedAt: Date): ServiceabilityAnswer {
    return {
      pincode,
      serviceable: s.serviceable,
      codAvailable: s.codAvailable,
      minDays: s.minDays,
      maxDays: s.maxDays,
      message: describe(pincode, s),
      checkedAt,
    };
  }
}

const notFound = () => new AppError(404, "NOT_FOUND", "We couldn't find that shipping rule.");

function audit(tx: Tx, actor: Actor, action: string, target: string, meta: Prisma.InputJsonValue) {
  return tx.auditLog.create({ data: { action, actorId: actor.id, target, meta } });
}
