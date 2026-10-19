import pino from 'pino';
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['token', 'apiKey', 'authorization', 'password', 'req.headers.authorization'],
});
