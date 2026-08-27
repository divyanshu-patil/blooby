import cors from 'cors';
import express from 'express';
import { requireAdmin, requireUser, type AuthedRequest } from './auth.js';
import { copilotChat } from './copilot.js';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { admin } from './supabase.js';

const app = express();
app.use(cors({ origin: env.corsOrigins }));
app.use(express.json({ limit: '8mb' })); // project JSON can be chunky

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * Deliberately small: only what needs the service-role key lives here. Saving and reading
 * a user's own animations goes straight from the browser to Supabase under RLS, and so
 * does reading published presets — neither needs a privilege this server has to lend.
 */
const adminOnly = [requireUser, requireAdmin];

/** auth.users is not readable with the publishable key even under RLS — hence this hop. */
app.get('/api/admin/users', ...adminOnly, async (_req, res) => {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) return res.status(502).json({ error: error.message });

  const profiles = await prisma.profile.findMany();
  const isAdmin = new Map(profiles.map((p) => [p.id, p.isAdmin]));
  const counts = await prisma.animation.groupBy({ by: ['userId'], _count: { _all: true } });
  const animations = new Map(counts.map((c) => [c.userId, c._count._all]));

  res.json(data.users.map((u) => ({
    id: u.id,
    email: u.email ?? null,
    name: (u.user_metadata?.full_name as string | undefined) ?? null,
    avatarUrl: (u.user_metadata?.avatar_url as string | undefined) ?? null,
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at ?? null,
    isAdmin: isAdmin.get(u.id) ?? false,
    animationCount: animations.get(u.id) ?? 0,
  })));
});

/** One user's saved projects, for the admin browser. RLS would hide these from an admin
 *  (the policies are owner-scoped, and being an admin is not being the owner), so this is
 *  a genuine service-role read rather than something the browser could do itself. */
app.get('/api/admin/users/:id/animations', ...adminOnly, async (req, res) => {
  const rows = await prisma.animation.findMany({
    where: { userId: req.params.id },
    orderBy: { updatedAt: 'desc' },
  });
  res.json(rows);
});

/** Publish (or re-publish) a preset into the shared library. */
app.post('/api/admin/presets', ...adminOnly, async (req: AuthedRequest, res) => {
  const { id, name, category, source, presetJson, thumbnailUrl, published } = req.body ?? {};
  if (!name || !presetJson) return res.status(400).json({ error: 'name and presetJson are required' });

  const data = {
    name: String(name),
    category: category ? String(category) : null,
    source: source ? String(source) : null,
    presetJson,
    thumbnailUrl: thumbnailUrl ? String(thumbnailUrl) : null,
    published: published !== false,
    createdBy: req.userId!,
    updatedAt: new Date(),
  };

  const row = id
    ? await prisma.preset.update({ where: { id: String(id) }, data })
    : await prisma.preset.create({ data });
  res.status(id ? 200 : 201).json(row);
});

app.post('/api/copilot/chat', requireUser, copilotChat);

app.listen(env.port, () => console.log(`blooby api on :${env.port}`));
