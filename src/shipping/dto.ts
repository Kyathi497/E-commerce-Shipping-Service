import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, Min } from "class-validator";

const trim = () => Transform(({ value }) => (typeof value === "string" ? value.trim() : value));
export const PINCODE = /^[1-9]\d{5}$/;
const PINCODE_MESSAGE = "Enter a 6-digit PIN code.";
const RULE_TYPES = ["flat", "free_over", "by_zone", "by_weight"] as const;

export class ServiceabilityQuery {
  @trim() @Matches(PINCODE, { message: PINCODE_MESSAGE }) pincode: string;
}

export class QuoteDto {
  @IsOptional() @Matches(PINCODE, { message: PINCODE_MESSAGE }) pincode?: string;
  // Items after discounts.
  @IsInt() @Min(0) @Max(100_000_000) subtotalPaise: number;
  // Contents only; packaging is added here.
  @IsInt() @Min(0) @Max(1_000_000) weightGrams: number;
  // Jars and boxes in the parcel, for the packaging weight.
  @IsInt() @Min(0) @Max(1000) units: number;
}

export class CreateRuleDto {
  @trim() @IsString() @Length(2, 120) name: string;
  @IsIn(RULE_TYPES) type: (typeof RULE_TYPES)[number];
  // Shape depends on the type; see src/shipping/rules.ts.
  @IsObject() config: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class UpdateRuleDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @trim() @IsString() @Length(2, 120) name?: string;
  // Changing the type needs a config of the new shape too.
  @IsOptional() @IsIn(RULE_TYPES) type?: (typeof RULE_TYPES)[number];
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) priority?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
