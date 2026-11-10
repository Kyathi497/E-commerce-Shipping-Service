import { describe, expect, it } from "vitest";
import { MockProvider } from "./provider.js";
import { TokenCipher } from "./shiprocket.js";

describe("mock provider", () => {
  const mock = new MockProvider({ pickupPincode: "520003", unserviceable: ["999999"], noCod: ["110001"] });

  it("estimates by distance from the pickup PIN code", async () => {
    expect(await mock.serviceability("520010")).toMatchObject({ serviceable: true, minDays: 2, maxDays: 3 });
    expect(await mock.serviceability("500001")).toMatchObject({ minDays: 3, maxDays: 5 });
    expect(await mock.serviceability("400001")).toMatchObject({ minDays: 4, maxDays: 7, codAvailable: true });
  });

  it("honours the configured gaps", async () => {
    expect(await mock.serviceability("999999")).toMatchObject({ serviceable: false });
    expect(await mock.serviceability("110001")).toMatchObject({ serviceable: true, codAvailable: false });
  });
});

describe("token cipher", () => {
  it("round-trips and detects tampering", () => {
    const cipher = new TokenCipher(undefined, "some-long-service-secret-for-tests-only");
    const sealed = cipher.encrypt("eyJ-token");
    expect(sealed).not.toContain("eyJ-token");
    expect(cipher.decrypt(sealed)).toBe("eyJ-token");
    const [iv, tag, data] = sealed.split(".");
    const tampered = Buffer.from(data!, "base64url");
    tampered[0]! ^= 1;
    expect(() => cipher.decrypt([iv, tag, tampered.toString("base64url")].join("."))).toThrow();
  });
});
