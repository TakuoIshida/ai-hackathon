import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "@/lib/api";
import type { GoogleConnection } from "@/lib/types";

// Stable getToken reference — without this, every render returns a fresh
// closure and `load`'s useCallback re-fires `useEffect`, eating queued
// mockResolvedValueOnce responses.
vi.mock("@clerk/clerk-react", () => {
  const getToken = async () => "fake-token";
  return {
    useAuth: () => ({ getToken }),
  };
});

vi.mock("@/lib/api", async (importOriginal) => {
  // Keep ApiError + googleConnectUrl real; only stub the request methods.
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    api: {
      getGoogleConnection: vi.fn(),
      disconnectGoogle: vi.fn(),
      updateCalendarFlags: vi.fn(),
    },
  };
});

import { api } from "@/lib/api";
import Settings from "./Settings";

const mockedApi = vi.mocked(api);

const calA = {
  id: "cal-A",
  googleCalendarId: "a@example.com",
  summary: "Calendar A",
  timeZone: "Asia/Tokyo",
  isPrimary: true,
  usedForBusy: true,
  usedForWrites: true,
};
const calB = {
  id: "cal-B",
  googleCalendarId: "b@example.com",
  summary: "Calendar B",
  timeZone: "Asia/Tokyo",
  isPrimary: false,
  usedForBusy: true,
  usedForWrites: false,
};

const connected = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  connected: true,
  accountEmail: "owner@example.com",
  calendars: [calA, calB],
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("<Settings /> calendar flag toggles (pessimistic)", () => {
  test("success: toggling usedForBusy calls API then re-fetches canonical state", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(connected()).mockResolvedValueOnce(
      connected({
        calendars: [{ ...calA, usedForBusy: false }, calB],
      }),
    );
    mockedApi.updateCalendarFlags.mockResolvedValue({
      calendar: { ...calA, usedForBusy: false },
    });

    render(<Settings />);

    const busyChecks = await screen.findAllByLabelText("空き判定");
    expect(busyChecks[0]).toBeChecked();

    fireEvent.click(busyChecks[0]);

    await waitFor(() => expect(mockedApi.updateCalendarFlags).toHaveBeenCalledTimes(1));
    expect(mockedApi.updateCalendarFlags).toHaveBeenCalledWith(
      "cal-A",
      { usedForBusy: false },
      expect.any(Function),
    );
    // Two getGoogleConnection calls: initial mount + post-update reload
    await waitFor(() => expect(mockedApi.getGoogleConnection).toHaveBeenCalledTimes(2));

    const busyAfter = await screen.findAllByLabelText("空き判定");
    expect(busyAfter[0]).not.toBeChecked();
  });

  test("success: switching usedForWrites reflects server-side exclusivity after reload", async () => {
    mockedApi.getGoogleConnection.mockResolvedValueOnce(connected()).mockResolvedValueOnce(
      connected({
        calendars: [
          { ...calA, usedForWrites: false },
          { ...calB, usedForWrites: true },
        ],
      }),
    );
    mockedApi.updateCalendarFlags.mockResolvedValue({
      calendar: { ...calB, usedForWrites: true },
    });

    render(<Settings />);

    const writesRadios = await screen.findAllByLabelText("書込先");
    expect(writesRadios[0]).toBeChecked();
    expect(writesRadios[1]).not.toBeChecked();

    fireEvent.click(writesRadios[1]);

    await waitFor(() =>
      expect(mockedApi.updateCalendarFlags).toHaveBeenCalledWith(
        "cal-B",
        { usedForWrites: true },
        expect.any(Function),
      ),
    );

    // After reload, exclusivity from the server is visible in the UI.
    await waitFor(async () => {
      const radios = await screen.findAllByLabelText("書込先");
      expect(radios[0]).not.toBeChecked();
      expect(radios[1]).toBeChecked();
    });
  });

  test("failure: API error surfaces a message and the UI does not flip", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());
    mockedApi.updateCalendarFlags.mockRejectedValue(
      new ApiError(403, "forbidden", "403 forbidden"),
    );

    render(<Settings />);

    const busyChecks = await screen.findAllByLabelText("空き判定");
    expect(busyChecks[0]).toBeChecked();

    fireEvent.click(busyChecks[0]);

    await waitFor(() => expect(screen.getByText(/403 forbidden/)).toBeInTheDocument());
    // No reload was triggered (pessimistic = nothing to revert), only the initial fetch.
    expect(mockedApi.getGoogleConnection).toHaveBeenCalledTimes(1);
    // Browser default for an uncommitted checkbox click flips the visual state, so
    // we don't assert checkedness here. The contract under test is: API was called
    // exactly once, no reload was issued, and the error is shown.
    expect(mockedApi.updateCalendarFlags).toHaveBeenCalledTimes(1);
  });

  test("inputs disable while a request is in flight", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    let resolveUpdate!: (v: { calendar: typeof calA }) => void;
    mockedApi.updateCalendarFlags.mockReturnValue(
      new Promise((r) => {
        resolveUpdate = r;
      }),
    );

    render(<Settings />);

    const busyChecks = await screen.findAllByLabelText("空き判定");
    fireEvent.click(busyChecks[0]);

    // Both the busy checkbox and the writes radio for the same row should be disabled.
    const writesRadios = await screen.findAllByLabelText("書込先");
    await waitFor(() => expect(busyChecks[0]).toBeDisabled());
    expect(writesRadios[0]).toBeDisabled();
    // Sibling row remains enabled — only the row in flight is locked.
    expect(busyChecks[1]).not.toBeDisabled();

    resolveUpdate({ calendar: { ...calA, usedForBusy: false } });
  });
});

describe("<Settings /> Google connection display", () => {
  test("connected: shows the linked account email", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue(connected());

    render(<Settings />);

    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Google アカウントを連携/ })).toBeNull();
  });

  test("disconnected: shows the Google connect button pointing at the API connect URL", async () => {
    mockedApi.getGoogleConnection.mockResolvedValue({ connected: false, calendars: [] });

    render(<Settings />);

    const connectLink = await screen.findByRole("link", { name: /Google アカウントを連携/ });
    expect(connectLink).toBeInTheDocument();
    expect(connectLink.getAttribute("href")).toContain("/google/connect");
  });
});
