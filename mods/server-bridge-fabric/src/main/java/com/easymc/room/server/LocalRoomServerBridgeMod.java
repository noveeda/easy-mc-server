package com.easymc.room.server;

public final class LocalRoomServerBridgeMod {
  public static final String MOD_ID = "easy_mc_room_server_bridge";

  private LocalRoomServerBridgeMod() {
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
