const crypto = require("crypto");
const User = require("../models/User");
const Transaction = require("../models/Transaction");
const {
  verifyHagoIdApi,
  getAgentWalletApi,
  getAgentHistoryApi,
  getAgentInfoByUid,
  verifySession,
  prepareRechargeMutation,
  prepareControlledRecharge,
  sendControlledRecharge,
  reconcileMutationReadOnly,
  getTransferReadiness,
} = require("../services/inchillService");

async function getAgent(phone, { includeSession = true } = {}) {
  const query = User.findOne({ phone });
  return includeSession
    ? query.select("+hagoSession.hagouid +hagoSession.uaasCookie")
    : query;
}
function requireString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function normalizeIdempotencyKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
}
function publicError(res, status, message, code) {
  return res
    .status(status)
    .json({ status: "ERROR", message, ...(code ? { code } : {}) });
}
function readOnlyErrorStatus(kind) {
  if (kind === "INVALID_REQUEST") return 400;
  if (kind === "NO_SESSION" || kind === "SESSION_UNAVAILABLE") return 409;
  if (kind === "TIMEOUT") return 504;
  return 502;
}
function mutationIntent({ agentPhone, targetId, amount, serviceType }) {
  return {
    agentPhone: agentPhone.trim(),
    targetId: targetId.trim(),
    amount: Number(amount),
    serviceType,
    nobilityType: null,
  };
}
function mutationIntentFingerprint(intent) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(intent), "utf8")
    .digest("hex");
}
function existingIntentMatches(existing, intent, fingerprint) {
  if (existing.intentFingerprint)
    return existing.intentFingerprint === fingerprint;
  return (
    existing.agentPhone === intent.agentPhone &&
    existing.targetId === intent.targetId &&
    existing.amount === intent.amount &&
    existing.serviceType === intent.serviceType &&
    existing.nobilityType === intent.nobilityType
  );
}
function publicTransaction(transaction) {
  return {
    id: transaction._id == null ? undefined : String(transaction._id),
    targetId: transaction.targetId,
    serviceType: transaction.serviceType,
    amount: transaction.amount,
    nobilityType: transaction.nobilityType,
    status: transaction.status,
    upstreamStatus: transaction.upstreamStatus,
    upstreamCode: transaction.upstreamCode ?? null,
    upstreamTimeout: Boolean(transaction.upstreamTimeout),
    referenceId: transaction.referenceId ?? null,
    sendAttemptedAt: transaction.sendAttemptedAt,
    createdAt: transaction.createdAt,
  };
}

function existingMutationResponse(res, transaction) {
  const publicIntent = publicTransaction(transaction);
  if (transaction.upstreamStatus === "NOT_SENT")
    return res.status(503).json({
      status: "ERROR",
      message: "Existing local mutation intent remains unsent.",
      code: "NOT_SENT",
      transaction: publicIntent,
    });
  if (transaction.upstreamStatus === "SEND_PENDING")
    return res.status(202).json({
      status: "PENDING",
      message: "A controlled mutation send is already pending.",
      code: "SEND_PENDING",
      transaction: publicIntent,
    });
  if (transaction.upstreamStatus === "SUCCESS")
    return res
      .status(200)
      .json({ status: "SUCCESS", transaction: publicIntent });
  if (transaction.upstreamStatus === "FAILED")
    return res.status(409).json({
      status: "ERROR",
      message: "The controlled mutation was rejected by Inchill.",
      code: "MUTATION_REJECTED",
      transaction: publicIntent,
    });
  return res.status(transaction.upstreamTimeout ? 504 : 502).json({
    status: "ERROR",
    message:
      "The controlled mutation outcome is unknown and will not be retried.",
    code: "MUTATION_OUTCOME_UNKNOWN",
    transaction: publicIntent,
  });
}

function preflightErrorStatus(kind) {
  if (kind === "INVALID_REQUEST" || kind === "DIAMOND_MIN_AMOUNT") return 400;
  if (
    kind === "NO_SESSION" ||
    kind === "SESSION_UNAVAILABLE" ||
    kind === "SESSION_REJECTED"
  )
    return 409;
  if (kind === "TIMEOUT") return 504;
  return 502;
}

