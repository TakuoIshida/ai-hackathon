import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@/components/ui/button";
import { colors, space } from "@/styles/tokens.stylex";

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

const styles = stylex.create({
  page: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.lg,
    padding: space.xl,
  },
  title: {
    fontSize: "2rem",
    fontWeight: 700,
    margin: 0,
  },
  subtitle: {
    color: colors.muted,
    margin: 0,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: space.md,
  },
  caption: {
    fontSize: "0.875rem",
    color: colors.muted,
  },
  notice: {
    color: "#b45309",
    fontSize: "0.875rem",
    maxWidth: "32rem",
    textAlign: "center",
  },
});

export default function App() {
  return (
    <main {...stylex.props(styles.page)}>
      <h1 {...stylex.props(styles.title)}>AI Hackathon</h1>
      <p {...stylex.props(styles.subtitle)}>
        Hono + React + Radix Primitives + StyleX + Drizzle + Clerk
      </p>

      {HAS_CLERK ? <AuthSection /> : <NoClerkNotice />}
    </main>
  );
}

function AuthSection() {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <Button>Sign in</Button>
        </SignInButton>
      </SignedOut>

      <SignedIn>
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.caption)}>Signed in</span>
          <UserButton />
        </div>
        <PingApi />
      </SignedIn>
    </>
  );
}

function NoClerkNotice() {
  return (
    <>
      <p {...stylex.props(styles.notice)}>
        Clerk is not configured. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code> in{" "}
        <code>apps/web/.env</code> and restart <code>bun run dev</code> to enable auth.
      </p>
      <PingApi />
    </>
  );
}

function PingApi() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
  return (
    <Button
      variant="outline"
      onClick={async () => {
        const res = await fetch(`${apiUrl}/health`);
        const json = await res.json();
        alert(JSON.stringify(json));
      }}
    >
      Ping API
    </Button>
  );
}
