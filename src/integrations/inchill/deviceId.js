function isTrustedDeviceId(value) {
  return (
    typeof value === "string" &&
    value.trim().length >= 8 &&
    value.trim().length <= 256
  );
}

// Browser source is CONFIRMED as FingerprintJS visitorId at localStorage["web-login:did"].
// Backend acquisition is UNKNOWN, so this provider only accepts a value supplied by a trusted caller.
function createDeviceIdProvider({
  resolve,
  fallback = process.env.INCHILL_DEVICE_ID,
} = {}) {
  return {
    async getDeviceId(context = {}) {
      const deviceId = resolve ? await resolve(context) : context.deviceId;
      if (isTrustedDeviceId(deviceId)) return deviceId.trim();
      return isTrustedDeviceId(fallback) ? fallback.trim() : null;
    },
  };
}

module.exports = { createDeviceIdProvider, isTrustedDeviceId };
