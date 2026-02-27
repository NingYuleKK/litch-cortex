import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { getCortexUser } from "../authRoute";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  cortexUserId: number | null; // Independent Cortex auth user id
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;
  let cortexUserId: number | null = null;

  // 1. Try Cortex independent auth first (username/password + JWT)
  try {
    const cortexUser = await getCortexUser(opts.req);
    if (cortexUser) {
      cortexUserId = cortexUser.id;
      // Create a compatible User object for protectedProcedure
      user = {
        id: cortexUser.id,
        openId: `cortex:${cortexUser.id}`,
        name: cortexUser.displayName || cortexUser.username,
        email: null,
        loginMethod: "cortex",
        role: cortexUser.role === "admin" ? "admin" : "user",
        createdAt: cortexUser.createdAt,
        updatedAt: cortexUser.createdAt,
        lastSignedIn: cortexUser.lastSignedIn || cortexUser.createdAt,
      };
    }
  } catch {
    // Cortex auth failed, try Manus OAuth
  }

  // 2. Fall back to Manus OAuth if Cortex auth didn't work
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch {
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
    cortexUserId,
  };
}
