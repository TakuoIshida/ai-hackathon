import { describe, expect, test } from "bun:test";
import { createResendSender, loadResendConfig } from "./sender";

const validKey = "re_validkey";

describe("loadResendConfig", () => {
  test("returns null when env is missing", () => {
    expect(loadResendConfig({} as NodeJS.ProcessEnv)).toBeNull();
    expect(loadResendConfig({ RESEND_API_KEY: validKey } as NodeJS.ProcessEnv)).toBeNull();
    expect(loadResendConfig({ EMAIL_FROM: "x@y.z" } as NodeJS.ProcessEnv)).toBeNull();
  });
  test("returns config when both vars are set", () => {
    const cfg = loadResendConfig({
      RESEND_API_KEY: validKey,
      EMAIL_FROM: "noreply@example.com",
    } as NodeJS.ProcessEnv);
    expect(cfg).toEqual({ apiKey: validKey, from: "noreply@example.com" });
  });
});

describe("createResendSender", () => {
  test("posts to Resend with Bearer auth and the right body", async () => {
    let receivedUrl = "";
    let receivedInit: RequestInit | undefined;
    const fakeFetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      receivedUrl = typeof url === "string" ? url : (url as URL | Request).toString();
      receivedInit = init;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const send = createResendSender({ apiKey: validKey, from: "from@x.com" }, fakeFetch);
    await send({
      to: "guest@x.com",
      subject: "予約が確定しました",
      html: "<p>hello</p>",
      text: "hello",
    });

    expect(receivedUrl).toBe("https://api.resend.com/emails");
    expect((receivedInit?.headers as Record<string, string>).Authorization).toBe(
      "Bearer re_validkey",
    );
    const body = JSON.parse(String(receivedInit?.body));
    expect(body.from).toBe("from@x.com");
    expect(body.to).toEqual(["guest@x.com"]);
    expect(body.subject).toBe("予約が確定しました");
    expect(body.html).toBe("<p>hello</p>");
    expect(body.text).toBe("hello");
  });

  test("throws when Resend returns non-2xx", async () => {
    const fakeFetch = (async () =>
      new Response("invalid api key", { status: 401 })) as unknown as typeof fetch;
    const send = createResendSender({ apiKey: "bad", from: "f@x.com" }, fakeFetch);
    await expect(send({ to: "g@x.com", subject: "s", html: "h", text: "t" })).rejects.toThrow(
      /401/,
    );
  });
});
