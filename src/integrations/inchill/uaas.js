const { createHagoHttpClient, normalizeHttpError } = require("./client");
const { isUaasSuccess } = require("./parsers");
const { buildCookieHeader, sessionFromAuthResponse } = require("./session");
const { createUaasSendCodeSigner } = require("./signers");
const { createDeviceIdProvider } = require("./deviceId");
const { buildSmsAuthParams, createSmsAuthTsProvider } = require("./smsAuth");
const { deriveBrowserSession } = require("./sessionDerivation");

const UAAS_BASE_URL = "https://i.inchillapp.com/uaas/h5";

function createUaasClient({
  http = createHagoHttpClient(),
  sendCodeSigner = createUaasSendCodeSigner(),
  deviceIdProvider = createDeviceIdProvider(),
  smsAuthTsProvider,
  now = Date.now,
} = {}) {
  const resolvedSmsAuthTsProvider =
    smsAuthTsProvider || createSmsAuthTsProvider({ deviceIdProvider });
  async function sendOtp(phone, countryCode) {
    let signed;

    try {
      signed = await sendCodeSigner.sign({
        phone,
        countryCode,
        timestamp: now(),
      });
    } catch (error) {
      return {
        ok: false,
        kind: "INVALID_REQUEST",
        message: "phone and countryCode are required for OTP delivery.",
      };
    }

    try {
      const response = await http.get(`${UAAS_BASE_URL}/sendCode`, {
        params: signed,
      });

      const data = response.data;

      console.log("[Inchill sendCode]", {
        status: response.status,
        resultCode: data?.result_code,
        resultDesc: data?.result_desc,
        response: data,
      });

      if (!isUaasSuccess(data)) {
        return {
          ok: false,
          kind: "BUSINESS_ERROR",
          message: data?.result_desc || "Inchill rejected the OTP request.",
          upstream: data,
        };
      }

      return {
        ok: true,
        kind: "OTP_SENT",
        message: "OTP sent successfully.",
        upstream: data,
      };
    } catch (error) {
      return {
        ok: false,
        ...normalizeHttpError(error),
      };
    }
  }
  async function verifyOtp(phone, otp, countryCode, deviceId) {
    const input = {
      phone,
      otp,
      smsCode: otp,
      countryCode: 20,
      deviceId,
      timestamp: now(),
    };

    const provided = await resolvedSmsAuthTsProvider(input);

    if (!provided?.ok) {
      console.error(
        "[Inchill smsAuth] Device/TS preparation failed:",
        provided,
      );

      return (
        provided || {
          ok: false,
          kind: "BLOCKED",
          message: "SMS auth parameters are unavailable.",
        }
      );
    }

    let params;

    try {
      params =
        provided.params ||
        buildSmsAuthParams({
          ...input,
          ...provided,
          deviceId: provided.deviceId || deviceId,
        });
    } catch (error) {
      console.error("[Inchill smsAuth] Invalid parameters:", error);

      return {
        ok: false,
        kind: "INVALID_REQUEST",
        message: "SMS auth parameters are invalid.",
      };
    }

    console.log("\n========== INCHILL SMS AUTH REQUEST ==========");
    console.log("Endpoint:", `${UAAS_BASE_URL}/smsAuth`);
    console.log("Params:", {
      ...params,
      sms_code: "***",
    });
    console.log("==============================================\n");

    try {
      const response = await http.get(`${UAAS_BASE_URL}/smsAuth`, {
        params,
      });

      const data = response.data;

      // اطبع الـ Network Response بالكامل
      console.log("\n========== INCHILL SMS AUTH RESPONSE ==========");
      console.log("HTTP Status:", response.status);
      console.log("Response Headers:", response.headers);
      console.log("Response Body:", JSON.stringify(data, null, 2));
      console.log("===============================================\n");

      // النجاح الحقيقي من Inchill
      if (!isUaasSuccess(data)) {
        console.error("[Inchill smsAuth] FAILED:", {
          result_code: data?.result_code,
          result_desc: data?.result_desc,
        });

        return {
          ok: false,
          kind: "BUSINESS_ERROR",
          message: data?.result_desc || "Inchill rejected the OTP.",
          upstream: data,
        };
      }

      console.log("[Inchill smsAuth] SUCCESS");
      console.log("result_code:", data?.result_code);
      console.log("result_desc:", data?.result_desc);
      console.log("h_open_id:", data?.h_open_id);
      console.log("session_id:", data?.session_id);
      console.log("activated:", data?.activated);
      console.log("result_type:", data?.result_type);
      console.log("host:", data?.host);

      const session = sessionFromAuthResponse(
        data,
        response.headers?.["set-cookie"],
        {
          deriveSession: () =>
            deriveBrowserSession(data, {
              smsCode: otp,
              timestamp: input.timestamp,
            }),
        },
      );

      console.log("\n========== DERIVED SESSION ==========");
      console.log("Session status:", session.status);
      console.log("Session source:", session.source);
      console.log("Hago UID:", session.hagoUid);
      console.log("H Open ID:", session.hOpenId);
      console.log("Has hagouid:", Boolean(session.cookies?.hagouid));
      console.log("Has uaasCookie:", Boolean(session.cookies?.uaasCookie));
      console.log("=====================================\n");

      if (session.status !== "ACTIVE") {
        console.error(
          "[Inchill smsAuth] OTP accepted but authenticated session was NOT established.",
        );

        return {
          ok: false,
          kind: "SESSION_ESTABLISHMENT_UNPROVEN",
          message:
            "Inchill accepted the OTP, but a complete authenticated session could not be established.",
          upstream: data,
          session,
        };
      }

      console.log("✅ [Inchill smsAuth] LOGIN SUCCESSFULLY ESTABLISHED");

      return {
        ok: true,
        kind: "OTP_VERIFIED",
        message: "OTP verified successfully.",
        upstream: data,
        session,
      };
    } catch (error) {
      console.error("[Inchill smsAuth] HTTP ERROR:", error);

      return {
        ok: false,
        ...normalizeHttpError(error),
      };
    }
  }
  async function probeSession(session) {
    const cookie = buildCookieHeader(session);
    if (!cookie) return { status: "REJECTED" };
    try {
      const response = await http.get(`${UAAS_BASE_URL}/getMobile`, {
        headers: { Cookie: cookie },
      });
      if (
        !response.data ||
        typeof response.data !== "object" ||
        Array.isArray(response.data)
      )
        return { status: "UNKNOWN" };
      return isUaasSuccess(response.data)
        ? { status: "VALID" }
        : { status: "REJECTED" };
    } catch (error) {
      const normalized = normalizeHttpError(error);
      return normalized.status === 401 || normalized.status === 403
        ? { status: "REJECTED" }
        : { status: "UNKNOWN" };
    }
  }

  return { sendOtp, verifyOtp, probeSession };
}

module.exports = { createUaasClient };
