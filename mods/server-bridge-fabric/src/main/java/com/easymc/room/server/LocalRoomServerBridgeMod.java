package com.easymc.room.server;

import net.fabricmc.api.DedicatedServerModInitializer;

public final class LocalRoomServerBridgeMod implements DedicatedServerModInitializer {
  public static final String MOD_ID = "easy_mc_room_server_bridge";

  @Override
  public void onInitializeServer() {
  }

  public static ServerBridgeDescriptor describeRuntime() {
    return new ServerBridgeDescriptor(
      MOD_ID,
      "relay.m4",
      "server_observed_uuid",
      false
    );
  }

  public record ServerBridgeDescriptor(
    String modId,
    String protocolVersion,
    String approvalSource,
    boolean claimedIdentityCanApprove
  ) {
  }
}
