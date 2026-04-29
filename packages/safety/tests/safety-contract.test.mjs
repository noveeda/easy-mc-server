import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AuditEventTypes,
  InviteRecoveryStates,
  buildInviteRecoveryState,
  createAuditEvent,
  redactSupportBundle,
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
    inviteToken: "raw-invite-token",
    sessionKey: "session-key-value",
    ipAddress: "203.0.113.10",
    logs: [
      "friend opened https://room.example.test/invite/raw-token?token=abc123 from 198.51.100.23:4222",
      "Authorization: Bearer abc.def.ghi",
      "minecraft access token=msa-secret and password=hunter2"
    ],
    nested: {
      credential: "do-not-keep",
      message: "session key: local-room-secret"
    }
  });

  assert.equal(redacted.inviteToken, "[REDACTED]");
  assert.equal(redacted.sessionKey, "[REDACTED]");
  assert.equal(redacted.ipAddress, "[REDACTED]");
  assert.match(redacted.logs[0], /\[REDACTED_INVITE_URL\]/);
  assert.doesNotMatch(redacted.logs[0], /raw-token|198\.51\.100\.23/);
  assert.match(redacted.logs[1], /Bearer \[REDACTED_CREDENTIAL\]/);
  assert.doesNotMatch(redacted.logs[2], /msa-secret|hunter2/);
  assert.equal(redacted.nested.credential, "[REDACTED]");
  assert.doesNotMatch(redacted.nested.message, /local-room-secret/);
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
});
