# API Reference

This project exposes the V1-only Inchill backend contract.

## Base contract

- Base path: `/api`
- Auth: `x-internal-api-key` (server-to-server only)
- Public health endpoints: `/health`, `/ready`
- V2 and tenant-scoped routes are disabled with `410` and `V1_ONLY_API`

## Supported endpoints

- `GET /health`
- `GET /ready`
- `POST /api/auth/send-otp`
- `POST /api/auth/verify-otp`
- `POST /api/bot/session/validate`
- `POST /api/bot/verify-id`
- `POST /api/bot/wallet-balance`
- `POST /api/bot/account-history`
- `POST /api/bot/agent-profile`
- `POST /api/bot/transfer-readiness`

The application only routes the V1 surface and intentionally omits Crystal, Nobility, and V2 multi-tenant flows.
