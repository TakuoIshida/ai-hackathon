export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type AvailabilityRule = {
  weekday: number;
  startMinute: number;
  endMinute: number;
};

export type LinkInput = {
  slug: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  leadTimeHours: number;
  rangeDays: number;
  timeZone: string;
  isPublished: boolean;
  rules: AvailabilityRule[];
  excludes: string[];
};

export type LinkSummary = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  isPublished: boolean;
  timeZone: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkDetail = LinkSummary & {
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  slotIntervalMinutes: number | null;
  maxPerDay: number | null;
  leadTimeHours: number;
  rangeDays: number;
  rules: AvailabilityRule[];
  excludes: string[];
};

export const DURATION_CHOICES = [15, 30, 45, 60] as const;
export const SLOT_INTERVAL_CHOICES = [15, 30, 60] as const;
export const BUFFER_CHOICES = [0, 5, 10, 15, 30] as const;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "日",
  1: "月",
  2: "火",
  3: "水",
  4: "木",
  5: "金",
  6: "土",
};

export const DEFAULT_RANGE_DAYS = 60;

export type BookingStatus = "confirmed" | "canceled";

export type BookingSummary = {
  id: string;
  linkId: string;
  linkSlug: string;
  linkTitle: string;
  // ISH-267: host (owner) info — returned by GET /bookings + /bookings/:id so
  // the dashboard can render the actual host name + email instead of the
  // hard-coded "あなた" / "このワークスペースのオーナー" placeholders.
  hostUserId: string;
  hostName: string;
  hostEmail: string;
  startAt: string;
  endAt: string;
  guestName: string;
  guestEmail: string;
  status: BookingStatus;
  meetUrl: string | null;
  /**
   * Google Calendar event id captured at confirm time. Null when Google sync
   * was skipped or failed (best-effort policy in `confirmBooking`).
   */
  googleEventId: string | null;
  /**
   * Google Calendar `event.htmlLink` captured at confirm time — used by the
   * booking detail "Google Calendar で開く" button to deep-link straight to
   * the real event (ISH-269). Null means we don't have a deeplink to offer
   * (Google disabled / oauth missing / sync failed) and the button is hidden.
   */
  googleHtmlLink: string | null;
  canceledAt: string | null;
  createdAt: string;
};

export type GoogleCalendarSummary = {
  // DB row UUID — stable id for PATCH /google/calendars/:id and React keys
  id: string;
  // Google's calendar identifier (e.g. "primary@example.com") — for display
  googleCalendarId: string;
  summary: string | null;
  timeZone: string | null;
  isPrimary: boolean;
  usedForBusy: boolean;
  usedForWrites: boolean;
};

export type GoogleConnection = {
  connected: boolean;
  accountEmail?: string;
  calendars: GoogleCalendarSummary[];
};

// ISH-107: workspace summary returned by GET /workspaces and the workspace
// detail screen. We deliberately keep `WorkspaceDetail` shape-identical to
// `WorkspaceSummary` for now — member-management UI lives in a future ticket.
export type WorkspaceRole = "owner" | "member";

// ISH-111: alias used by member-management UI. Same union as WorkspaceRole;
// kept as a separate name so role-change call sites read clearly.
export type MembershipRole = "owner" | "member";

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  role: WorkspaceRole;
  createdAt: string;
};

export type WorkspaceDetail = WorkspaceSummary;

// ISH-110: members of a workspace returned by GET /workspaces/:id/members.
// `createdAt` is the membership createdAt (when this user joined), serialized
// as ISO string in transit.
export type WorkspaceMember = {
  userId: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  createdAt: string;
};

// ISH-253 / ISH-250: tenant-scoped member listing returned by GET /tenant/members.
// Active rows come from common.tenant_members; pending/expired rows come from
// tenant.invitations (open invites whose acceptedAt is null). The two are
// combined server-side into a single view per row.
//
// `id` is the userId for active members, or `inv:<invitationId>` for
// pending/expired so React keys never collide across kinds.
// `userId` is non-null only for active rows (no user exists for an unredeemed invite).
// `expiresIn` is a human-friendly TTL ("残り 18 時間") and only set for pending.
export type TenantMemberStatus = "active" | "pending" | "expired";

export type TenantMemberView = {
  id: string;
  userId: string | null;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  status: TenantMemberStatus;
  joinedAt: string;
  expiresIn?: string;
};

// ISH-109: invitation acceptance.
export type InvitationSummary = {
  workspaceName: string;
  workspaceSlug: string;
  email: string;
  expired: boolean;
};

export type AcceptedInvitationWorkspace = {
  id: string;
  slug: string;
  name: string;
};
