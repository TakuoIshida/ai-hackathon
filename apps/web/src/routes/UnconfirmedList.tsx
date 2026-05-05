import * as stylex from "@stylexjs/stylex";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "48rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
});

export default function UnconfirmedList() {
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>未確定の調整</h1>
      <Card>
        <CardHeader>
          <CardTitle>準備中</CardTitle>
          <CardDescription>未確定の調整一覧は別のリリースで実装予定です。</CardDescription>
        </CardHeader>
        <CardBody>
          <p>
            ゲストが確定操作を未完了の booking (pending / awaiting_response)
            と、投票調整中のリンクを一覧する画面を予定しています。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
