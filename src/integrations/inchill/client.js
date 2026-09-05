const axios = require("axios");
const { createDeviceIdProvider } = require("./deviceId");

function createHagoHttpClient(http = axios, env = process.env) {
  const timeout = Number(
    env.INCHILL_REQUEST_TIMEOUT_MS || env.HAGO_REQUEST_TIMEOUT_MS || 15000,
  );
  return {
    get(url, options = {}) {
      return http.get(url, { timeout, ...options });
    },
    post(url, data, options = {}) {
      return http.post(url, data, { timeout, ...options });
    },
  };
}

function normalizeHttpError(error) {
  if (error?.code === "ECONNABORTED" || /timeout/i.test(error?.message || "")) {
    return {
      ok: false,
      status: error?.response?.status || 504,
      kind: "TIMEOUT",
      message: "The Inchill upstream request timed out.",
    };
  }
  if (error?.response) {
    return {
      ok: false,
      status: error.response.status,
      kind: "UPSTREAM_ERROR",
      message:
        error.response?.data?.message ||
        error.response?.data?.result_desc ||
        "The Inchill upstream returned an HTTP error.",
    };
  }
  return {
    ok: false,
    status: 502,
    kind: "NETWORK_ERROR",
    message: "Unable to reach the Inchill upstream.",
  };
}

function createInchillClient(env = process.env) {
  const { createUaasClient } = require("./uaas");
  const { createTurnoverClient } = require("./turnover");
  const { createTransferReadinessClient } = require("./transferReadiness");

  const http = createHagoHttpClient(axios, env);
  const deviceIdProvider = createDeviceIdProvider();
  const uaas = createUaasClient({ http, deviceIdProvider });
  const turnover = createTurnoverClient({ http });
  const readiness = createTransferReadinessClient({ http, uaas, turnover });

  return {
    sendOtp: uaas.sendOtp,
    verifyOtp: uaas.verifyOtp,
    probeSession: uaas.probeSession,
    getWallet: turnover.getWallet,
    getHistory: turnover.getHistory,
    getTransferReadiness: readiness.getTransferReadiness,
    async getProfile(session) {
      if (!session?.cookies || !session?.cookies?.hagouid) {
        return { ok: false, kind: "NO_SESSION", message: "An active Inchill session is required." };
      }
      return {
        ok: true,
        user: {
          accountUid: session.hagoUid || session.cookies.hagouid,
          country: session.country || env.INCHILL_COUNTRY || "US",
          language: session.language || env.INCHILL_LANGUAGE || "en",
        },
      };
    },
    async resolveAccountById(targetId, session) {
      if (!targetId) {
        return { ok: false, kind: "INVALID_TARGET", message: "A valid target account id is required." };
      }
      return {
        ok: true,
        user: {
          targetId,
          accountUid: String(targetId),
        },
      };
    },
  };
}

module.exports = { createHagoHttpClient, normalizeHttpError, createInchillClient };
