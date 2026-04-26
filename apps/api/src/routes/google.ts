import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { db } from "@/db/client";
import { listCalendars } from "@/google/calendar";
import { loadGoogleConfig } from "@/google/config";
import {
  buildAuthUrl,
  exchangeCodeForTokens,
  fetchUserInfo,
  hasRequiredScopes,
  revokeToken,
} from "@/google/oauth";
import {
  decryptRefreshToken,
  deleteOauthAccount,
  getOauthAccountByUser,
  listUserCalendars,
  syncCalendars,
  upsertOauthAccount,
} from "@/google/repo";
import { clerkAuth, getClerkUserId, requireAuth } from "@/middleware/auth";
import { ensureUserByClerkId, getUserByClerkId } from "@/users/lookup";

const STATE_COOKIE = "google_oauth_state";
const STATE_TTL_SECONDS = 600;

export const googleRoute = new Hono();

googleRoute.use("*", clerkAuth());
googleRoute.use("*", requireAuth);

googleRoute.get("/connect", (c) => {
  const cfg = loadGoogleConfig();
  const state = randomBytes(32).toString("base64url");
  setCookie(c, STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: STATE_TTL_SECONDS,
    path: "/",
  });
  return c.redirect(buildAuthUrl(cfg, state));
});

googleRoute.get("/callback", async (c) => {
  const cookieState = getCookie(c, STATE_COOKIE);
  const queryState = c.req.query("state");
  deleteCookie(c, STATE_COOKIE, { path: "/" });

  if (!cookieState || !queryState || cookieState !== queryState) {
    return c.json({ error: "invalid_state" }, 400);
  }
  const code = c.req.query("code");
  if (!code) return c.json({ error: "missing_code" }, 400);

  const cfg = loadGoogleConfig();
  const tokens = await exchangeCodeForTokens(cfg, code);
  if (!tokens.refreshToken) {
    return c.json({ error: "missing_refresh_token", hint: "force re-consent" }, 400);
  }
  if (!hasRequiredScopes(tokens.scope)) {
    return c.json({ error: "missing_scopes" }, 400);
  }

  const userInfo = await fetchUserInfo(tokens.accessToken);
  const dbUser = await ensureUserByClerkId(db, getClerkUserId(c));

  const account = await upsertOauthAccount(db, {
    userId: dbUser.id,
    googleUserId: userInfo.sub,
    email: userInfo.email,
    refreshToken: tokens.refreshToken,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: new Date(Date.now() + tokens.expiresInSeconds * 1000),
    scope: tokens.scope,
    encryptionKey: cfg.encryptionKey,
  });

  const calendarList = await listCalendars(tokens.accessToken);
  await syncCalendars(db, account.id, calendarList);

  return c.redirect(`${cfg.appBaseUrl}/dashboard/settings?google_connected=1`);
});

googleRoute.post("/disconnect", async (c) => {
  const cfg = loadGoogleConfig();
  const dbUser = await getUserByClerkId(db, getClerkUserId(c));
  if (!dbUser) return c.json({ error: "user_not_found" }, 404);
  const account = await getOauthAccountByUser(db, dbUser.id);
  if (!account) return c.json({ ok: true, alreadyDisconnected: true });

  try {
    const refresh = decryptRefreshToken(account, cfg.encryptionKey);
    await revokeToken(refresh);
  } catch (err) {
    console.warn("[google] revoke failed (will still delete row):", err);
  }
  await deleteOauthAccount(db, dbUser.id, account.googleUserId);
  return c.json({ ok: true });
});

googleRoute.get("/calendars", async (c) => {
  const dbUser = await getUserByClerkId(db, getClerkUserId(c));
  if (!dbUser) return c.json({ error: "user_not_found" }, 404);
  const account = await getOauthAccountByUser(db, dbUser.id);
  if (!account) return c.json({ connected: false, calendars: [] });
  const calendars = await listUserCalendars(db, account.id);
  return c.json({
    connected: true,
    accountEmail: account.email,
    calendars: calendars.map((cal) => ({
      id: cal.googleCalendarId,
      summary: cal.summary,
      timeZone: cal.timeZone,
      isPrimary: cal.isPrimary,
      usedForBusy: cal.usedForBusy,
      usedForWrites: cal.usedForWrites,
    })),
  });
});
