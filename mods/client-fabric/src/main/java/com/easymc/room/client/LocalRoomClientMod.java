package com.easymc.room.client;

import net.fabricmc.api.ClientModInitializer;

public final class LocalRoomClientMod implements ClientModInitializer {
  public static final String MOD_ID = "easy_mc_room_client";

  @Override
  public void onInitializeClient() {
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
