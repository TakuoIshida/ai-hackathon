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
  rangeDays: 60,
  timeZone: "Asia/Tokyo",
  rules: [],
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

  it("renders all three location options and lets you switch", () => {
    render(<Controlled />);
    expect(screen.getByRole("radio", { name: "Google Meet" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "対面 / 場所を指定" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "カスタムURL (Zoom等)" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "対面 / 場所を指定" }));
    expect(screen.getByRole("radio", { name: "対面 / 場所を指定" })).toBeChecked();
  });
});
