import { z } from "zod";
import { AppError } from "../lib/common/index.js";

const paise = z.number().int().min(0).max(10_000_000);

// What each kind of shipping rule holds (§6.9).
export const RULE_CONFIGS = {
  // Always matches: { amountPaise: 7000 } is today's flat ₹70.
  flat: z.object({ amountPaise: paise }),
  // Free shipping once the items (after discounts) reach this amount.
  free_over: z.object({ minSubtotalPaise: paise }),
  // A charge per area, by PIN code prefix ("52" = most of Andhra Pradesh).
  // Matches only when the PIN code is known and in one of the zones.
  by_zone: z.object({
    zones: z
      .array(
        z.object({
          name: z.string().min(1).max(60),
          pincodePrefixes: z.array(z.string().regex(/^[1-9]\d{0,5}$/, "Use 1–6 digits of a PIN code.")).min(1).max(200),
          amountPaise: paise,
        }),
      )
      .min(1)
      .max(50),
  }),
  // A charge by parcel weight: the first slab the parcel fits in, and past
  // the last slab, extraPerKgPaise for each started kilogram.
  by_weight: z.object({
    slabs: z
      .array(z.object({ upToGrams: z.number().int().min(1).max(100_000), amountPaise: paise }))
      .min(1)
      .max(20)
      .refine((s) => s.every((x, i) => i === 0 || x.upToGrams > s[i - 1]!.upToGrams), "List slabs from lightest to heaviest."),
    extraPerKgPaise: paise.optional(),
  }),
} as const;

export type RuleType = keyof typeof RULE_CONFIGS;
export type RuleConfig<T extends RuleType = RuleType> = z.infer<(typeof RULE_CONFIGS)[T]>;

export interface Rule {
  id: string;
  name: string;
  type: RuleType;
  config: unknown;
  priority: number;
}

export interface QuoteInput {
  pincode?: string;
  // Items after discounts, in paise.
  subtotalPaise: number;
  // Parcel weight including packaging.
  weightGrams: number;
}

export function parseRuleConfig(type: RuleType, value: unknown) {
  const result = RULE_CONFIGS[type].safeParse(value);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  const path = ["config", ...issue.path].join(".");
  throw new AppError(422, "VALIDATION_FAILED", "Please check the highlighted fields.", { [path]: issue.message });
}

// The charge from one rule, or null when it doesn't apply to this parcel.
export function ruleAmount(type: RuleType, config: unknown, q: QuoteInput): number | null {
  switch (type) {
    case "flat":
      return (config as RuleConfig<"flat">).amountPaise;
    case "free_over":
      return q.subtotalPaise >= (config as RuleConfig<"free_over">).minSubtotalPaise ? 0 : null;
    case "by_zone": {
      if (!q.pincode) return null;
      const zone = (config as RuleConfig<"by_zone">).zones.find((z) => z.pincodePrefixes.some((p) => q.pincode!.startsWith(p)));
      return zone ? zone.amountPaise : null;
    }
    case "by_weight": {
      const { slabs, extraPerKgPaise } = config as RuleConfig<"by_weight">;
      const slab = slabs.find((s) => q.weightGrams <= s.upToGrams);
      if (slab) return slab.amountPaise;
      const last = slabs[slabs.length - 1]!;
      return last.amountPaise + Math.ceil((q.weightGrams - last.upToGrams) / 1000) * (extraPerKgPaise ?? 0);
    }
  }
}

// The first matching rule, lowest priority number first. Rules whose stored
// config no longer parses are skipped.
export function quote(rules: Rule[], q: QuoteInput, fallbackPaise: number) {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const parsed = RULE_CONFIGS[rule.type].safeParse(rule.config);
    if (!parsed.success) continue;
    const amount = ruleAmount(rule.type, parsed.data, q);
    if (amount !== null) return { shippingPaise: amount, rule: { id: rule.id, name: rule.name } };
  }
  return { shippingPaise: fallbackPaise, rule: null };
}
