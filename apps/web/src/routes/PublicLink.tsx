import * as stylex from "@stylexjs/stylex";
import { useParams } from "react-router-dom";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  heading: { fontSize: "1.75rem", fontWeight: 700, margin: 0 },
});

export default function PublicLink() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>{slug ?? "リンク"}</h1>
      <Card>
        <CardHeader>
          <CardTitle>日時を選択してください</CardTitle>
          <CardDescription>カレンダーから空きスロットを選んで予約できます。</CardDescription>
        </CardHeader>
        <CardBody>—（カレンダー UI は後続 issue ISH-84/85 で実装）</CardBody>
      </Card>
    </div>
  );
}
