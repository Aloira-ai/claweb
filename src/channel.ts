import { readFile } from "node:fs/promises";
import type { ChannelPlugin, OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  waitUntilAbort,
} from "openclaw/plugin-sdk";
import { z } from "zod";
import { buildInboundCtx } from "./inbound/build-ctx.js";
import { createWsDeliver } from "./outbound/deliver.js";
import { startWsServer } from "./server/ws-server.js";

type ClawebAccount = {
  accountId: string;
  enabled: boolean;
  listenHost: string;
  listenPort: number;
  authToken?: string;
  authTokenFile?: string;
  defaultAgentId?: string;
};

type ClawebConfigRoot = {
  enabled?: boolean;
  listenHost?: string;
  listenPort?: number;
  authToken?: string;
  authTokenFile?: string;
  defaultAgentId?: string;
  accounts?: Record<string, Partial<ClawebAccount>>;
};

const CHANNEL_ID = "claweb";

function readClawebConfigRoot(cfg: OpenClawConfig): ClawebConfigRoot {
  return ((cfg as Record<string, unknown>).channels as Record<string, unknown> | undefined)
    ?.claweb as ClawebConfigRoot;
}

function listClawebAccountIds(cfg: OpenClawConfig): string[] {
  const root = readClawebConfigRoot(cfg);
  const ids = Object.keys(root?.accounts ?? {});
  return ids.length > 0 ? ids : [DEFAULT_ACCOUNT_ID];
}

function resolveClawebAccount(cfg: OpenClawConfig, accountId?: string | null): ClawebAccount {
  const root = readClawebConfigRoot(cfg);
  const resolvedAccountId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const accountPatch = root?.accounts?.[resolvedAccountId] ?? {};

  return {
    accountId: resolvedAccountId,
    enabled: accountPatch.enabled ?? root?.enabled ?? false,
    listenHost: accountPatch.listenHost ?? root?.listenHost ?? "127.0.0.1",
    listenPort: Number(accountPatch.listenPort ?? root?.listenPort ?? 18999),
    authToken: accountPatch.authToken ?? root?.authToken,
    authTokenFile: accountPatch.authTokenFile ?? root?.authTokenFile,
    defaultAgentId: accountPatch.defaultAgentId ?? root?.defaultAgentId,
  };
}

async function resolveAuthToken(account: ClawebAccount): Promise<string> {
  if (account.authToken?.trim()) {
    return account.authToken.trim();
  }
  if (account.authTokenFile?.trim()) {
    const raw = await readFile(account.authTokenFile.trim(), "utf8");
    return raw.trim();
  }
  return "";
}

export function clawebPlugin(runtime: PluginRuntime): ChannelPlugin<ClawebAccount> {
  return {
    id: CHANNEL_ID,
    meta: {
      id: CHANNEL_ID,
      label: "CLAWeb",
      selectionLabel: "CLAWeb (WebSocket)",
      docsPath: "/channels/claweb",
      docsLabel: "claweb",
      blurb: "WebSocket bridge that routes browser text messages through OpenClaw channel pipeline.",
      order: 200,
      aliases: ["web", "ws"],
    },
    capabilities: {
      chatTypes: ["direct", "group"],
      blockStreaming: true,
    },
    reload: { configPrefixes: ["channels.claweb"] },
    configSchema: buildChannelConfigSchema(z.object({}).passthrough()),
    config: {
      listAccountIds: (cfg) => listClawebAccountIds(cfg),
      resolveAccount: (cfg, accountId) => resolveClawebAccount(cfg, accountId),
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      isConfigured: (account) => Boolean(account.authToken?.trim() || account.authTokenFile?.trim()),
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: Boolean(account.authToken?.trim() || account.authTokenFile?.trim()),
        baseUrl: `ws://${account.listenHost}:${account.listenPort}`,
      }),
    },
    gateway: {
      startAccount: async (ctx) => {
        const account = resolveClawebAccount(ctx.cfg, ctx.accountId);

        if (!account.enabled) {
          ctx.log?.info?.(`[claweb] account ${account.accountId} disabled, skip startup`);
          return waitUntilAbort(ctx.abortSignal);
        }

        const authToken = await resolveAuthToken(account);
        if (!authToken) {
          ctx.log?.warn?.(`[claweb] account ${account.accountId} missing authToken/authTokenFile`);
          return waitUntilAbort(ctx.abortSignal);
        }

        const core = ctx.channelRuntime ?? runtime.channel;
        const ws = await startWsServer({
          host: account.listenHost,
          port: account.listenPort,
          authToken,
          serverVersion: runtime.version,
          onMessage: async ({ ws, userId, roomId, messageId, text, timestamp }) => {
            const cfg = await runtime.config.loadConfig();
            const chatType = roomId ? "group" : "direct";
            const route = core.routing.resolveAgentRoute({
              cfg,
              channel: CHANNEL_ID,
              accountId: account.accountId,
              peer: {
                kind: chatType,
                id: roomId ?? userId,
              },
            });

            const inboundCtx = buildInboundCtx({
              runtime,
              channel: CHANNEL_ID,
              accountId: account.accountId,
              sessionKey: route.sessionKey,
              userId,
              roomId,
              text,
              messageId,
              timestamp,
            });

            const storePath = core.session.resolveStorePath(
              (cfg.session as Record<string, unknown> | undefined)?.store as string | undefined,
              { agentId: route.agentId },
            );

            await core.session.recordInboundSession({
              storePath,
              sessionKey: route.sessionKey,
              ctx: inboundCtx,
              onRecordError: (error) => {
                ctx.log?.warn?.(`[claweb] recordInboundSession failed: ${String(error)}`);
              },
            });

            await core.reply.dispatchReplyWithBufferedBlockDispatcher({
              ctx: inboundCtx,
              cfg,
              dispatcherOptions: {
                deliver: createWsDeliver(ws, messageId),
              },
            });
          },
        });

        ctx.log?.info?.(
          `[claweb] ws server started on ws://${account.listenHost}:${account.listenPort} (account=${account.accountId})`,
        );

        await waitUntilAbort(ctx.abortSignal);
        await ws.close();
        ctx.log?.info?.(`[claweb] ws server stopped (account=${account.accountId})`);
      },
    },
  };
}