function applyControlledOutcome(transaction, outcome) {
  transaction.upstreamCode = Number.isFinite(Number(outcome?.upstreamCode))
    ? Number(outcome.upstreamCode)
    : null;
  transaction.upstreamTimeout = Boolean(outcome?.timeout);
  transaction.referenceId = null;
  if (outcome?.attempted === false) {
    transaction.status = "UNKNOWN";
    transaction.upstreamStatus = "NOT_SENT";
    transaction.sendAttempts = 0;
    transaction.sendAttemptedAt = null;
    transaction.upstreamTimeout = false;
    transaction.errorMessage = "CONTROLLED_SENDER_BLOCKED";
    return { status: 503, bodyStatus: "ERROR", code: "BLOCKED" };
  }
  if (outcome?.outcome === "SUCCESS") {
    transaction.status = "SUCCESS";
    transaction.upstreamStatus = "SUCCESS";
    transaction.errorMessage = undefined;
    return { status: 200, bodyStatus: "SUCCESS" };
  }
  if (
    outcome?.outcome === "SESSION_PROBLEM" ||
    outcome?.outcome === "TRANSFER_LIMIT" ||
    outcome?.outcome === "REJECTED"
  ) {
    transaction.status = "FAILED";
    transaction.upstreamStatus = "FAILED";
    transaction.errorMessage = outcome.outcome;
    return { status: 409, bodyStatus: "ERROR", code: outcome.outcome };
  }
  transaction.status = "UNKNOWN";
  transaction.upstreamStatus = "UNKNOWN";
  transaction.errorMessage = "MUTATION_OUTCOME_UNKNOWN";
  return {
    status: outcome?.timeout ? 504 : 502,
    bodyStatus: "ERROR",
    code: "MUTATION_OUTCOME_UNKNOWN",
  };
}

