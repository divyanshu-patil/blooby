import { z } from 'zod';

export const copilotChatDto = z.object({
  model: z.string().min(1),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
  /** The caller's own keys. Honoured only when the admin has allowed user keys — the
   *  service re-checks; this only shapes them. */
  keys: z.array(z.string().min(1)).max(10).optional(),
  format: z.unknown().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
  stream: z.literal(false).optional(),
});
export type CopilotChatDto = z.infer<typeof copilotChatDto>;

export const copilotSettingsDto = z.object({ allowUserKeys: z.boolean() });
export type CopilotSettingsDto = z.infer<typeof copilotSettingsDto>;

export const createCopilotKeyDto = z.object({
  key: z.string().trim().min(8, 'That does not look like an API key'),
  label: z.string().trim().max(60).default(''),
});
export type CreateCopilotKeyDto = z.infer<typeof createCopilotKeyDto>;
