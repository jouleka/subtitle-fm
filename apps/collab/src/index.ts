import { Server } from "@hocuspocus/server";
import { Logger } from "@hocuspocus/extension-logger";
import { authenticateToken } from "./auth";
import { databaseExtension } from "./persistence";

const port = Number(process.env.COLLAB_PORT ?? 1234);

const server = new Server({
  port,
  extensions: [new Logger(), databaseExtension],

  async onAuthenticate({ token }) {
    const user = await authenticateToken(token);
    return { user };
  },
});

await server.listen();
console.log(`hocuspocus listening on ws://localhost:${port}`);
