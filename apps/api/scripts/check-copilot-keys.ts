/**
 * The copilot key policy, checked against the real database.
 *
 *   pnpm --filter @blooby/api check:copilot
 *
 * Not part of `pnpm check`: that one is offline and deterministic, and this needs
 * DATABASE_URL. It exists because the important half of the "let users bring their own
 * keys" switch is invisible in the UI — the server ignoring keys a client sends anyway —
 * and a switch you cannot see is a switch nobody notices has broken.
 *
 * Creates two probe keys, exercises every branch, and deletes them.
 */
import { copilotService } from '../src/services/copilot.service.js';
import { copilotRepository } from '../src/repositories/copilot.repository.js';
import { prisma } from '../src/config/prisma.js';

let bad = 0;
const ok = (label: string, cond: boolean, detail = '') => { if (!cond) { bad++; console.error('FAIL', label, detail); } };

const admin = await copilotRepository.create({ label: 'probe-a', secret: 'sk-server-AAA', hint: 'sk-s…AAA' });
const admin2 = await copilotRepository.create({ label: 'probe-b', secret: 'sk-server-BBB', hint: 'sk-s…BBB' });

// --- user keys ALLOWED: the caller's keys win
await copilotRepository.setAllowUserKeys(true);
let keys = await copilotService.keysFor(['sk-mine']);
ok('allowed + supplied -> the user’s own key is used', keys.length === 1 && keys[0].secret === 'sk-mine', JSON.stringify(keys));

keys = await copilotService.keysFor(undefined);
ok('allowed + none supplied -> falls back to the server pool', keys.length === 2 && keys.every((k) => k.id), String(keys.length));

// --- user keys OFF: supplied keys must be IGNORED, not merely hidden in the UI
await copilotRepository.setAllowUserKeys(false);
keys = await copilotService.keysFor(['sk-mine', 'sk-mine-2']);
ok('disallowed + supplied -> the supplied keys are ignored entirely',
  keys.length === 2 && !keys.some((k) => k.secret.startsWith('sk-mine')), JSON.stringify(keys.map((k) => k.secret)));
ok('and every key used is a server key with an id', keys.every((k) => k.id !== null));

// --- rotation order: healthy first, then rate-limited, then failed
await copilotRepository.mark(admin.id, 'rate-limited', '429');
keys = await copilotService.keysFor(undefined);
ok('a rate-limited key drops behind a healthy one', keys[0].id === admin2.id, JSON.stringify(keys.map((k) => k.id)));

// --- the config a user is told: booleans only, never a key or a count
const cfg = await copilotService.config();
ok('config is exactly two booleans', Object.keys(cfg).sort().join() === 'allowUserKeys,hasServerKeys', JSON.stringify(cfg));
ok('and reports the pool without revealing it', cfg.hasServerKeys === true && cfg.allowUserKeys === false);

// --- the admin view must never carry a secret
const view = await copilotService.adminView();
ok('the admin view carries no secret',
  !JSON.stringify(view).includes('sk-server-AAA') && view.keys.every((k) => !('secret' in k)), JSON.stringify(view.keys[0]));
ok('but does carry a usable hint', view.keys.every((k) => k.hint.includes('…')));

// --- the settings table really is a singleton
try {
  await prisma.$executeRaw`insert into public.copilot_settings (id) values (false)`;
  ok('a second settings row is refused by Postgres', false, 'the insert succeeded');
} catch { ok('a second settings row is refused by Postgres', true); }

await prisma.copilotKey.deleteMany({ where: { id: { in: [admin.id, admin2.id] } } });
await copilotRepository.setAllowUserKeys(true);
const left = await prisma.copilotKey.count();
ok('probe keys cleaned up', left === 0, `${left} left`);

console.log(bad === 0 ? 'copilot keys: all checks passed' : `copilot keys: ${bad} FAILED`);
await prisma.$disconnect();
