import * as stylex from "@stylexjs/stylex";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "48rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
});

export default function Calendar() {
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>カレンダー</h1>
      <Card>
        <CardHeader>
          <CardTitle>準備中</CardTitle>
          <CardDescription>カレンダー画面は別のリリースで実装予定です。</CardDescription>
        </CardHeader>
        <CardBody>
          <p>
            Google Calendar の予定 + 自身の confirmed bookings を週ビュー /
            月ビューで重ねて表示する画面を予定しています。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
