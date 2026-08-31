import { mkdir } from "node:fs/promises";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { Server } from "socket.io";
import { UPLOAD_DIR } from "./lib/storage.js";
import billsRoutes from "./routes/bills.js";
import joinRoutes from "./routes/join.js";
import { registerSocketHandlers } from "./sockets/index.js";

export async function buildServer() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cors, { origin: process.env.WEB_APP_URL ?? true });
  await fastify.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  await fastify.register(rateLimit, { global: false });

  await mkdir(UPLOAD_DIR, { recursive: true });
  await fastify.register(staticPlugin, { root: UPLOAD_DIR, prefix: "/uploads/" });

  await fastify.register(billsRoutes);
  await fastify.register(joinRoutes);

  fastify.get("/health", async () => ({ ok: true }));

  return fastify;
}

export function attachSocketIO(fastify) {
  const io = new Server(fastify.server, {
    cors: { origin: process.env.WEB_APP_URL ?? true },
  });
  registerSocketHandlers(io);
  return io;
}
