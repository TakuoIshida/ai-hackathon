import * as stylex from "@stylexjs/stylex";
import { useParams } from "react-router-dom";
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
  page: { display: "flex", flexDirection: "column", gap: space.lg },
});

export default function CancelBooking() {
  const { token } = useParams<{ token: string }>();
  return (
    <div {...stylex.props(styles.page)}>
      <Card>
        <CardHeader>
          <CardTitle>予約をキャンセルしますか？</CardTitle>
          <CardDescription>このリンクから予約を取り消せます。</CardDescription>
        </CardHeader>
        <CardBody>
          <p>
            キャンセルトークン: <code>{token}</code>
          </p>
        </CardBody>
        <CardFooter>
          <Button variant="destructive">キャンセル確定</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
