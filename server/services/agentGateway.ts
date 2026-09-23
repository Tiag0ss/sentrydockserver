import { EventEmitter } from 'events';
import { v4 as uuid } from 'uuid';
import { Server as SocketIOServer, Socket } from 'socket.io';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { agentsRepo } from '../repositories/agentsRepo';
import { hashToken } from './crypto';
import { audit } from './audit';
import logger from '../utils/logger';
import { MIN_PROTOCOL_VERSION, type Envelope } from '../../protocol/types';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
};

export type ConnectedAgent = {
  id: string;
  name: string;
  transport: 'ws' | 'grpc';
  send: (env: Envelope) => void;
};

class AgentGateway extends EventEmitter {
  private byId = new Map<string, ConnectedAgent>();
  private pending = new Map<string, Pending>();
  private maxParallel = Number(process.env.MAX_PARALLEL_COMMANDS || 20);
  private inFlight = 0;
  private queue: Array<() => void> = [];

  private authenticateAgent(token: string, agentName?: string) {
    if (!token) return null;
    const row = agentsRepo.findByTokenHash(hashToken(token));
    if (!row) return null;
    // Optional name check: if provided and differs, still accept token (source of truth)
    if (agentName && agentName !== row.name) {
      logger.warn('agent name mismatch; authenticating by token', {
        expected: row.name,
        got: agentName,
        agentId: row.id,
      });
    }
    return row;
  }

  attachSocketIO(io: SocketIOServer) {
    const nsp = io.of('/agents');
    nsp.use(async (socket, next) => {
      try {
        const token = String(socket.handshake.auth?.token || '');
        const agentName = String(socket.handshake.auth?.agentName || '');
        const row = this.authenticateAgent(token, agentName || undefined);
        if (!row) return next(new Error('unauthorized'));
        (socket.data as { agentId: string }).agentId = row.id;
        next();
      } catch (e) {
        next(e as Error);
      }
    });

    nsp.on('connection', (socket: Socket) => {
      const agentId = (socket.data as { agentId: string }).agentId;
      this.registerWs(agentId, socket);
    });
  }

  private registerWs(agentId: string, socket: Socket) {
    const row = agentsRepo.findById(agentId);
    if (!row) {
      socket.disconnect(true);
      return;
    }

    const send = (env: Envelope) => {
      socket.emit('command', env);
    };

    const connected: ConnectedAgent = {
      id: agentId,
      name: row.name,
      transport: 'ws',
      send,
    };
    this.byId.set(agentId, connected);

    socket.on('event', (env: Envelope) => this.onAgentEvent(agentId, env));
    socket.on('disconnect', () => {
      // Ignore stale disconnects after a newer session replaced this one
      if (this.byId.get(agentId) !== connected) return;
      this.byId.delete(agentId);
      agentsRepo.update(agentId, { status: 'offline' });
      this.emit('agentOffline', agentId);
      audit({ actor: `agent:${row.name}`, action: 'agent.offline', entity: 'agent', entityId: agentId });
    });
  }

  onAgentEvent(agentId: string, env: Envelope) {
    const row = agentsRepo.findById(agentId);
    if (!row) return;

    if (env.type === 'hello') {
      const p = env.payload as {
        protocolVersion?: number;
        agentVersion?: string;
        hostname?: string;
        transport?: string;
      };
      const pv = Number(p.protocolVersion || 0);
      const status = pv < MIN_PROTOCOL_VERSION ? 'incompatible' : 'online';
      agentsRepo.update(agentId, {
          status,
          protocolVersion: pv,
          agentVersion: p.agentVersion || null,
          hostname: p.hostname || null,
          transport: (p.transport as 'ws' | 'grpc') || row.transport,
          lastSeenAt: new Date(),
        });
      audit({
        actor: `agent:${row.name}`,
        action: status === 'online' ? 'agent.online' : 'agent.incompatible',
        entity: 'agent',
        entityId: agentId,
        payload: p,
      });
      this.emit('agentOnline', agentId);
      return;
    }

    if (env.type === 'heartbeat') {
      agentsRepo.update(agentId, { lastSeenAt: new Date(), status: row.status === 'incompatible' ? 'incompatible' : 'online' });
      return;
    }

    if (env.type === 'command.result') {
      const payload = env.payload as { requestId: string; ok: boolean; data?: unknown; error?: string };
      const pending = this.pending.get(payload.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(payload.requestId);
        this.releaseSlot();
        if (payload.ok) pending.resolve(payload.data);
        else pending.reject(new Error(payload.error || 'command failed'));
      }
      return;
    }

    if (env.type === 'inventory') {
      agentsRepo.update(agentId, { metaJson: JSON.stringify(env.payload), lastSeenAt: new Date() });
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.inFlight < this.maxParallel) {
      this.inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(() => {
      this.inFlight += 1;
      resolve();
    }));
  }

