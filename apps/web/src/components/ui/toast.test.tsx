import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "./toast";

function FireToastButton({
  options,
}: {
  options: Parameters<ReturnType<typeof useToast>["toast"]>[0];
}) {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(options)}>
      Fire
    </button>
  );
}

describe("<ToastProvider /> + useToast", () => {
  it("renders the title when toast is fired", async () => {
    render(
      <ToastProvider>
        <FireToastButton options={{ title: "Saved", variant: "success", duration: 0 }} />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "Fire" }).click();
    });
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("renders both title and description", async () => {
    render(
      <ToastProvider>
        <FireToastButton
          options={{
            title: "Failed",
            description: "Server returned 500",
            variant: "destructive",
            duration: 0,
          }}
        />
      </ToastProvider>,
    );
    act(() => {
      screen.getByRole("button", { name: "Fire" }).click();
    });
    await waitFor(() => {
      expect(screen.getByText("Failed")).toBeInTheDocument();
      expect(screen.getByText("Server returned 500")).toBeInTheDocument();
    });
  });

  it("throws when useToast is used outside the provider", () => {
    // Suppress React's console.error for the expected throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const Bad = () => {
      useToast();
      return null;
    };
    expect(() => render(<Bad />)).toThrow(/inside <ToastProvider>/);
    spy.mockRestore();
  });
});
