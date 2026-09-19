import assert from "node:assert/strict";
import test from "node:test";
import {
  BRAND_LOGO_PATH,
  BRAND_LOGO_REVERSE_PATH,
  createBrandEmailHeader,
  ensureBrandEmailHeader,
  getBrandLogoPng,
  getBrandLogoReversePng,
  getBrandLogoReverseUrl,
  getBrandLogoUrl,
  ensureFlyerBranding,
} from "./brand";

test("brand helper serves the canonical light and reverse marks", () => {
  const dimensions = (bytes: Buffer): [number, number] => [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  assert.deepEqual(dimensions(getBrandLogoPng()), [844, 369]);
  assert.deepEqual(dimensions(getBrandLogoReversePng()), [844, 369]);
  assert.equal(getBrandLogoUrl("https://app.example.test"), `https://app.example.test${BRAND_LOGO_PATH}`);
  assert.equal(getBrandLogoReverseUrl("https://app.example.test"), `https://app.example.test${BRAND_LOGO_REVERSE_PATH}`);
});

test("email and flyer branding use the hosted light mark and non-legacy alt", () => {
  const url = getBrandLogoUrl("https://app.example.test");
  const email = createBrandEmailHeader(url);
  assert.match(email, new RegExp(`${BRAND_LOGO_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(email, /alt="My Business Solutions logo"/);
  assert.match(ensureBrandEmailHeader("__MBS_BRAND_EMAIL_HEADER__", "https://app.example.test"), /logo\.png/);
  assert.match(ensureFlyerBranding('<div class="logo"></div>', "https://app.example.test"), /My Business Solutions logo/);
});