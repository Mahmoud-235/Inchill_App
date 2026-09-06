const { decryptStoredSession } = require("../integrations/inchill/session");
const { createInchillIntegration } = require("../integrations/inchill");

const inchill = createInchillIntegration();

function getSession(user) {
  const cookies = decryptStoredSession(
    user?.hagoSession || user?.sessionData || {},
  );
  return {
    hagoUid: cookies.hagouid || user?.hagoUid || user?.accountId,
    cookies,
    country: user?.hagoCountry || process.env.INCHILL_COUNTRY || "US",
    language: user?.hagoLanguage || process.env.INCHILL_LANGUAGE || "en",
  };
}

function resolveSession(user) {
  try {
    const session = getSession(user);
    return session.hagoUid
      ? { ok: true, session }
      : {
          ok: false,
          kind: "SESSION_UNAVAILABLE",
          message: "An active Inchill session is required.",
        };
  } catch {
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };
  }
}

async function sendOtpApi(phone, countryCode) {
  const result = await inchill.uaas.sendOtp(phone, countryCode);
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };
  return {
    ok: true,
    message: "OTP request accepted by the Inchill upstream.",
    data: result,
  };
}

async function verifySmsAuthApi(phone, otp, countryCode, deviceId) {
  return inchill.uaas.verifyOtp(phone, otp, countryCode, deviceId);
}

async function verifySession(user) {
  const resolved = resolveSession(user);
  if (!resolved.ok) return { status: "UNKNOWN" };
  const result = await inchill.uaas.probeSession(resolved.session);
  if (!result.ok) return { status: "UNKNOWN" };
  return { status: result.status || "VALID" };
}

async function verifyHagoIdApi(targetId, user) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message:
        "The target account could not be resolved without an active session.",
    };

  const result = await inchill.account.resolveAccountById(
    targetId,
    resolved.session,
  );
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };

  return {
    ok: true,
    user: result.user || {
      targetId,
      accountUid: resolved.session.hagoUid || targetId,
    },
  };
}

async function getAgentWalletApi(user) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };

  const result = await inchill.turnover.getWallet(resolved.session);
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };
  return {
    ok: true,
    wallet: result.wallet || result.data || { balance: 0, currency: "DIAMOND" },
  };
}

async function getAgentHistoryApi(user, query) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };

  const result = await inchill.turnover.getHistory(resolved.session, query);
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };
  return { ok: true, history: result.history || result.data || [] };
}

async function getAgentInfoByUid(user) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };

  const result = await inchill.account.getProfile(resolved.session);
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };

  return {
    ok: true,
    accountUid: resolved.session.hagoUid,
    user: result.user || {
      accountUid: resolved.session.hagoUid,
      phone: user?.phone || "unknown",
    },
  };
}

function getMutationGate({ controlledHeader, env = process.env } = {}) {
  const mutationsEnabled = env.INCHILL_MUTATIONS_ENABLED === "true";
  const controlledMutationMode =
    env.INCHILL_CONTROLLED_MUTATION_MODE === "true";
  if (!mutationsEnabled) {
    return {
      ok: false,
      kind: "DISABLED",
      message:
        "Inchill mutations are disabled by configuration; no upstream request was sent.",
    };
  }
  if (!controlledMutationMode || controlledHeader !== "true") {
    return {
      ok: false,
      kind: "BLOCKED",
      message:
        "Inchill controlled mutation mode is not active; no upstream request was sent.",
    };
  }
  const maxAmount = Number(env.INCHILL_CONTROLLED_MUTATION_MAX_AMOUNT || 0);
  if (!Number.isFinite(maxAmount) || maxAmount <= 0) {
    return {
      ok: false,
      kind: "BLOCKED",
      message:
        "Inchill controlled mutation configuration is invalid; no upstream request was sent.",
    };
  }
  return { ok: true, maxAmount };
}

async function prepareRechargeMutation(options) {
  return getMutationGate(options);
}

async function prepareControlledRecharge(user, input) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };
  return inchill.financial.prepareTransfer(resolved.session, input);
}

async function sendControlledRecharge(user, request, guard) {
  const resolved = resolveSession(user);
  if (!resolved.ok) return { attempted: false, outcome: "SESSION_PROBLEM" };
  return inchill.financial.sendPreparedTransfer(
    resolved.session,
    request,
    guard,
  );
}

async function reconcileMutationReadOnly(user, historyQuery) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };
  const result = await inchill.financial.reconcileReadOnly(
    resolved.session,
    historyQuery,
  );
  return { ok: true, ...result };
}

async function getTransferReadiness(user) {
  const resolved = resolveSession(user);
  if (!resolved.ok)
    return {
      ok: false,
      kind: "SESSION_UNAVAILABLE",
      message: "An active Inchill session is required.",
    };

  const result = await inchill.readiness.getTransferReadiness(resolved.session);
  if (!result.ok)
    return {
      ok: false,
      kind: result.kind || "UPSTREAM_ERROR",
      message: result.message,
    };

  return {
    ok: true,
    readiness: result.readiness ||
      result.data || {
        status: "READY",
        currency: "DIAMOND",
        transferCurrency: "DIAMOND",
        walletAvailable: true,
      },
  };
}

module.exports = {
  sendOtpApi,
  verifySmsAuthApi,
  verifySession,
  verifyHagoIdApi,
  getAgentWalletApi,
  getAgentHistoryApi,
  getAgentInfoByUid,
  prepareRechargeMutation,
  prepareControlledRecharge,
  sendControlledRecharge,
  reconcileMutationReadOnly,
  getTransferReadiness,
};
