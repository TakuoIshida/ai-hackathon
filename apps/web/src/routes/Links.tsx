import * as stylex from "@stylexjs/stylex";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg },
  toolbar: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  empty: { textAlign: "center", padding: space.xl },
});

export default function Links() {
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.toolbar)}>
        <h1 {...stylex.props(styles.heading)}>リンク</h1>
        <Button>+ 新規リンク</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>まだリンクがありません</CardTitle>
          <CardDescription>新規リンクを作って公開URLを発行できます。</CardDescription>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.empty)}>—</div>
        </CardBody>
      </Card>
    </div>
  );
}