  private releaseSlot() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async sendCommand(agentId: string, type: string, payload: unknown, timeoutMs = 120_000): Promise<unknown> {
    const agent = this.byId.get(agentId);
    if (!agent) {
      const row = agentsRepo.findById(agentId);
      const label = row?.name || agentId.slice(0, 8);
      throw new Error(`Agent "${label}" offline`);
    }
    const row = agentsRepo.findById(agentId);
    if (row?.status === 'incompatible') throw new Error(`Agent "${row.name}" protocol incompatible`);

    await this.acquireSlot();
    const requestId = uuid();
    const env: Envelope = { requestId, type, payload };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        this.releaseSlot();
        reject(new Error(`Command timeout: ${type}`));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try {
        agent.send(env);
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        this.releaseSlot();
        reject(e as Error);
      }
    });
  }

  isOnline(agentId: string) {
    return this.byId.has(agentId);
  }

  listOnline() {
    return [...this.byId.values()];
  }

  /** Register a gRPC bi-di stream as a connected agent. */
  registerGrpc(agentId: string, write: (env: Envelope) => void) {
    const row = agentsRepo.findById(agentId);
    if (!row) return () => undefined;
    const connected: ConnectedAgent = {
      id: agentId,
      name: row.name,
      transport: 'grpc',
      send: write,
    };
    this.byId.set(agentId, connected);
    return () => {
      if (this.byId.get(agentId) !== connected) return;
      this.byId.delete(agentId);
      agentsRepo.update(agentId, { status: 'offline' });
      this.emit('agentOffline', agentId);
    };
  }

  startGrpcServer(port: number) {
    const protoPath = path.join(process.cwd(), 'protocol', 'agent.proto');
    const def = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(def) as grpc.GrpcObject;
    const agentPkg = proto.sentrydock as grpc.GrpcObject;
    const agentV1 = agentPkg.agent as grpc.GrpcObject;
    const v1 = agentV1.v1 as grpc.GrpcObject;
    const AgentService = v1.AgentService as grpc.ServiceClientConstructor;

    const server = new grpc.Server();
    const impl: grpc.UntypedServiceImplementation = {
      Connect: (call: grpc.ServerDuplexStream<
        { request_id: string; type: string; payload_json: string },
        { request_id: string; type: string; payload_json: string }
      >) => {
        const meta = call.metadata;
        const auth = meta.get('authorization')[0]?.toString() || '';
        const token = auth.replace(/^Bearer\s+/i, '');
        const agentName = meta.get('agent-name')[0]?.toString() || '';
        const row = this.authenticateAgent(token, agentName || undefined);
        if (!row) {
          logger.warn('gRPC agent unauthorized', { agentName: agentName || '(none)' });
          call.emit('error', {
            code: grpc.status.UNAUTHENTICATED,
            message: 'unauthorized',
          });
          return;
        }
        logger.info('gRPC agent connected', { agentId: row.id, name: row.name });
        const write = (env: Envelope) => {
          call.write({
            request_id: env.requestId,
            type: env.type,
            payload_json: JSON.stringify(env.payload ?? {}),
          });
        };
        const unregister = this.registerGrpc(row.id, write);
        call.on('data', (msg) => {
          this.onAgentEvent(row.id, {
            requestId: msg.request_id,
            type: msg.type,
            payload: JSON.parse(msg.payload_json || '{}'),
          });
        });
        call.on('end', () => {
          unregister();
          call.end();
        });
        call.on('error', () => unregister());
      },
    };

    server.addService(AgentService.service, impl);
    server.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) {
        logger.error('gRPC bind failed', { err });
        return;
      }
      logger.info(`gRPC agent gateway on :${port}`);
    });
    return server;
  }
}

export const agentGateway = new AgentGateway();
