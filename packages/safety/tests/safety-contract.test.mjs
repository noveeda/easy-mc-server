import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AbuseControlDefaults,
  AuditEventTypes,
  InviteAccessibilityDefaults,
  InviteRecoveryStates,
  InviteDiscoveryPolicy,
  RetentionDefaults,
  UnofficialProductWording,
  buildAbuseControlAuditEvent,
  buildInviteRecoveryState,
  createAuditEvent,
  describeSupportBundleContract,
  evaluateClosedAlphaReleaseGate,
  getRetentionDefaults,
  redactSupportBundle,
  validateGeneratedPackPermissionGate,
  validateInviteAccessibilitySnapshot,
  validateModPermissionMetadata,
  validatePackPolicy
} from "../src/index.mjs";

test("invite recovery states stay button-focused and hide details when unavailable", () => {
  const states = [
    InviteRecoveryStates.EXPIRED,
    InviteRecoveryStates.REVOKED,
    InviteRecoveryStates.MISSING,
    InviteRecoveryStates.INVALID,
    InviteRecoveryStates.UNSUPPORTED_DEVICE,
    InviteRecoveryStates.MODRINTH_MISSING,
    InviteRecoveryStates.PACK_DOWNLOAD_FAILED,
    InviteRecoveryStates.IMPORT_FAILED,
    InviteRecoveryStates.HOST_OFFLINE,
    InviteRecoveryStates.APPROVAL_TIMEOUT
  ];

  for (const state of states) {
    const result = buildInviteRecoveryState(state, {
      roomAlias: "Private Room",
      minecraftVersion: "1.21.1",
      packProfileName: "Hidden Pack",
      trustCopy: "Hidden"
    });

    assert.equal(result.unavailable, true, state);
    assert.equal(result.showRoomDetails, false, state);
    assert.equal(Object.hasOwn(result, "roomAlias"), false, state);
    assert.match(result.primaryAction.label, /\S/);
    assert.match(result.primaryAction.action, /\S/);
  }
});

test("active invite recovery exposes only safe room metadata", () => {
  assert.deepEqual(
    buildInviteRecoveryState(InviteRecoveryStates.ACTIVE, {
      roomAlias: "Friday Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room",
      trustCopy: "Generated pack with the local room connection mod.",
      hostEmail: "host@example.com"
    }),
    {
      state: "active",
      unavailable: false,
      showRoomDetails: true,
      title: "Ready to join",
      body: "Open the pack and wait for the host to approve you.",
      primaryAction: { label: "Open pack", action: "open_pack" },
      secondaryAction: { label: "Copy invite", action: "copy_invite" },
      roomAlias: "Friday Room",
      minecraftVersion: "1.21.1",
      packProfileName: "MVP-0 Performance Room",
      trustCopy: "Generated pack with the local room connection mod."
    }
  );
});

test("support bundle redacts invite URLs, tokens, IPs, session keys, and credentials", () => {
  const redacted = redactSupportBundle({
    inviteLink: "https://join.easymc.gg/invite?invite=raw-public-handle",
    inviteToken: "raw-invite-token",
    sessionKey: "session-key-value",
    ipAddress: "203.0.113.10",
    logs: [
      "friend opened https://room.example.test/invite/raw-token?token=abc123 from 198.51.100.23:4222",
      "friend opened https://join.easymc.gg/invite?invite=raw-public-handle from 198.51.100.24:4222",
      "Authorization: Bearer abc.def.ghi",
      "minecraft access token=msa-secret and password=hunter2"
    ],
    nested: {
      credential: "do-not-keep",
      message: "session key: local-room-secret"
    }
  });

  assert.equal(redacted.inviteLink, "[REDACTED]");
  assert.equal(redacted.inviteToken, "[REDACTED]");
  assert.equal(redacted.sessionKey, "[REDACTED]");
  assert.equal(redacted.ipAddress, "[REDACTED]");
  assert.match(redacted.logs[0], /\[REDACTED_INVITE_URL\]/);
  assert.doesNotMatch(redacted.logs[0], /raw-token|198\.51\.100\.23/);
  assert.match(redacted.logs[1], /\[REDACTED_INVITE_URL\]/);
  assert.doesNotMatch(redacted.logs[1], /raw-public-handle|198\.51\.100\.24/);
  assert.match(redacted.logs[2], /Bearer \[REDACTED_CREDENTIAL\]/);
  assert.doesNotMatch(redacted.logs[3], /msa-secret|hunter2/);
  assert.equal(redacted.nested.credential, "[REDACTED]");
  assert.doesNotMatch(redacted.nested.message, /local-room-secret/);
});

