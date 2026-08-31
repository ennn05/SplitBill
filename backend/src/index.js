import "dotenv/config";
import { buildServer, attachSocketIO } from "./server.js";

const fastify = await buildServer();
attachSocketIO(fastify);

const port = Number(process.env.PORT) || 4000;
await fastify.listen({ port, host: "0.0.0.0" });