exports.verifyUser = async (req, res) => {
  try {
    const { agentPhone, targetId } = req.body || {};
    if (!requireString(agentPhone) || !requireString(targetId))
      return publicError(res, 400, "agentPhone and targetId are required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await verifyHagoIdApi(targetId, agent);
    return result.ok
      ? res.json({ status: "SUCCESS", userInfo: result.user })
      : publicError(
          res,
          readOnlyErrorStatus(result.kind),
          result.message,
          result.kind,
        );
  } catch {
    return publicError(res, 500, "Unable to verify Hago ID.");
  }
};

exports.getBalance = async (req, res) => {
  try {
    const agentPhone = req.body?.agentPhone;
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await getAgentWalletApi(agent);
    return result.ok
      ? res.json({ status: "SUCCESS", wallet: result.wallet })
      : publicError(
          res,
          readOnlyErrorStatus(result.kind),
          result.message,
          result.kind,
        );
  } catch {
    return publicError(res, 500, "Unable to retrieve wallet.");
  }
};

exports.getAccountHistory = async (req, res) => {
  try {
    const { agentPhone, ...query } = req.body || {};
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await getAgentHistoryApi(agent, query);
    return result.ok
      ? res.json({ status: "SUCCESS", history: result.history })
      : publicError(
          res,
          readOnlyErrorStatus(result.kind),
          result.message,
          result.kind,
        );
  } catch {
    return publicError(res, 500, "Unable to retrieve account history.");
  }
};

exports.getAgentProfile = async (req, res) => {
  try {
    const agentPhone = req.body?.agentPhone;
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await getAgentInfoByUid(agent);
    // Safe compatibility repair: legacy records may have h_open_id in hagoUid.
    // Never use it for yMicro; backfill only after resolving the authenticated cookie UID.
    if (result.accountUid && result.accountUid !== agent.hagoUid) {
      const identityUpdate = { hagoUid: result.accountUid };
      if (!agent.hOpenId && agent.hagoUid)
        identityUpdate.hOpenId = agent.hagoUid;
      try {
        await User.updateOne({ _id: agent._id }, identityUpdate);
      } catch {
        /* profile response remains safe if a local backfill fails */
      }
    }
    return result.ok
      ? res.json({ status: "SUCCESS", agentProfile: result.user })
      : publicError(
          res,
          readOnlyErrorStatus(result.kind),
          result.message,
          result.kind,
        );
  } catch {
    return publicError(res, 500, "Unable to retrieve agent profile.");
  }
};

exports.validateSession = async (req, res) => {
  try {
    const agentPhone = req.body?.agentPhone;
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await verifySession(agent);
    await User.updateOne(
      { _id: agent._id },
      result.status === "VALID"
        ? { sessionStatus: "ACTIVE", lastValidatedAt: new Date() }
        : { sessionStatus: result.status },
    );
    return res.json({ status: "SUCCESS", session: { status: result.status } });
  } catch {
    return publicError(res, 500, "Unable to validate session.");
  }
};

exports.getTransferReadiness = async (req, res) => {
  try {
    const agentPhone = req.body?.agentPhone;
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await getTransferReadiness(agent);
    return result.ok
      ? res.json({ status: "SUCCESS", readiness: result.readiness })
      : publicError(
          res,
          readOnlyErrorStatus(result.kind),
          result.message,
          result.kind,
        );
  } catch {
    return publicError(res, 500, "Unable to retrieve transfer readiness.");
  }
};

exports.previewDiamondMutation = (req, res) => {
  try {
    const { agentPhone, targetId, amount } = req.body || {};
    if (
      !requireString(agentPhone) ||
      !requireString(targetId) ||
      !Number.isFinite(Number(amount)) ||
      Number(amount) <= 0
    ) {
      return publicError(
        res,
        400,
        "agentPhone, targetId, and a positive amount are required.",
      );
    }
    return res.json({
      status: "SUCCESS",
      preview: {
        amount: Number(amount),
        serviceType: "DIAMOND",
        note: "Diamond mutation previews are disabled in the V1-only Inchill deployment.",
      },
    });
  } catch {
    return publicError(
      res,
      400,
      "Unable to construct a local mutation preview.",
    );
  }
};

async function prepareMutation(req, res, serviceType) {
  try {
    const { agentPhone, targetId, amount } = req.body || {};
    const idempotencyKey = normalizeIdempotencyKey(req.get("Idempotency-Key"));
    if (
      !requireString(agentPhone) ||
      !requireString(targetId) ||
      !idempotencyKey
    )
      return publicError(
        res,
        400,
        "agentPhone, targetId, and a valid Idempotency-Key are required.",
      );
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0)
      return publicError(res, 400, "A positive amount is required.");
    const intent = mutationIntent({
      agentPhone,
      targetId,
      amount,
      serviceType,
    });
    const fingerprint = mutationIntentFingerprint(intent);
    const existing = await Transaction.findOne({ idempotencyKey });
    if (existing) {
      if (!existingIntentMatches(existing, intent, fingerprint))
        return publicError(
          res,
          409,
          "Idempotency-Key conflicts with an existing mutation intent.",
          "IDEMPOTENCY_CONFLICT",
        );
      return existingMutationResponse(res, existing);
    }
    const agent = await getAgent(agentPhone, { includeSession: false });
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const gate = await prepareRechargeMutation({
      controlledHeader: req.get("X-Controlled-Mutation"),
    });
    if (!gate.ok) {
      const transaction = await Transaction.create({
        ...intent,
        status: "UNKNOWN",
        upstreamStatus: "NOT_SENT",
        idempotencyKey,
        intentFingerprint: fingerprint,
        errorMessage: gate.message,
      });
      return res.status(503).json({
        status: "ERROR",
        message: gate.message,
        code: gate.kind,
        transaction: publicTransaction(transaction),
      });
    }
    if (Number(intent.amount) > gate.maxAmount)
      return publicError(
        res,
        400,
        "Amount exceeds the controlled mutation ceiling.",
        "MUTATION_AMOUNT_LIMIT",
      );
    const agentWithSession = await getAgent(agentPhone, {
      includeSession: true,
    });
    if (!agentWithSession)
      return publicError(res, 404, "Active agent session not found.");
    const prepared = await prepareControlledRecharge(agentWithSession, {
      targetId,
      amount: intent.amount,
      serviceType,
    });
    if (!prepared?.ok) {
      const transaction = await Transaction.create({
        ...intent,
        status: "UNKNOWN",
        upstreamStatus: "NOT_SENT",
        idempotencyKey,
        intentFingerprint: fingerprint,
        errorMessage: prepared?.kind || "PRECONDITION_FAILED",
      });
      return publicError(
        res,
        preflightErrorStatus(prepared?.kind),
        prepared?.message || "Unable to prepare controlled mutation.",
        prepared?.kind || "PRECONDITION_FAILED",
      );
    }
    let transaction;
    try {
      transaction = await Transaction.create({
        ...intent,
        status: "PENDING",
        upstreamStatus: "SEND_PENDING",
        idempotencyKey,
        intentFingerprint: fingerprint,
        sendAttempts: 1,
        sendAttemptedAt: new Date(),
        referenceId: null,
      });
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const concurrent = await Transaction.findOne({ idempotencyKey });
      if (!concurrent) throw error;
      if (!existingIntentMatches(concurrent, intent, fingerprint))
        return publicError(
          res,
          409,
          "Idempotency-Key conflicts with an existing mutation intent.",
          "IDEMPOTENCY_CONFLICT",
        );
      return existingMutationResponse(res, concurrent);
    }
    const outcome = await sendControlledRecharge(
      agentWithSession,
      prepared.request,
      { controlledHeader: req.get("X-Controlled-Mutation") },
    );
    const response = applyControlledOutcome(transaction, outcome);
    await transaction.save();
    if (response.bodyStatus === "SUCCESS")
      return res.status(response.status).json({
        status: "SUCCESS",
        transaction: publicTransaction(transaction),
      });
    return res.status(response.status).json({
      status: "ERROR",
      message:
        response.code === "MUTATION_OUTCOME_UNKNOWN"
          ? "The controlled mutation outcome is unknown and will not be retried."
          : response.code === "BLOCKED"
            ? "The controlled mutation sender is not active; no upstream request was sent."
            : "The controlled mutation was rejected by Inchill.",
      code: response.code,
      transaction: publicTransaction(transaction),
    });
  } catch (error) {
    if (error?.code === 11000)
      return publicError(res, 409, "Duplicate mutation request.");
    return publicError(res, 500, "Unable to prepare mutation.");
  }
}

