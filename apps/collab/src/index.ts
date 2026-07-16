import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { authenticateToken } from "./auth";
import { databaseExtension } from "./persistence";
import { handleInternalRequest } from "./internal-api";
import { auditExtension } from "./audit";

// Container hosts such as Render inject PORT. Keep COLLAB_PORT as the explicit
// service override used by local development and existing deployments.
const port = Number(process.env.COLLAB_PORT ?? process.env.PORT ?? 1234);

const server = new Server({
  port,
  extensions: [new Logger(), databaseExtension, auditExtension],

  async onAuthenticate({ token }) {
    const user = await authenticateToken(token);
    return { user };
  },

  async onRequest({ request, response, instance }) {
    if (await handleInternalRequest(request, response, instance)) throw null;
  },
});

await server.listen();
console.log(`hocuspocus listening on ws://localhost:${port}`);
