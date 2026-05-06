import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { httpFetch } from "@/lib/http";

vi.mock("@clerk/clerk-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/clerk-react")>();
  return {
    ...actual,
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_test",
      getToken: async () => "test-token",
    }),
  };
});

import { InviteMembersModal } from "./InviteMembersModal";

/**
 * Controlled wrapper — open state is owned by the harness so we can observe
 * close behaviour after a successful submit.
 */
function Harness({
  initialOpen = true,
  teamName = "team",
}: {
  initialOpen?: boolean;
  teamName?: string;
}) {
  const [open, setOpen] = React.useState(initialOpen);
  return (
    <ToastProvider>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <InviteMembersModal open={open} onOpenChange={setOpen} teamName={teamName} />
    </ToastProvider>
  );
}

afterEach(() => {
  vi.mocked(httpFetch).mockReset();
});

const getEmailInput = () => screen.getByLabelText("招待するメールアドレス") as HTMLInputElement;

describe("<InviteMembersModal />", () => {
  it("renders header / intro / submit button when open", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: "メンバーを招待" })).toBeInTheDocument();
    // Scope to the <p> intro to avoid matching ancestor containers whose
    // textContent also satisfies the predicate.
    expect(
      screen.getByText(
        (_, node) =>
          node?.tagName === "P" &&
          node?.textContent?.includes("チーム") === true &&
          node?.textContent?.includes("にメンバーを招待します") === true,
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("invite-submit")).toBeInTheDocument();
  });

  it("interpolates the team name into the intro paragraph", () => {
    render(<Harness teamName="design-team" />);
    expect(screen.getByText("design-team")).toBeInTheDocument();
  });

  it("disables the submit button when email list is empty", () => {
    render(<Harness />);
    expect(screen.getByTestId("invite-submit")).toBeDisabled();
  });

  it("enables the submit button and labels it with the count once at least 1 email is added", () => {
    render(<Harness />);
    const input = getEmailInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const submit = screen.getByTestId("invite-submit");
    expect(submit).not.toBeDisabled();
    expect(submit).toHaveTextContent("招待メールを送信 (1名)");
  });

  it("updates the count label as more chips are added", () => {
    render(<Harness />);
    const input = getEmailInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "bob@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "chris@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("invite-submit")).toHaveTextContent("招待メールを送信 (3名)");
  });

  it("disables the submit button when at least one chip is invalid", () => {
    render(<Harness />);
    const input = getEmailInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("invite-submit")).toBeDisabled();
  });

  it("renders both role options and accepts switching to オーナー (no 管理者 option)", () => {
    render(<Harness />);
    const trigger = screen.getByTestId("invite-role-trigger");
    expect(trigger).toHaveTextContent("メンバー");
    // Open the Radix Select popover by clicking the trigger.
    fireEvent.click(trigger);
    // Items render in a portal — find by role.
    const ownerOption = screen.getByRole("option", { name: "オーナー" });
    expect(screen.getByRole("option", { name: "メンバー" })).toBeInTheDocument();
    // ISH-258: 「管理者」option must not exist; FE roles align with BE
    // (owner / member only).
    expect(screen.queryByRole("option", { name: "管理者" })).toBeNull();
    fireEvent.click(ownerOption);
    expect(trigger).toHaveTextContent("オーナー");
  });

  it("POSTs one /tenant/invitations request per email on submit (member role)", async () => {
    vi.mocked(httpFetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            invitationId: "inv_1",
            token: "tok",
            expiresAt: new Date().toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    render(<Harness />);
    const input = getEmailInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "bob@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByTestId("invite-submit"));
    await waitFor(() => {
      expect(vi.mocked(httpFetch)).toHaveBeenCalledTimes(2);
    });
    const calls = vi.mocked(httpFetch).mock.calls;
    expect(calls[0]?.[0]).toContain("/tenant/invitations");
    const body0 = JSON.parse((calls[0]?.[1]?.body as string) ?? "{}");
    const body1 = JSON.parse((calls[1]?.[1]?.body as string) ?? "{}");
    expect(body0).toEqual({ email: "alice@example.com", role: "member" });
    expect(body1).toEqual({ email: "bob@example.com", role: "member" });
  });

  it("submits with API role 'owner' when オーナー is selected", async () => {
    vi.mocked(httpFetch).mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            invitationId: "inv_1",
            token: "tok",
            expiresAt: new Date().toISOString(),
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        ),
    );
    render(<Harness />);
    fireEvent.click(screen.getByTestId("invite-role-trigger"));
    fireEvent.click(screen.getByRole("option", { name: "オーナー" }));
    const input = getEmailInput();
    fireEvent.change(input, { target: { value: "alice@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByTestId("invite-submit"));
    await waitFor(() => {
      expect(vi.mocked(httpFetch)).toHaveBeenCalledTimes(1);
    });
    const body = JSON.parse((vi.mocked(httpFetch).mock.calls[0]?.[1]?.body as string) ?? "{}");
    expect(body).toEqual({ email: "alice@example.com", role: "owner" });
  });
});
