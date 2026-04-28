-- ISH-170: Create admin/app roles and enable RLS on all tenant schema tables.
-- admin role: BYPASSRLS, used for migrations.
-- app role: RLS applied, used for runtime queries (D-4 will wire the connection).
-- Runtime SET LOCAL middleware is D-4's job — this migration only creates
-- the roles, grants, and policies.

-- ---------------------------------------------------------------------------
-- 1. Role creation (idempotent)
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'admin') THEN
    CREATE ROLE admin WITH LOGIN PASSWORD 'admin' BYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    CREATE ROLE app WITH LOGIN PASSWORD 'app';
  END IF;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. GRANT strategy (schema-map.md §5 / rls.md §1-2)
-- ---------------------------------------------------------------------------

-- common schema: app gets SELECT by default; individual writes are granted below
GRANT USAGE ON SCHEMA common TO app;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA common TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA common GRANT SELECT ON TABLES TO app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA common FROM app;
--> statement-breakpoint

-- Individual write grants for common schema (D-6 onboarding / D-7 invitation)
GRANT INSERT ON common.tenants TO app;
--> statement-breakpoint
GRANT INSERT, UPDATE ON common.tenant_members TO app;
--> statement-breakpoint
GRANT INSERT, UPDATE ON common.users TO app;
--> statement-breakpoint

-- tenant schema: app gets full CRUD (RLS provides row-level isolation)
GRANT USAGE ON SCHEMA tenant TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA tenant TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app;
--> statement-breakpoint

-- admin gets all privileges on both schemas (BYPASSRLS bypasses all policies)
GRANT ALL ON SCHEMA common TO admin;
--> statement-breakpoint
GRANT ALL ON SCHEMA tenant TO admin;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA common TO admin;
--> statement-breakpoint
GRANT ALL ON ALL TABLES IN SCHEMA tenant TO admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA common GRANT ALL ON TABLES TO admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant GRANT ALL ON TABLES TO admin;
--> statement-breakpoint

-- Sequence permissions (needed if sequences exist; safe no-op if none)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA common TO app;
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA tenant TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA common GRANT USAGE ON SEQUENCES TO app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA tenant GRANT USAGE ON SEQUENCES TO app;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Enable RLS + tenant_isolation policy on all 8 tenant schema tables
--    (rls.md §2-1 through §2-4)
--    Policy: USING + WITH CHECK both use current_setting('app.tenant_id', true)
--    missing_ok=true → NULL when unset → 0 rows returned (no silent data leak)
-- ---------------------------------------------------------------------------

-- tenant.invitations
ALTER TABLE tenant.invitations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.invitations
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.availability_links
ALTER TABLE tenant.availability_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.availability_links
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.availability_rules
ALTER TABLE tenant.availability_rules ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.availability_rules
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.availability_excludes
ALTER TABLE tenant.availability_excludes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.availability_excludes
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.bookings
ALTER TABLE tenant.bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.bookings
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.link_owners
ALTER TABLE tenant.link_owners ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.link_owners
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.google_oauth_accounts
ALTER TABLE tenant.google_oauth_accounts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.google_oauth_accounts
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
--> statement-breakpoint

-- tenant.google_calendars
ALTER TABLE tenant.google_calendars ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON tenant.google_calendars
  USING      (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
