# Control Plane

M2 starts with an in-memory domain simulation instead of a Fastify/PostgreSQL service. This keeps the first implementation focused on room, invite, approval, permission, TTL, and privacy contracts.

Fastify routes and PostgreSQL persistence are intentionally deferred until these contracts are stable.
