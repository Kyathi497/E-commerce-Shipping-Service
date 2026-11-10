import { describe, expect, it } from "vitest";
import { quote, type Rule } from "./rules.js";

const rule = (over: Partial<Rule> & Pick<Rule, "type" | "config">): Rule => ({ id: over.type, name: over.type, priority: 100, ...over });
const flat = rule({ type: "flat", config: { amountPaise: 7000 }, priority: 100 });
const freeOver = rule({ type: "free_over", config: { minSubtotalPaise: 99900 }, priority: 10 });
const zones = rule({
  type: "by_zone",
  priority: 50,
  config: { zones: [{ name: "Andhra Pradesh & Telangana", pincodePrefixes: ["50", "51", "52", "53"], amountPaise: 4000 }] },
});
const weight = rule({
  type: "by_weight",
  priority: 60,
  config: { slabs: [{ upToGrams: 500, amountPaise: 5000 }, { upToGrams: 2000, amountPaise: 9000 }], extraPerKgPaise: 3000 },
});

describe("shipping quote", () => {
  it("uses today's flat rate when that's the only rule", () => {
    expect(quote([flat], { subtotalPaise: 29900, weightGrams: 1200 }, 9999)).toEqual({
      shippingPaise: 7000,
      rule: { id: "flat", name: "flat" },
    });
  });

  it("tries rules in priority order and takes the first that matches", () => {
    const rules = [flat, freeOver, zones];
    expect(quote(rules, { subtotalPaise: 120000, weightGrams: 1000, pincode: "110001" }, 0).shippingPaise).toBe(0);
    expect(quote(rules, { subtotalPaise: 50000, weightGrams: 1000, pincode: "520003" }, 0).shippingPaise).toBe(4000);
    // Outside the zones, or PIN code not given yet: falls through to flat.
    expect(quote(rules, { subtotalPaise: 50000, weightGrams: 1000, pincode: "110001" }, 0).shippingPaise).toBe(7000);
    expect(quote(rules, { subtotalPaise: 50000, weightGrams: 1000 }, 0).shippingPaise).toBe(7000);
  });

  it("charges by weight slab, then per started kilogram", () => {
    const q = (weightGrams: number) => quote([weight], { subtotalPaise: 1, weightGrams }, 0).shippingPaise;
    expect(q(400)).toBe(5000);
    expect(q(500)).toBe(5000);
    expect(q(1800)).toBe(9000);
    expect(q(2001)).toBe(12000);
    expect(q(4500)).toBe(18000);
  });

  it("falls back when nothing matches, skipping broken rules", () => {
    const broken = rule({ type: "flat", config: { amountPaise: "lots" }, priority: 1 });
    expect(quote([broken, zones], { subtotalPaise: 1, weightGrams: 1 }, 7000)).toEqual({ shippingPaise: 7000, rule: null });
  });
});
