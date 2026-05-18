import { Server } from '@hocuspocus/server';
import { Logger } from '@hocuspocus/extension-logger';

const port = Number(process.env.COLLAB_PORT ?? 1234);

const server = new Server({
  port,
  extensions: [new Logger()],

  async onAuthenticate({ token }) {
    if (process.env.NODE_ENV === 'production' && !token) {
      throw new Error('auth required');
    }
    return { user: { id: 'anon' } };
  },
});

await server.listen();
console.log(`hocuspocus listening on ws://localhost:${port}`);