test("support bundle contract explains safe content and redaction", () => {
  const contract = describeSupportBundleContract();

  assert.ok(contract.include.includes("inviteState"));
  assert.ok(contract.include.includes("redactedRelayMetrics"));
  assert.ok(contract.redact.includes("raw invite URLs"));
  assert.ok(contract.redact.includes("device signals"));
  assert.match(contract.explanation, /redact tokens, credentials, IPs, device signals, and raw invite URLs/);
});

test("support bundle redacts compressed and bracketed IPv6 addresses", () => {
  const redacted = redactSupportBundle({
    logs: [
      "friend from 2001:db8::1 joined",
      "loopback ::1 was used",
      "relay peer [2001:db8::2]:25565 disconnected",
      "mapped address ::ffff:192.0.2.128 failed"
    ]
  });

  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /2001:db8::1|::1|2001:db8::2|::ffff:192\.0\.2\.128/);
  assert.match(serialized, /\[REDACTED_IP\]/);
});

test("support bundle redacts common raw token key variants", () => {
  const redacted = redactSupportBundle({
    rawToken: "raw-token-value",
    authToken: "auth-token-value",
    inviteUrl: "https://room.example.test/invite/raw-token-value",
    sessionId: "session-id-value",
    safe: {
      roomId: "room-a"
    }
  });

  assert.equal(redacted.rawToken, "[REDACTED]");
  assert.equal(redacted.authToken, "[REDACTED]");
  assert.equal(redacted.inviteUrl, "[REDACTED]");
  assert.equal(redacted.sessionId, "[REDACTED]");
  assert.deepEqual(redacted.safe, { roomId: "room-a" });
  assert.doesNotMatch(JSON.stringify(redacted), /raw-token-value|auth-token-value|session-id-value/);
});

