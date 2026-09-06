const { createUaasClient } = require("./uaas");
const { createYmicroClient } = require("./ymicro");
const { createTurnoverClient } = require("./turnover");
const { createDeviceIdProvider } = require("./deviceId");
const { createInchillClient } = require("./client");
const { createFinancialMutationClient } = require("./financial");
const { createTransferReadinessClient } = require("./transferReadiness");
const { createNobilityReadOnlyClient } = require("./nobilityClient");
const { createNobilityMutationClient } = require("./nobilityMutation");
const {
  createNobilityPurchaseReadinessClient,
} = require("./nobilityPurchaseReadiness");

function createInchillIntegration(dependencies = {}) {
  const deviceIdProvider = createDeviceIdProvider(
    dependencies.deviceIdProvider,
  );
  const ymicro = createYmicroClient(dependencies.ymicro);
  const turnover = createTurnoverClient(dependencies.turnover);
  const uaas = createUaasClient({ ...dependencies.uaas, deviceIdProvider });
  const nobility = createNobilityReadOnlyClient({
    http: dependencies.nobility?.http || createInchillClient(),
    ...dependencies.nobility,
  });
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
    nobility,
    nobilityPurchaseReadiness: createNobilityPurchaseReadinessClient({
      uaas,
      ymicro,
      nobility,
      turnover,
    }),
    nobilityMutation: createNobilityMutationClient({
      http: dependencies.nobilityMutation?.http || createInchillClient(),
      uaas,
      ymicro,
      nobility,
      turnover,
      ...dependencies.nobilityMutation,
    }),
    deviceIdProvider,
  };
}

module.exports = { createInchillIntegration };
