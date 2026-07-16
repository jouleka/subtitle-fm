import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { authenticateToken } from "./auth";
import { databaseExtension } from "./persistence";
import { handleInternalRequest } from "./internal-api";
import { auditExtension } from "./audit";

const port = Number(process.env.COLLAB_PORT ?? 1234);

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
