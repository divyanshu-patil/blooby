import { env } from '../config/env.js';
import { copilotRepository } from '../repositories/copilot.repository.js';
import { HttpError } from '../utils/httpError.js';
import type { CopilotChatDto, CreateCopilotKeyDto } from '../dtos/copilot/index.js';

/**
 * Why this proxy exists: ollama.com serves no CORS headers, so a browser can never call
 * it directly with a key. Server-to-server has no such limit, which is where "n keys,
 * immediate failover" finally means real cloud access with real keys.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Enough of a key to tell two apart in a list, never enough to use. */
const hintOf = (k: string) => (k.length <= 8 ? '••••' : `${k.slice(0, 4)}…${k.slice(-4)}`);

type Attempt = { id: string | null; secret: string };

export const copilotService = {
  /**
   * What a signed-in user is allowed to know about the server's copilot setup: whether
   * they may bring their own keys, and whether the server has any of its own. Both are
   * booleans on purpose — the count, the labels and the hints are admin-only.
   */
  async config() {
    const [settings, count] = await Promise.all([copilotRepository.settings(), copilotRepository.count()]);
    return { allowUserKeys: settings.allowUserKeys, hasServerKeys: count > 0 };
  },

  async adminView() {
    const [settings, keys] = await Promise.all([copilotRepository.settings(), copilotRepository.listForAdmin()]);
    return { allowUserKeys: settings.allowUserKeys, keys };
  },

  setAllowUserKeys: (allow: boolean) => copilotRepository.setAllowUserKeys(allow),

  async addKey(adminId: string, dto: CreateCopilotKeyDto) {
    return copilotRepository.create({
      label: dto.label, secret: dto.key, hint: hintOf(dto.key), createdBy: adminId,
    });
  },

  removeKey: (id: string) => copilotRepository.delete(id).then(() => undefined),

  /**
   * Which keys this request may use, in the order to try them.
   *
   * The toggle is enforced HERE rather than by hiding the field in the browser: a client
   * that keeps sending its own keys after an admin turns user keys off is simply ignored,
   * because a UI-only switch is not a switch.
   */
  async keysFor(supplied: string[] | undefined): Promise<Attempt[]> {
    const { allowUserKeys } = await copilotRepository.settings();
    if (allowUserKeys && supplied?.length) return supplied.map((secret) => ({ id: null, secret }));

    return (await copilotRepository.pool()).map((k) => ({ id: k.id, secret: k.secret }));
  },

  /**
   * Try every key once, back off, sweep again. A 400/404 is not retried — a different key
   * will not fix a bad request or a model that does not exist.
   */
  async chat(body: CopilotChatDto) {
    const { keys: supplied, ...payload } = body;
    const keys = await copilotService.keysFor(supplied);

    if (!keys.length) {
      const { allowUserKeys } = await copilotRepository.settings();
      throw HttpError.badRequest(allowUserKeys
        ? 'Add an Ollama Cloud API key in the copilot settings, or ask an admin to configure keys on the server.'
        : 'No copilot keys are configured on this server. An admin can add them in the admin dashboard.');
    }

    let lastError = 'no endpoint reachable';
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const key of keys) {
        try {
          const upstream = await fetch(`${env.OLLAMA_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.secret}` },
            body: JSON.stringify({ ...payload, stream: false }),
          });

          if (upstream.ok) {
            if (key.id) void copilotRepository.mark(key.id, 'ok').catch(() => {});
            return upstream.json();
          }

          const detail = (await upstream.text().catch(() => '')).slice(0, 160);
          lastError = `${upstream.status} ${detail}`;

          // a rejected key is the likeliest failure and the raw upstream body says
          // nothing useful about it, so name the real problem
          if (upstream.status === 401 || upstream.status === 403) {
            lastError = key.id
              ? 'Ollama Cloud rejected a key configured on this server.'
              : 'Ollama Cloud rejected that API key. Check it in the copilot settings, or add another.';
          }
          if (key.id) void copilotRepository.mark(key.id, upstream.status === 429 ? 'rate-limited' : 'error', String(upstream.status)).catch(() => {});
          if (upstream.status === 400 || upstream.status === 404) throw HttpError.badRequest(detail || lastError);
        } catch (e) {
          if (e instanceof HttpError) throw e;
          lastError = e instanceof Error ? e.message : String(e);
          if (key.id) void copilotRepository.mark(key.id, 'error', lastError.slice(0, 60)).catch(() => {});
        }
      }
      if (attempt === 0) await sleep(1200);
    }
    throw HttpError.upstream(lastError);
  },
};
