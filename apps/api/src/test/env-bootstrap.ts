// Force-set test stubs for environment variables that production code reads
// at module-load time. Bun auto-loads `.env*` files BEFORE this preload runs,
// so we use `=` (not `??=`) to override any developer-local values.
//
// Wired up via apps/api/bunfig.toml [test] preload, so this runs exactly once
// at the start of `bun test` and is invisible to `bun run dev` / `bun start`.
//
// Why each value matters
// ----------------------
// - CLERK_PUBLISHABLE_KEY: `parsePublishableKey` from @clerk/shared@3.47+ now
//   throws on the placeholder `pk_test_xxx` that ships in `.env.example`. Use
//   the canonical valid stub (= base64("example.com$") with the pk_test_ prefix).
// - CLERK_SECRET_KEY: any non-empty `sk_test_*` string is accepted; we only
//   need it present so `createClerkClient` doesn't throw at construction.
// - CLERK_WEBHOOK_SECRET: required by routes/clerk-webhook.ts at module load.

// pk_test_<base64("example.com$")> — the canonical Clerk SDK stub.
process.env.CLERK_PUBLISHABLE_KEY = "pk_test_ZXhhbXBsZS5jb20k";
process.env.CLERK_SECRET_KEY = "sk_test_unit_test_stub";
process.env.CLERK_WEBHOOK_SECRET = "whsec_unit_test_stub";
