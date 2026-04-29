package com.easymc.room.client;

public final class LocalRoomClientMod {
  public static final String MOD_ID = "easy_mc_room_client";

  private LocalRoomClientMod() {
  }

  public static ClientRuntimeDescriptor describeRuntime() {
    return new ClientRuntimeDescriptor(
      MOD_ID,
      "relay.m4",
      "127.0.0.1",
      25565
    );
  }

  public record ClientRuntimeDescriptor(
    String modId,
    String protocolVersion,
    String localHost,
    int minecraftRelayTargetPort
  ) {
  }
}
