/**
 * Independent Auth Route — username/password + JWT
 * 
 * Replaces Manus OAuth for production/open-source deployment.
 * - POST /api/cortex-auth/login — login with username/password
 * - POST /api/cortex-auth/register — admin creates new user
 * - GET  /api/cortex-auth/me — get current user from JWT
 * - POST /api/cortex-auth/logout — clear JWT cookie
 * - PUT  /api/cortex-auth/change-password — change own password
 * - DELETE /api/cortex-auth/users/:id — admin deletes user + cascade data
 */
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "./db";
import { cortexUsers, CortexUser, projects, documents, chunks, chunkTopics, summaries, topics } from "../drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

const CORTEX_COOKIE = "cortex_session";
const JWT_SECRET_KEY = process.env.JWT_SECRET || "cortex-default-secret-change-me";
const secret = new TextEncoder().encode(JWT_SECRET_KEY);

// ─── JWT helpers ───────────────────────────────────────────────────
async function signToken(user: { id: number; username: string; role: string }): Promise<string> {
  return new SignJWT({ sub: String(user.id), username: user.username, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(secret);
}

async function verifyToken(token: string): Promise<{ id: number; username: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return {
      id: Number(payload.sub),
      username: payload.username as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

// ─── Middleware: extract cortex user from JWT cookie ────────────────
export async function getCortexUser(req: Request): Promise<CortexUser | null> {
  const token = req.cookies?.[CORTEX_COOKIE];
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload) return null;

  const db = await getDb();
  if (!db) return null;

  const rows = await db.select().from(cortexUsers).where(eq(cortexUsers.id, payload.id)).limit(1);
  return rows[0] || null;
}

// ─── Seed default admin user ───────────────────────────────────────
export async function seedDefaultAdmin() {
  const db = await getDb();
  if (!db) return;

  const existing = await db.select().from(cortexUsers).where(eq(cortexUsers.username, "litch")).limit(1);
  if (existing.length > 0) {
    console.log("[Auth] Default admin user 'litch' already exists");
    return;
  }

  const hash = await bcrypt.hash("cortex2026", 10);
  await db.insert(cortexUsers).values({
    username: "litch",
    passwordHash: hash,
    displayName: "Litch",
    role: "admin",
    initialPassword: "cortex2026",
  });
  console.log("[Auth] Created default admin user 'litch'");
}

// ─── Cookie options ────────────────────────────────────────────────
function getCookieOptions(req: Request) {
  const isSecure = req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? ("none" as const) : ("lax" as const),
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  };
}

// ─── Router ────────────────────────────────────────────────────────
const authRouter = Router();

// Login
authRouter.post("/api/cortex-auth/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "用户名和密码不能为空" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "数据库不可用" });
      return;
    }

    const rows = await db.select().from(cortexUsers).where(eq(cortexUsers.username, username)).limit(1);
    const user = rows[0];
    if (!user) {
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "用户名或密码错误" });
      return;
    }

    // Update last signed in
    await db.update(cortexUsers).set({ lastSignedIn: new Date() }).where(eq(cortexUsers.id, user.id));

    const token = await signToken({ id: user.id, username: user.username, role: user.role });
    res.cookie(CORTEX_COOKIE, token, getCookieOptions(req));

    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    });
  } catch (err: any) {
    console.error("[Auth] Login error:", err.message);
    res.status(500).json({ error: "登录失败" });
  }
});

// Register (admin only)
authRouter.post("/api/cortex-auth/register", async (req: Request, res: Response) => {
  try {
    const currentUser = await getCortexUser(req);
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ error: "只有管理员可以创建用户" });
      return;
    }

    const { username, password, displayName, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "用户名和密码不能为空" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "数据库不可用" });
      return;
    }

    // Check if username exists
    const existing = await db.select().from(cortexUsers).where(eq(cortexUsers.username, username)).limit(1);
    if (existing.length > 0) {
      res.status(409).json({ error: "用户名已存在" });
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await db.insert(cortexUsers).values({
      username,
      passwordHash: hash,
      displayName: displayName || username,
      role: role === "admin" ? "admin" : "member",
      initialPassword: password, // Store initial password in plaintext for admin reference
    });

    res.json({
      id: result[0].insertId,
      username,
      displayName: displayName || username,
      role: role === "admin" ? "admin" : "member",
    });
  } catch (err: any) {
    console.error("[Auth] Register error:", err.message);
    res.status(500).json({ error: "创建用户失败" });
  }
});

// Get current user
authRouter.get("/api/cortex-auth/me", async (req: Request, res: Response) => {
  try {
    const user = await getCortexUser(req);
    if (!user) {
      res.status(401).json({ error: "未登录" });
      return;
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    });
  } catch (err: any) {
    res.status(401).json({ error: "认证失败" });
  }
});

