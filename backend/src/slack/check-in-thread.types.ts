export type CreateRunThreadResult =
  | { ok: true; channelId: string; threadTs: string }
  | { ok: false; reason: string };