test("mod permission metadata gate passes complete original-url metadata", () => {
  const result = validateModPermissionMetadata({
    id: "fabric-api",
    sourceUrl: "https://modrinth.com/mod/fabric-api",
    license: { id: "Apache-2.0" },
    permission: {
      redistribution: "original_url_only",
      use: "allowed_by_license"
    },
    files: [
      {
        filename: "fabric-api.jar",
        downloads: ["https://cdn.modrinth.com/data/P7dR8mSH/fabric-api.jar"],
        hashes: {
          sha1: "65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84",
          sha512: "756b8c086f4c911d012f2eb70ca792aef0439503b31bc52026b82830870a94d472de30d61a6a0a9988c02b8462d9c47aa6baa6cd84da1eaf00edb77249b3c413"
        }
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.missing, []);
});

test("pack policy fails closed when source, license, permission, or hashes are missing", () => {
  const result = validatePackPolicy({
    mods: [
      {
        id: "incomplete",
        files: [
          {
            filename: "incomplete.jar",
            downloads: ["https://cdn.modrinth.com/data/example/incomplete.jar"],
            hashes: { sha1: "abc" }
          }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.failures[0].missing, ["source", "license", "permission", "files[0].hashes"]);
});

test("generated pack permission gate blocks app rehosting and redistribution rehost permission", () => {
  const result = validateGeneratedPackPermissionGate({
    mods: [
      {
        id: "rehosted",
        sourceUrl: "https://modrinth.com/mod/example",
        license: "MIT",
        permission: {
          redistribution: "rehost",
          use: "allowed_by_license"
        },
        files: [
          {
            filename: "example.jar",
            downloads: ["https://cdn.modrinth.com/data/example/example.jar"],
            rehostedByApp: true,
            hashes: {
              sha1: "65f4e8b9dcbad6697b2fb32fa0bb937ec5efcd84",
              sha512: "756b8c086f4c911d012f2eb70ca792aef0439503b31bc52026b82830870a94d472de30d61a6a0a9988c02b8462d9c47aa6baa6cd84da1eaf00edb77249b3c413"
            }
          }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.ok(result.failures[0].missing.includes("permission"));
  assert.ok(result.failures[0].missing.includes("files[0].rehosting"));
});

test("audit events require allowed types, required fields, and no sensitive payloads", () => {
  assert.deepEqual(
    createAuditEvent(
      AuditEventTypes.INVITE_CREATED,
      {
        roomId: "room-1",
        actorId: "host-1",
        inviteId: "invite-1"
      },
      { occurredAt: "2026-04-30T00:00:00.000Z" }
    ),
    {
      type: "invite_created",
      occurredAt: "2026-04-30T00:00:00.000Z",
      payload: {
        roomId: "room-1",
        actorId: "host-1",
        inviteId: "invite-1"
      }
    }
  );

  assert.throws(
    () =>
      createAuditEvent(AuditEventTypes.INVITE_CREATED, {
        roomId: "room-1",
        actorId: "host-1",
        inviteId: "invite-1",
        inviteToken: "raw-token"
      }),
    /sensitive fields/
  );

  assert.throws(
    () =>
      createAuditEvent(AuditEventTypes.INVITE_CREATED, {
        roomId: "room-1",
        actorId: "host-1",
        inviteId: "invite-1",
        metadata: {
          note: "Authorization: Bearer abc.def.ghi from 203.0.113.5 token=raw"
        }
      }),
    /sensitive fields/
  );

  assert.deepEqual(
    createAuditEvent(
      AuditEventTypes.RELAY_USAGE,
      {
        roomId: "room-1",
        sessionIdHash: "sha256:session",
        byteCount: 1024
      },
      { occurredAt: "2026-04-30T00:01:00.000Z" }
    ),
    {
      type: "relay_usage",
      occurredAt: "2026-04-30T00:01:00.000Z",
      payload: {
        roomId: "room-1",
        sessionIdHash: "sha256:session",
        byteCount: 1024
      }
    }
  );

  assert.throws(
    () =>
      createAuditEvent(AuditEventTypes.RELAY_USAGE, {
        roomId: "room-1",
        sessionId: "session-secret",
        byteCount: 1024
      }),
    /missing required fields/
  );
});

test("closed alpha defaults cover discovery, retention, unofficial wording, and abuse controls", () => {
  assert.deepEqual(InviteDiscoveryPolicy, {
    robots: "noindex,nofollow",
    publicDiscovery: false,
    exposeRoomDetailsForUnavailableStates: false
  });

  assert.equal(getRetentionDefaults().SESSION_CREDENTIAL_MAX_HOURS, 6);
  assert.equal(RetentionDefaults.AUDIT_EVENT_DAYS, 90);
  assert.match(UnofficialProductWording, /not an official Minecraft, Mojang, or Microsoft product/);
  assert.equal(AbuseControlDefaults.INVITE_REGENERATION_REVOKES_PREVIOUS_INVITE, true);
});

test("invite accessibility snapshot checks keyboard, mobile, and target-size contract", () => {
  const result = validateInviteAccessibilitySnapshot({
    hasViewportMeta: true,
    hasVisibleFocusStyle: true,
    mobileBreakpointPx: InviteAccessibilityDefaults.mobileMaxWidthPx,
    mobileActionsFullWidth: true,
    textWraps: true,
    actions: [
      {
        accessibleName: "친구 모드팩 받기",
        keyboardFocusable: true,
        minHeightPx: InviteAccessibilityDefaults.minInteractiveTargetPx
      }
    ]
  });

  assert.deepEqual(result, {
    ok: true,
    failures: [],
    checkedActions: 1
  });

  assert.deepEqual(
    validateInviteAccessibilitySnapshot({
      actions: [{ accessibleName: "", keyboardFocusable: false, minHeightPx: 32 }]
    }),
    {
      ok: false,
      failures: [
        "viewport_meta_missing",
        "visible_focus_style_missing",
        "mobile_actions_not_full_width",
        "text_overflow_risk",
        "action_accessible_name_missing",
        "action_keyboard_focus_missing",
        "action_target_too_small"
      ],
      checkedActions: 1
    }
  );
});

test("closed alpha release gate blocks public discovery and unredacted support data", () => {
  const passing = evaluateClosedAlphaReleaseGate({
    discovery: {
      robots: InviteDiscoveryPolicy.robots,
      xRobotsTag: InviteDiscoveryPolicy.robots,
      publicDiscovery: false,
      exposesUnavailableRoomDetails: false,
      sitemapExposesInvites: false,
      listingRoute: false,
      searchRoute: false
    },
    surfaces: {
      invitePage: { includesUnofficialProductWording: true },
      desktopApp: { includesUnofficialProductWording: true }
    },
    inviteAccessibility: {
      hasViewportMeta: true,
      hasVisibleFocusStyle: true,
      mobileBreakpointPx: 520,
      mobileActionsFullWidth: true,
      textWraps: true,
      actions: [{ accessibleName: "친구 모드팩 받기", keyboardFocusable: true, minHeightPx: 44 }]
    },
    supportBundleProbe: {
      bundle: {
        rawToken: "raw-alpha-token",
        authToken: "auth-alpha-token",
        inviteUrl: "https://room.example.test/invite/raw-alpha-token",
        logs: ["friend from 203.0.113.10 used token=raw-alpha-token"]
      },
      forbiddenStrings: ["raw-alpha-token", "auth-alpha-token", "203.0.113.10"]
    }
  });

  assert.equal(passing.ok, true);
  assert.deepEqual(passing.failures, []);

  const failing = evaluateClosedAlphaReleaseGate({
    discovery: {
      robots: "index,follow",
      publicDiscovery: true,
      exposesUnavailableRoomDetails: true,
      sitemapExposesInvites: true
    },
    surfaces: {
      invitePage: { includesUnofficialProductWording: false },
      desktopApp: { includesUnofficialProductWording: false }
    }
  });

  assert.equal(failing.ok, false);
  assert.ok(failing.failures.includes("invite_robots_missing"));
  assert.ok(failing.failures.includes("invite_x_robots_tag_missing"));
  assert.ok(failing.failures.includes("public_discovery_enabled"));
  assert.ok(failing.failures.includes("invite_discovery_route_exposed"));
  assert.ok(failing.failures.includes("support_bundle_probe_missing"));
});

test("abuse control audit helpers create minimal non-sensitive events", () => {
  assert.deepEqual(
    buildAbuseControlAuditEvent(
      AuditEventTypes.USER_BLOCKED,
      {
        roomId: "room-1",
        actorId: "host-1",
        minecraftUuid: "uuid-1",
        reason: "abuse_report"
      },
      { occurredAt: "2026-04-30T00:04:00.000Z" }
    ),
    {
      type: "user_blocked",
      occurredAt: "2026-04-30T00:04:00.000Z",
      payload: {
        roomId: "room-1",
        actorId: "host-1",
        minecraftUuid: "uuid-1",
        reason: "abuse_report"
      }
    }
  );

  assert.deepEqual(
    buildAbuseControlAuditEvent(
      AuditEventTypes.JOIN_RATE_LIMITED,
      {
        roomId: "room-1",
        inviteId: "invite-1",
        limitKey: "invite_hash",
        reason: "too_many_join_requests"
      },
      { occurredAt: "2026-04-30T00:05:00.000Z" }
    ),
    {
      type: "join_rate_limited",
      occurredAt: "2026-04-30T00:05:00.000Z",
      payload: {
        roomId: "room-1",
        inviteId: "invite-1",
        limitKey: "invite_hash",
        reason: "too_many_join_requests"
      }
    }
  );

  assert.throws(
    () =>
      buildAbuseControlAuditEvent(AuditEventTypes.USER_BLOCKED, {
        roomId: "room-1",
        actorId: "host-1",
        minecraftUuid: "uuid-1",
        reason: "abuse_report",
        ipAddress: "203.0.113.7"
      }),
    /sensitive fields/
  );
});
