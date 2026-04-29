# Control Plane

M2 starts with an in-memory domain simulation instead of a Fastify/PostgreSQL service. This keeps the first implementation focused on room, invite, approval, permission, TTL, and privacy contracts.

Fastify routes and PostgreSQL persistence are intentionally deferred until these contracts are stable.

The `src/http/` boundary exposes HTTP-shaped handler functions over the simulation without opening sockets or adding runtime dependencies. It fixes API request/response DTOs for host room and invite creation, friend invite lookup and join requests, host approval, and service session issuance while keeping raw invite tokens, session ids, and host internals out of responses.
