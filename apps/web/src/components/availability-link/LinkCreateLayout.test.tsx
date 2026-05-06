import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LinkCreateLayout } from "./LinkCreateLayout";

function setup(overrides: Partial<Parameters<typeof LinkCreateLayout>[0]> = {}) {
  const onModeChange = vi.fn();
  const onBack = vi.fn();
  const onPublish = vi.fn();
  const onSaveDraft = vi.fn();
  render(
    <LinkCreateLayout
      mode="form"
      onModeChange={onModeChange}
      onBack={onBack}
      onPublish={onPublish}
      onSaveDraft={onSaveDraft}
      title="新規作成"
      rightPanel={<div data-testid="panel">PANEL</div>}
      {...overrides}
    >
      <div data-testid="main">MAIN</div>
    </LinkCreateLayout>,
  );
  return { onModeChange, onBack, onPublish, onSaveDraft };
}

describe("<LinkCreateLayout />", () => {
  it("renders subnav, main, right panel, and the breadcrumb tail", () => {
    setup();
    expect(screen.getByText("空き時間リンク")).toBeInTheDocument();
    expect(screen.getByText("新規作成")).toBeInTheDocument();
    expect(screen.getByTestId("main")).toBeInTheDocument();
    expect(screen.getByTestId("panel")).toBeInTheDocument();
    // SegmentedControl renders both options
    expect(screen.getByRole("radio", { name: /カレンダーで選択/ })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /曜日×時間帯/ })).toBeInTheDocument();
  });

  it("invokes onBack when the back button is clicked", () => {
    const { onBack } = setup();
    fireEvent.click(screen.getByRole("button", { name: /戻る/ }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("invokes onModeChange when the segmented control is toggled", () => {
    const { onModeChange } = setup({ mode: "form" });
    fireEvent.click(screen.getByRole("radio", { name: /カレンダーで選択/ }));
    expect(onModeChange).toHaveBeenCalledWith("calendar");
  });

  it("invokes onPublish when the publish button is clicked", () => {
    const { onPublish } = setup();
    fireEvent.click(screen.getByRole("button", { name: /リンクを発行/ }));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("disables publish when publishDisabled is true", () => {
    setup({ publishDisabled: true });
    expect(screen.getByRole("button", { name: /リンクを発行/ })).toBeDisabled();
  });
});
