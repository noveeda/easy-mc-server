# Control Plane

M2 starts from executable room, invite, approval, permission, TTL, and privacy contracts, then exposes those contracts through alpha-ready HTTP and persistence adapters.

The `src/http/` boundary exposes HTTP-shaped handler functions over the simulation without opening sockets. It fixes API request/response DTOs for host room and invite creation, friend invite lookup and join requests, host approval, and service session issuance while keeping raw invite tokens, session ids, and host internals out of responses.

`src/http/router-adapter.mjs` is still a dependency-free contract/test adapter. Do not mount it as a production route surface with client-supplied `x-actor-id` or `x-actor-type` headers.

`src/http/fastify-app.mjs` is the real Fastify entry point. It requires `createControlPlaneFastifyApp({ deriveActor })`, where `deriveActor(request)` must come from trusted middleware or service authentication. Client-supplied actor headers are ignored before the request reaches the boundary.

`src/persistence/postgres/schema.sql` is the empty-alpha database bootstrap. It creates rooms, invites, approval requests, sessions, presence, rate-limit counters, and audit events with expiry indexes. Invite tokens and session credentials are stored only as hashes.

`src/persistence/postgres/repository.mjs` is a PostgreSQL repository contract over an injected `pg` pool. It uses parameterized SQL, transactional writes, atomic rate-limit upserts, explicit expired-state cleanup, fail-closed reads for missing/expired/revoked state, and the same sensitive-value hashing policy as the memory store.

`src/persistence/postgres/migrations/0001-alpha-state-constraints.sql` retrofits early alpha databases with the composite relationship constraints, hashed audit session identifiers, and cleanup-safe indexes that `schema.sql` gives to new databases.

The current PostgreSQL work is still a repository/schema contract. A running alpha database, deployment configuration, and production authentication middleware are separate integration steps.
