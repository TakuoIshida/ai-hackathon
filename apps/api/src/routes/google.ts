import { randomBytes } from "node:crypto";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { config } from "@/config";
import { db } from "@/db/client";
import { listCalendars } from "@/google/calendar";
import type { GoogleConfig } from "@/google/config";
import { exchangeCodeForTokens, fetchUserInfo, revokeToken } from "@/google/oauth";
import { getOauthAccountByUser, listUserCalendars, syncCalendars } from "@/google/repo";
import {
  buildOauthAuthUrl,
  completeOauthCallback,
  disconnectGoogleAccount,
  type OauthSinks,
  updateCalendarFlagsForUser,
} from "@/google/usecase";
import { type AuthVars, attachDbUser, getDbUser, requireAuth } from "@/middleware/auth";
import { findTenantIdByUserId } from "@/users/repo";

/**
 * Resolve Google OAuth config or fail fast with a 500.
 *
 * Unlike the booking flow (which falls back to "no Google sync" gracefully),
 * the OAuth routes themselves are unusable without Google config — there's no
 * meaningful response we could return without it. Surfacing as a 500 with a
 * clear message beats silently redirecting to a malformed auth URL.
 */
function requireGoogleConfig(): GoogleConfig {
  if (!config.google) {
    throw new Error("[google] GOOGLE_OAUTH_* env vars are not set");
  }
  return config.google;
}

const STATE_COOKIE = "google_oauth_state";
const STATE_TTL_SECONDS = 600;

// Real Google ports wired here so the route stays a thin orchestration layer.
// Tests for the OAuth flow live in @/google/usecase.test.ts and inject fakes
// directly — the route layer only sees the parsed request, cookies, and the
// usecase result.
const oauthSinks: OauthSinks = {
  exchangeCodeForTokens,
  fetchUserInfo,
  listCalendars,
  syncCalendars,
  revokeToken,
};

export const googleRoute = new Hono<{ Variables: AuthVars }>();

googleRoute.use("*", requireAuth);
googleRoute.use("*", attachDbUser);

googleRoute.get("/connect", (c) => {
  const cfg = requireGoogleConfig();
  const state = randomBytes(32).toString("base64url");
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: config.isProduction,
    maxAge: STATE_TTL_SECONDS,
    path: "/",
  });
  return c.redirect(buildOauthAuthUrl(cfg, state));
});

googleRoute.get("/callback", async (c) => {
  const cookieState = getCookie(c, STATE_COOKIE);
  const queryState = c.req.query("state");
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  const cfg = requireGoogleConfig();
  const dbUser = getDbUser(c);
  const tenantId = await findTenantIdByUserId(db, dbUser.id);
  if (!tenantId) return c.json({ error: "tenant_not_found" }, 403);
  const result = await completeOauthCallback(
    db,
    cfg,
    {
      cookieState,
      queryState,
      code: c.req.query("code"),
      userId: dbUser.id,
      tenantId,
    },
    oauthSinks,
  );

  switch (result.kind) {
    case "invalid_state":
      return c.json({ error: "invalid_state" }, 400);
    case "missing_code":
      return c.json({ error: "missing_code" }, 400);
    case "missing_refresh_token":
      return c.json({ error: "missing_refresh_token", hint: "force re-consent" }, 400);
    case "missing_scopes":
      return c.json({ error: "missing_scopes" }, 400);
    case "ok":
      return c.redirect(result.redirectTo);
  }
});

googleRoute.post("/disconnect", async (c) => {
  const cfg = requireGoogleConfig();
  const dbUser = getDbUser(c);
  const result = await disconnectGoogleAccount(db, cfg, dbUser.id, oauthSinks);
  if (result.kind === "already_disconnected") {
    return c.json({ ok: true, alreadyDisconnected: true });
  }
  return c.json({ ok: true });
});

googleRoute.get("/calendars", async (c) => {
  const dbUser = getDbUser(c);
  const account = await getOauthAccountByUser(db, dbUser.id);
  if (!account) return c.json({ connected: false, calendars: [] });
  const calendars = await listUserCalendars(db, account.id);
  return c.json({
    connected: true,
    accountEmail: account.email,
    calendars: calendars.map((cal) => ({
      id: cal.id,
      googleCalendarId: cal.googleCalendarId,
      summary: cal.summary,
      timeZone: cal.timeZone,
      isPrimary: cal.isPrimary,
      usedForBusy: cal.usedForBusy,
      usedForWrites: cal.usedForWrites,
    })),
  });
});

const flagsPatchSchema = z
  .object({
    usedForBusy: z.boolean().optional(),
    usedForWrites: z.boolean().optional(),
  })
  .refine((p) => p.usedForBusy !== undefined || p.usedForWrites !== undefined, {
    message: "at least one of usedForBusy or usedForWrites must be provided",
  });

googleRoute.patch("/calendars/:id", zValidator("json", flagsPatchSchema), async (c) => {
  const dbUser = getDbUser(c);
  const calendarId = c.req.param("id");
  const patch = c.req.valid("json");
  const result = await updateCalendarFlagsForUser(db, dbUser.id, calendarId, patch);
  if (result.kind === "not_found") return c.json({ error: "not_found" }, 404);
  if (result.kind === "forbidden") return c.json({ error: "forbidden" }, 403);
  if (result.kind === "invalid") return c.json({ error: result.reason }, 400);
  const cal = result.calendar;
  return c.json({
    calendar: {
      id: cal.id,
      googleCalendarId: cal.googleCalendarId,
      summary: cal.summary,
      timeZone: cal.timeZone,
      isPrimary: cal.isPrimary,
      usedForBusy: cal.usedForBusy,
      usedForWrites: cal.usedForWrites,
    },
  });
});
