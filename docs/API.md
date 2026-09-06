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
- `POST /api/bot/transactions`
- `POST /api/bot/recharge/preview`
- `POST /api/bot/recharge/diamond`
- `POST /api/bot/recharge/reconcile`

Diamond recharge is the only supported mutation flow.

## OTP flow

`POST /api/auth/send-otp` accepts `phone` and `countryCode`. The matching
`POST /api/auth/verify-otp` accepts `phone` and `otp`; it uses the country
code from the active OTP request. When `INCHILL_DEVICE_ID` is configured, the
backend supplies the stable device identifier and Postman clients do not send
`deviceId`. A trusted caller may still supply `deviceId` when that deployment
does not configure a backend fallback.
