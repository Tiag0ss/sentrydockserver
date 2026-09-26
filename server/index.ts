import express from 'express';
import next from 'next';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { buildAllTables } from './utils/schemaBuilder';
import { seedDatabase } from './services/seed';
import { apiRouter } from './routes';
import { errorHandler } from './middleware/errorHandler';
import { agentGateway } from './services/agentGateway';
import { scheduleUpdateEngine } from './services/updateEngine';
import { resumeInterruptedRuns } from './services/flowEngine';
import { uiBus } from './services/uiBus';
import logger from './utils/logger';

dotenv.config();

const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const grpcPort = Number(process.env.GRPC_PORT || 50051);

async function main() {
  buildAllTables();
  await seedDatabase();

  const nextApp = next({ dev, dir: process.cwd() });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  app.use('/api', apiRouter);
  app.use(errorHandler);

  app.use((req, res) => handle(req, res));

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
  });

  agentGateway.attachSocketIO(io);

  io.of('/ui').use((_socket, nextFn) => {
    nextFn();
  });

  uiBus.on('notification', (n) => {
    io.of('/ui').emit('notification:new', n);
  });

  uiBus.on('runs', () => {
    io.of('/ui').emit('runs:changed', { ts: Date.now() });
  });

  setInterval(() => {
    io.of('/ui').emit('dashboard:ping', { ts: Date.now() });
  }, 5000);

  agentGateway.startGrpcServer(grpcPort);
  scheduleUpdateEngine();
  await resumeInterruptedRuns();

  server.listen(port, () => {
    logger.info(`SentryDock server listening on :${port} (gRPC :${grpcPort})`);
    logger.info('Default login (first boot): admin / admin — change password after sign-in');
  });
}

main().catch((err) => {
  logger.error('Fatal', { err });
  process.exit(1);
});
