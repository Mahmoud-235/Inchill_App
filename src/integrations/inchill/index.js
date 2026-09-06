const { createUaasClient } = require("./uaas");
const { createYmicroClient } = require("./ymicro");
const { createTurnoverClient } = require("./turnover");
const { createDeviceIdProvider } = require("./deviceId");
const { createInchillClient } = require("./client");
const { createFinancialMutationClient } = require("./financial");
const { createTransferReadinessClient } = require("./transferReadiness");

function createInchillIntegration(dependencies = {}) {
  const deviceIdProvider = createDeviceIdProvider(
    dependencies.deviceIdProvider,
  );
  const ymicro = createYmicroClient(dependencies.ymicro);
  const turnover = createTurnoverClient(dependencies.turnover);
  const uaas = createUaasClient({ ...dependencies.uaas, deviceIdProvider });
  return {
    uaas,
    ymicro,
    turnover,
    financial: createFinancialMutationClient({
      http: dependencies.financial?.http || createInchillClient(),
      ymicro,
      turnover,
      ...dependencies.financial,
    }),
    readiness: createTransferReadinessClient({
      http: dependencies.readiness?.http || createInchillClient(),
      uaas,
      turnover,
      ...dependencies.readiness,
    }),
    deviceIdProvider,
  };
}

module.exports = { createInchillIntegration };
