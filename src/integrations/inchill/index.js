const { createInchillClient } = require("./client");
const { isTrustedDeviceId } = require("./deviceId");

function createInchillIntegration(env = process.env) {
  const client = createInchillClient(env);

  return {
    uaas: {
      async sendOtp(phone, countryCode) {
        const result = await client.sendOtp(phone, countryCode);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
      async verifyOtp(phone, otp, countryCode, deviceId) {
        if (!isTrustedDeviceId(deviceId)) {
          return { ok: false, kind: "MISSING_DEVICE_ID", message: "A valid Inchill deviceId is required." };
        }
        const result = await client.verifyOtp(phone, otp, countryCode, deviceId);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data, session: result.session, cookies: result.cookies, status: result.status, hagoUid: result.hagoUid };
      },
      async probeSession(session) {
        const result = await client.probeSession(session);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
    },
    turnover: {
      async getWallet(session) {
        const result = await client.getWallet(session);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
      async getHistory(session, query) {
        const result = await client.getHistory(session, query);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
    },
    readiness: {
      async getTransferReadiness(session) {
        const result = await client.getTransferReadiness(session);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
    },
    account: {
      async getProfile(session) {
        const result = await client.getProfile(session);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
      async resolveAccountById(targetId, session) {
        const result = await client.resolveAccountById(targetId, session);
        if (!result.ok) return { ok: false, kind: result.kind || "UPSTREAM_ERROR", message: result.message };
        return { ok: true, ...result.data };
      },
    },
    deviceIdProvider: {
      async getDeviceId(context = {}) {
        const value = context.deviceId || context?.body?.deviceId || null;
        return isTrustedDeviceId(value) ? String(value).trim() : null;
      },
    },
  };
}

module.exports = { createInchillIntegration };
