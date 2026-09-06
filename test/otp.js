const assert = require("node:assert/strict");
const { createUaasClient } = require("../src/integrations/inchill/uaas");
const { createDeviceIdProvider } = require("../src/integrations/inchill/deviceId");
const { generateSmsAuthTs } = require("../src/integrations/inchill/smsAuth");

const timestamp = 1700000000000;
const requests = [];
const http = {
  async get(url, options) {
    requests.push({ url, ...options });
    if (url.endsWith("/sendCode")) return { data: { result_code: "00000" } };
    if (url.endsWith("/smsAuth"))
      return {
        data: { result_code: "00000" },
        headers: { "set-cookie": ["hagouid=123", "uaasCookie=session"] },
      };
    throw new Error(`Unexpected URL: ${url}`);
  },
};

(async () => {
  const client = createUaasClient({
    http,
    baseUrl: "https://uaas.example/uaas/h5",
    now: () => timestamp,
    sendCodeSigner: { sign: (input) => ({ signed: true, ...input }) },
    smsAuthTsProvider: async (input) => ({
      ok: true,
      ts: generateSmsAuthTs(input),
      deviceId: "backend-device-id",
    }),
  });
  assert.deepEqual(await client.sendOtp("201001234567", "20"), { ok: true });
  assert.equal(requests[0].url, "https://uaas.example/uaas/h5/sendCode");
  assert.deepEqual(requests[0].params, {
    signed: true,
    phone: "201001234567",
    countryCode: "20",
    timestamp,
  });

  const verified = await client.verifyOtp("201001234567", "123456", "20");
  assert.equal(verified.ok, true);
  assert.equal(verified.session.cookies.hagouid, "123");
  assert.deepEqual(requests[1].params, {
    ts: generateSmsAuthTs({ smsCode: "123456", timestamp }),
    mobile: "201001234567",
    country_code: "20",
    device_id: "backend-device-id",
    dev_type: "31",
    sms_code: "123456",
    timestamp: String(timestamp),
    app: "inchillx",
    appId: "inchillx",
  });

  const provider = createDeviceIdProvider({ fallback: "stable-device-id" });
  assert.equal(await provider.getDeviceId({}), "stable-device-id");

  const expiredClient = createUaasClient({
    http: { get: async () => ({ data: { result_code: "20101", result_desc: "Verification code has expired" } }) },
    now: () => timestamp,
    smsAuthTsProvider: async () => ({ ok: true, ts: "valid-ts", deviceId: "backend-device-id" }),
  });
  const expired = await expiredClient.verifyOtp("201001234567", "123456", "20");
  assert.equal(expired.kind, "OTP_EXPIRED");
  console.log("OTP request contract valid");
})().catch((error) => {
  console.error(error.stack || String(error));
  process.exitCode = 1;
});
