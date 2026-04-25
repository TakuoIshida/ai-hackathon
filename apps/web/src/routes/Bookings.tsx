import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  tabs: { display: "flex", gap: space.sm },
});

type Tab = "upcoming" | "past";

export default function Bookings() {
  const [tab, setTab] = useState<Tab>("upcoming");
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>予約</h1>
      <div {...stylex.props(styles.tabs)}>
        <Button
          variant={tab === "upcoming" ? "default" : "outline"}
          onClick={() => setTab("upcoming")}
        >
          未来
        </Button>
        <Button variant={tab === "past" ? "default" : "outline"} onClick={() => setTab("past")}>
          過去
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{tab === "upcoming" ? "未来の予約" : "過去の予約"}</CardTitle>
          <CardDescription>確定済みの予約がここに表示されます。</CardDescription>
        </CardHeader>
        <CardBody>—</CardBody>
      </Card>
    </div>
  );
}
