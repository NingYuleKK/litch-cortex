/**
 * Independent Auth Route — username/password + JWT
 * 
 * Replaces Manus OAuth for production/open-source deployment.
 * - POST /api/cortex-auth/login — login with username/password
 * - POST /api/cortex-auth/register — admin creates new user
 * - GET  /api/cortex-auth/me — get current user from JWT
 * - POST /api/cortex-auth/logout — clear JWT cookie
 */
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { getDb } from "./db";
import { cortexUsers, CortexUser } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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
      createdAt: cortexUsers.createdAt,
      lastSignedIn: cortexUsers.lastSignedIn,
    }).from(cortexUsers);

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: "获取用户列表失败" });
  }
});

export default authRouter;
export { CORTEX_COOKIE };
