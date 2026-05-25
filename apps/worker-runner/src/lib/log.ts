import { pino } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'worker-runner' },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
    : undefined,
});
