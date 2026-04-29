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

export function createControlPlaneRouterAdapter(options = {}) {
  const boundary = options.boundary ?? createControlPlaneHttpBoundary(options.boundaryOptions);
  const deriveActor = options.deriveActor;

  async function inject(request = {}) {
    return boundary.handle({
      method: request.method,
      path: pathFrom(request),
      headers: request.headers,
      body: bodyFrom(request)
    });
  }

  function register(app) {
    if (!app || typeof app.route !== "function") {
      throw new TypeError("router adapter requires an app with a route() function");
    }

    if (typeof deriveActor !== "function") {
      throw new TypeError("router adapter register() requires deriveActor(request)");
    }

    for (const route of ROUTES) {
      app.route({
        method: route.method,
        url: route.url,
        handler: async (request, reply) => {
          const actor = await deriveActor(request);
          const response = await inject({
            method: request?.method ?? route.method,
            path: request?.url ?? request?.path ?? route.url,
            headers: trustedActorHeaders(actor),
            body: request?.body
          });

          return reply ? sendReply(reply, response) : response;
        }
      });
    }

    return app;
  }

  return {
    boundary,
    inject,
    register,
    routes() {
      return ROUTES.map((route) => ({ ...route }));
    }
  };
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

function pathFrom(request) {
  const rawPath = request.path ?? request.url ?? "/";

  try {
    return new URL(rawPath, "http://control-plane.local").pathname;
  } catch {
    return "/";
  }
}

function bodyFrom(request) {
  if (request.body !== undefined) {
    return request.body;
  }

  if (request.payload === undefined || request.payload === null || request.payload === "") {
    return undefined;
  }

  if (typeof request.payload !== "string") {
    return request.payload;
  }

  return JSON.parse(request.payload);
}

function sendReply(reply, response) {
  const statusTarget = typeof reply.code === "function" ? reply.code(response.status) ?? reply : reply;
  const headerTarget = Object.entries(response.headers ?? {}).reduce((target, [key, value]) => {
    if (typeof target.header === "function") {
      return target.header(key, value) ?? target;
    }

    return target;
  }, statusTarget);

  if (typeof headerTarget.send === "function") {
    return headerTarget.send(response.body);
  }

  return response;
}
