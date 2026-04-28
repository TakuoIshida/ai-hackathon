// NOTE: google tables have been moved to the tenant schema (ISH-169 / D-2).
// This file re-exports from tenant.ts for backward compatibility during migration.
// Direct imports from "@/db/schema/google" still work, but prefer "@/db/schema/tenant".
export {
  type GoogleCalendar,
  type GoogleOauthAccount,
  googleCalendars,
  googleOauthAccounts,
  type NewGoogleCalendar,
  type NewGoogleOauthAccount,
} from "./tenant";
