import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { CurrentUser, InternalOnly, Public, Roles } from "../lib/auth-guard/index.js";
import { AppError, type RequestUser } from "../lib/common/index.js";
import { CreateRuleDto, PINCODE, QuoteDto, ServiceabilityQuery, UpdateRuleDto } from "./dto.js";
import { ShippingService } from "./shipping.service.js";

const uuid = new ParseUUIDPipe();

@Public()
@Controller("shipping")
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  // Product and cart pages: GET /shipping/serviceability?pincode=520003
  @Get("serviceability")
  @Header("Cache-Control", "public, max-age=300")
  serviceability(@Query() query: ServiceabilityQuery) {
    return this.shipping.serviceability(query.pincode);
  }
}

// Cart and order services (§6.5, §6.7).
@InternalOnly()
@Controller("internal/shipping")
export class InternalShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post("quote")
  @HttpCode(200)
  quote(@Body() dto: QuoteDto) {
    return this.shipping.quote(dto);
  }
}

// Checked here as well as at the gateway (§10).
@Roles("admin")
@Controller("admin/shipping")
export class AdminShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get("rules")
  list() {
    return this.shipping.listRules();
  }

  @Post("rules")
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateRuleDto) {
    return this.shipping.createRule(user, dto);
  }

  @Get("rules/:id")
  get(@Param("id", uuid) id: string) {
    return this.shipping.getRule(id);
  }

  @Patch("rules/:id")
  update(@CurrentUser() user: RequestUser, @Param("id", uuid) id: string, @Body() dto: UpdateRuleDto) {
    return this.shipping.updateRule(user, id, dto);
  }

  @Delete("rules/:id")
  @HttpCode(204)
  async remove(@CurrentUser() user: RequestUser, @Param("id", uuid) id: string) {
    await this.shipping.deleteRule(user, id);
  }

  // Ask the courier again now, instead of waiting for the cached answer to age out.
  @Post("pincodes/:pincode/refresh")
  @HttpCode(200)
  refresh(@Param("pincode") pincode: string) {
    if (!PINCODE.test(pincode)) {
      throw new AppError(422, "VALIDATION_FAILED", "Please check the highlighted fields.", { pincode: "Enter a 6-digit PIN code." });
    }
    return this.shipping.serviceability(pincode, 1000, true);
  }
}