// Logout
authRouter.post("/api/cortex-auth/logout", async (req: Request, res: Response) => {
  const opts = getCookieOptions(req);
  res.clearCookie(CORTEX_COOKIE, { ...opts, maxAge: -1 });
  res.json({ success: true });
});

// Change password (any authenticated user)
authRouter.put("/api/cortex-auth/change-password", async (req: Request, res: Response) => {
  try {
    const currentUser = await getCortexUser(req);
    if (!currentUser) {
      res.status(401).json({ error: "未登录" });
      return;
    }

    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) {
      res.status(400).json({ error: "旧密码和新密码不能为空" });
      return;
    }

    if (newPassword.length < 4) {
      res.status(400).json({ error: "新密码长度不能少于 4 位" });
      return;
    }

    // Verify old password
    const valid = await bcrypt.compare(oldPassword, currentUser.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "旧密码不正确" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "数据库不可用" });
      return;
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    // Update password hash only; do NOT update initialPassword
    await db.update(cortexUsers).set({ passwordHash: newHash }).where(eq(cortexUsers.id, currentUser.id));

    res.json({ success: true });
  } catch (err: any) {
    console.error("[Auth] Change password error:", err.message);
    res.status(500).json({ error: "修改密码失败" });
  }
});

// List users (admin only)
authRouter.get("/api/cortex-auth/users", async (req: Request, res: Response) => {
  try {
    const currentUser = await getCortexUser(req);
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ error: "只有管理员可以查看用户列表" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "数据库不可用" });
      return;
    }

    const rows = await db.select({
      id: cortexUsers.id,
      username: cortexUsers.username,
      displayName: cortexUsers.displayName,
      role: cortexUsers.role,
      initialPassword: cortexUsers.initialPassword,
      createdAt: cortexUsers.createdAt,
      lastSignedIn: cortexUsers.lastSignedIn,
    }).from(cortexUsers);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

// Delete user (admin only, cascade delete all user data)
authRouter.delete("/api/cortex-auth/users/:id", async (req: Request, res: Response) => {
  try {
    const currentUser = await getCortexUser(req);
    if (!currentUser || currentUser.role !== "admin") {
      res.status(403).json({ error: "只有管理员可以删除用户" });
      return;
    }

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) {
      res.status(400).json({ error: "无效的用户 ID" });
      return;
    }

    // Prevent deleting self
    if (targetId === currentUser.id) {
      res.status(400).json({ error: "不能删除自己的账号" });
      return;
    }

    const db = await getDb();
    if (!db) {
      res.status(500).json({ error: "数据库不可用" });
      return;
    }

    // Verify target user exists
    const targetRows = await db.select().from(cortexUsers).where(eq(cortexUsers.id, targetId)).limit(1);
    if (targetRows.length === 0) {
      res.status(404).json({ error: "用户不存在" });
      return;
    }

    // Cascade delete: get all projects owned by this user
    const userProjects = await db.select({ id: projects.id }).from(projects).where(eq(projects.cortexUserId, targetId));
    const projectIds = userProjects.map(p => p.id);

    if (projectIds.length > 0) {
      // Get all documents in these projects
      const userDocs = await db.select({ id: documents.id }).from(documents).where(inArray(documents.projectId, projectIds));
      const docIds = userDocs.map(d => d.id);

      if (docIds.length > 0) {
        // Get all chunks in these documents
        const userChunks = await db.select({ id: chunks.id }).from(chunks).where(inArray(chunks.documentId, docIds));
        const chunkIds = userChunks.map(c => c.id);

        if (chunkIds.length > 0) {
          // Delete chunk_topics for these chunks
          await db.delete(chunkTopics).where(inArray(chunkTopics.chunkId, chunkIds));
        }

        // Delete chunks
        await db.delete(chunks).where(inArray(chunks.documentId, docIds));
      }

      // Delete documents
      await db.delete(documents).where(inArray(documents.projectId, projectIds));

      // Delete projects
      await db.delete(projects).where(eq(projects.cortexUserId, targetId));
    }

    // Delete the user
    await db.delete(cortexUsers).where(eq(cortexUsers.id, targetId));

    console.log(`[Auth] Admin ${currentUser.username} deleted user #${targetId} (${targetRows[0].username}) with ${projectIds.length} projects`);

    res.json({ success: true, deletedProjects: projectIds.length });
  } catch (err: any) {
    console.error("[Auth] Delete user error:", err.message);
    res.status(500).json({ error: "删除用户失败" });
  }
});

export default authRouter;
export { CORTEX_COOKIE };
