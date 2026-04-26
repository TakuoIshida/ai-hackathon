import * as stylex from "@stylexjs/stylex";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { space } from "@/styles/tokens.stylex";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.lg, maxWidth: "48rem" },
  heading: { fontSize: "1.5rem", fontWeight: 600, margin: 0 },
});

export default function DashboardHome() {
  return (
    <div {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.heading)}>ダッシュボード</h1>
      <Card>
        <CardHeader>
          <CardTitle>はじめに</CardTitle>
          <CardDescription>
            Google Calendar を連携して、最初のリンクを発行しましょう。
          </CardDescription>
        </CardHeader>
        <CardBody>
          <p>連携が完了すると、空き時間が自動で計算されます。</p>
        </CardBody>
        <CardFooter>
          <Button asChild variant="outline">
            <Link to="/dashboard/settings">Google を連携</Link>
          </Button>
          <Button asChild>
            <Link to="/dashboard/links">リンクを作成</Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
