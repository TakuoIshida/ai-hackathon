import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { LinkInput } from "@/lib/types";
import { type LocationKind, SettingsPanel } from "./SettingsPanel";

const baseInput: LinkInput = {
  slug: "intro",
  title: "Intro 30",
  description: "",
  durationMinutes: 30,
  bufferBeforeMinutes: 0,
  bufferAfterMinutes: 0,
  slotIntervalMinutes: null,
  maxPerDay: null,
  leadTimeHours: 0,
  rangeDays: 60,
  timeZone: "Asia/Tokyo",
  isPublished: false,
  rules: [],
  excludes: [],
};

function Controlled() {
  const [form, setForm] = useState<LinkInput>(baseInput);
  const [location, setLocation] = useState<LocationKind>("meet");
  return (
    <SettingsPanel
      form={form}
      onChange={(patch) => setForm({ ...form, ...patch })}
      location={location}
      onLocationChange={setLocation}
      hostName="Ishida T"
      hostInitial="I"
    />
  );
}

describe("<SettingsPanel />", () => {
  it("shows the section heading and the four required fields", () => {
    render(<Controlled />);
    expect(screen.getByRole("heading", { name: "リンクの設定" })).toBeInTheDocument();
    expect(screen.getByLabelText("タイトル")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "所要時間" })).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "場所" })).toBeInTheDocument();
    expect(screen.getByText("Ishida T")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /共催者を追加/ })).toBeInTheDocument();
  });

  it("emits onChange when the title input is edited", () => {
    const onChange = vi.fn();
    render(<SettingsPanel form={baseInput} onChange={onChange} location="meet" />);
    fireEvent.change(screen.getByLabelText("タイトル"), {
      target: { value: "Demo session" },
    });
    expect(onChange).toHaveBeenCalledWith({ title: "Demo session" });
  });

  it("emits onChange when a duration chip is clicked", () => {
    const onChange = vi.fn();
    render(<SettingsPanel form={baseInput} onChange={onChange} location="meet" />);
    fireEvent.click(screen.getByRole("radio", { name: "45分" }));
    expect(onChange).toHaveBeenCalledWith({ durationMinutes: 45 });
  });

  it("renders all three location options with non-meet options disabled (MVP)", () => {
    render(<Controlled />);
    const meet = screen.getByRole("radio", { name: "Google Meet" });
    const inPerson = screen.getByRole("radio", { name: "対面 / 場所を指定" });
    const custom = screen.getByRole("radio", { name: "カスタムURL (Zoom等)" });

    expect(meet).toBeInTheDocument();
    expect(inPerson).toBeInTheDocument();
    expect(custom).toBeInTheDocument();

    expect(meet).not.toBeDisabled();
    expect(inPerson).toBeDisabled();
    expect(custom).toBeDisabled();

    // Disabled options must not become selected when clicked.
    fireEvent.click(inPerson);
    expect(inPerson).not.toBeChecked();
    expect(meet).toBeChecked();
  });

  it("uses the new title placeholder", () => {
    render(<Controlled />);
    expect(screen.getByPlaceholderText("タイトルを入力してください")).toBeInTheDocument();
  });
});
