import * as stylex from "@stylexjs/stylex";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "32rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
  field: { display: "flex", flexDirection: "column", gap: space.xs },
});

export default function Settings() {
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>設定</h1>

      <Card>
        <CardHeader>
          <CardTitle>Google Workspace 連携</CardTitle>
          <CardDescription>
            Calendar の空き時間取得と、Meet URL 自動発行に利用します。
          </CardDescription>
        </CardHeader>
        <CardBody>
          <Button variant="outline">Google アカウントを連携</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>プロフィール</CardTitle>
        </CardHeader>
        <CardBody>
          <div {...stylex.props(styles.field)}>
            <Label htmlFor="tz">タイムゾーン</Label>
            <Input id="tz" defaultValue="Asia/Tokyo" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