exports.rechargeDiamond = (req, res) => prepareMutation(req, res, "DIAMOND");

exports.reconcileMutation = async (req, res) => {
  try {
    const { agentPhone, transactionId, ...historyQuery } = req.body || {};
    if (!requireString(agentPhone) || !requireString(transactionId))
      return publicError(
        res,
        400,
        "agentPhone and transactionId are required.",
      );
    const transaction = await Transaction.findOne({
      _id: transactionId,
      agentPhone,
    });
    if (!transaction)
      return publicError(res, 404, "Local mutation attempt not found.");
    if (
      transaction.status !== "UNKNOWN" ||
      transaction.upstreamStatus === "NOT_SENT"
    )
      return publicError(
        res,
        409,
        "Only an attempted unknown mutation can be reconciled.",
        "RECONCILIATION_NOT_APPLICABLE",
      );
    const agent = await getAgent(agentPhone);
    if (!agent) return publicError(res, 404, "Active agent session not found.");
    const result = await reconcileMutationReadOnly(agent, historyQuery);
    if (!result.ok)
      return publicError(
        res,
        readOnlyErrorStatus(result.kind),
        result.message,
        result.kind,
      );
    // No automatic status transition: transaction-reference correlation is not proven.
    return res.json({
      status: "SUCCESS",
      reconciliation: {
        outcome: "UNKNOWN",
        wallet: result.wallet,
        history: result.history,
      },
    });
  } catch {
    return publicError(res, 500, "Unable to reconcile local mutation attempt.");
  }
};

exports.getAgentTransactions = async (req, res) => {
  try {
    const agentPhone = req.body?.agentPhone;
    if (!requireString(agentPhone))
      return publicError(res, 400, "agentPhone is required.");
    const transactions = await Transaction.find({ agentPhone }).sort({
      createdAt: -1,
    });
    return res.json({
      status: "SUCCESS",
      count: transactions.length,
      transactions: transactions.map(publicTransaction),
    });
  } catch {
    return publicError(res, 500, "Unable to retrieve transactions.");
  }
};

module.exports._test = {
  mutationIntent,
  mutationIntentFingerprint,
  existingIntentMatches,
  publicTransaction,
  normalizeIdempotencyKey,
  readOnlyErrorStatus,
  existingMutationResponse,
  applyControlledOutcome,
  preflightErrorStatus,
};
