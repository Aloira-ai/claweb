import type { PluginRuntime } from "openclaw/plugin-sdk";

type BuildInboundCtxInput = {
  runtime: PluginRuntime;
  channel: string;
  accountId: string;
  sessionKey: string;
  userId: string;
  roomId?: string;
  text: string;
  mediaUrl?: string;
  mediaType?: string;
  messageId: string;
  timestamp: number;
};

export function buildInboundCtx(input: BuildInboundCtxInput) {
  const chatType = input.roomId ? "group" : "direct";
  const peerLabel = input.roomId ? `room:${input.roomId}` : `user:${input.userId}`;

  return input.runtime.channel.reply.finalizeInboundContext({
    Body: input.text,
    RawBody: input.text,
    CommandBody: input.text,
    MediaUrl: input.mediaUrl,
    MediaType: input.mediaType,
    From: `claweb:${input.userId}`,
    To: input.roomId ? `claweb:room:${input.roomId}` : `claweb:${input.userId}`,
    SessionKey: input.sessionKey,
    AccountId: input.accountId,
    ChatType: chatType,
    ConversationLabel: peerLabel,
    SenderId: input.userId,
    SenderName: input.userId,
    Provider: input.channel,
    Surface: input.channel,
    MessageSid: input.messageId,
    Timestamp: input.timestamp,
    OriginatingChannel: input.channel,
    OriginatingTo: input.roomId ? `claweb:room:${input.roomId}` : `claweb:${input.userId}`,
  });
}
