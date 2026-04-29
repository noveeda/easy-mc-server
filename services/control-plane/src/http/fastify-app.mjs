import Fastify from "fastify";
import { createControlPlaneHttpBoundary } from "./handlers.mjs";

const ROUTES = Object.freeze([
  Object.freeze({ method: "POST", url: "/host/rooms" }),
  Object.freeze({ method: "POST", url: "/host/rooms/:roomId/invites" }),
  Object.freeze({ method: "POST", url: "/host/invites/:inviteHandle/revoke" }),
  Object.freeze({ method: "GET", url: "/friend/invites/:inviteHandle" }),
  Object.freeze({ method: "GET", url: "/friend/invites" }),
  Object.freeze({ method: "POST", url: "/friend/join-requests" }),
  Object.freeze({ method: "GET", url: "/host/rooms/:roomId/approval-queue" }),
  Object.freeze({ method: "POST", url: "/host/join-requests/:requestId/decision" }),
  Object.freeze({ method: "POST", url: "/service/sessions" })
]);

export function createControlPlaneFastifyApp(options = {}) {
  if (typeof options.deriveActor !== "function") {
    throw new TypeError("createControlPlaneFastifyApp requires a deriveActor(request) function");
  }

  const app = Fastify(options.fastifyOptions);
  const boundary = options.boundary ?? createControlPlaneHttpBoundary(options.boundaryOptions);

  for (const route of ROUTES) {
    app.route({
      method: route.method,
      url: route.url,
      handler: async (request, reply) => {
        const actor = await options.deriveActor(request);
        const response = await boundary.handle({
          method: request.method,
          path: pathFromRequest(request),
          headers: trustedActorHeaders(actor),
          body: request.body
        });

        for (const [key, value] of Object.entries(response.headers ?? {})) {
          reply.header(key, value);
        }

        return reply.code(response.status).send(response.body);
      }
    });
  }

  app.decorate("controlPlaneBoundary", boundary);
  app.decorate("controlPlaneRoutes", () => ROUTES.map((route) => ({ ...route })));

  return app;
}

function trustedActorHeaders(actor = {}) {
  const headers = {};
  const actorId = actor.actorId ?? actor.id;
  const actorType = actor.actorType ?? actor.type;

  if (actorId) {
    headers["x-actor-id"] = actorId;
  }

  if (actorType) {
    headers["x-actor-type"] = actorType;
  }

  return headers;
}

function pathFromRequest(request) {
  const rawPath = request?.url ?? request?.raw?.url ?? "/";

  try {
    return new URL(rawPath, "http://control-plane.local").pathname;
  } catch {
    return "/";
  }
}
