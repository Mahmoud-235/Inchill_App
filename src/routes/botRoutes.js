const express = require("express");
const router = express.Router();
const botController = require("../controllers/botController");

// Endpoints للعمليات العامة ومعلومات الحساب والوكيل
router.post("/verify-id", botController.verifyUser);
router.post("/wallet-balance", botController.getBalance);
router.post("/account-history", botController.getAccountHistory);
router.post("/session/validate", botController.validateSession);
router.post("/transfer-readiness", botController.getTransferReadiness);
router.post("/agent-profile", botController.getAgentProfile);
router.post("/transactions", botController.getAgentTransactions);

// Endpoints الخاصة بعمليات الشحن والمعاملات (Recharge & Mutations)
router.post("/recharge/preview", botController.previewDiamondMutation);
router.post("/recharge/diamond", botController.rechargeDiamond);
router.post("/recharge/reconcile", botController.reconcileMutation);

module.exports = router;
