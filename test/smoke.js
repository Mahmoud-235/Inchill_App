const createApp = require("../src/app");

(async () => {
  const env = {
    NODE_ENV: "development",
    PORT: "4000",
    HOST: "127.0.0.1",
    MONGO_URI: "mongodb://127.0.0.1:27017/inchill-bot",
    INTERNAL_API_KEY: "test-internal-api-key",
    INCHILL_SESSION_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
    INCHILL_REQUEST_TIMEOUT_MS: "15000",
    INCHILL_LANGUAGE: "en",
    INCHILL_MUTATIONS_ENABLED: "false",
    INCHILL_CONTROLLED_MUTATION_MODE: "false",
    SWAGGER_ENABLED: "false",
  };

  const app = createApp({ env });
  const server = app.listen(0, async () => {
    try {
      const port = server.address().port;
      const health = await fetch(`http://127.0.0.1:${port}/health`);
      if (health.status !== 200) throw new Error(`health expected 200, got ${health.status}`);
      const v2 = await fetch(`http://127.0.0.1:${port}/api/v2/test`);
      const v2Body = await v2.json();
      if (v2.status !== 410 || v2Body.code !== "V1_ONLY_API") {
        throw new Error(`v2 expected 410 V1_ONLY_API, got ${v2.status} ${JSON.stringify(v2Body)}`);
      }
      console.log("smoke ok");
    } catch (error) {
      console.error(error.stack || String(error));
      process.exitCode = 1;
    } finally {
      server.close();
    }
  });
})();
