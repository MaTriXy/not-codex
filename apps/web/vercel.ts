import { matchers, routes, type Transform, type VercelConfig } from "@vercel/config/v1";

const ROUTER_HOST = "app.notcodex.bpro.dev";
const HOSTED_WEB_CHANNEL_COOKIE = "notcodex_web_channel";
const LATEST_ORIGIN = "https://latest.app.notcodex.bpro.dev";
const NIGHTLY_ORIGIN = "https://nightly.app.notcodex.bpro.dev";
const CLEAN_CHANNEL_QUERY_TRANSFORMS = [
  {
    type: "request.query",
    op: "delete",
    target: { key: "channel" },
  },
] satisfies Transform[];

function channelCookie(channel: "latest" | "nightly"): string {
  return [
    `${HOSTED_WEB_CHANNEL_COOKIE}=${channel}`,
    "Path=/",
    "Max-Age=31536000",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export const config: VercelConfig = {
  buildCommand:
    'vp run --filter @notcodex/web build && node ../../scripts/apply-web-brand-assets.ts --channel "${VITE_HOSTED_APP_CHANNEL:-latest}"',
  git: {
    deploymentEnabled: false,
  },
  headers: [
    {
      source: "/(.*)",
      headers: [
        {
          key: "Content-Security-Policy",
          value:
            "default-src 'self'; base-uri 'self'; connect-src 'self' http: https: ws: wss:; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; worker-src 'self' blob:",
        },
        { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
        { key: "Referrer-Policy", value: "no-referrer" },
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    },
  ],
  installCommand:
    "npm install -g vite-plus && vp install --filter '@notcodex/scripts...' --filter '@notcodex/web...'",
  routes: [
    {
      src: "/__notcodex/channel",
      has: [matchers.query("channel", "nightly")],
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("nightly"),
      },
      status: 302,
    },
    {
      src: "/__notcodex/channel",
      transforms: CLEAN_CHANNEL_QUERY_TRANSFORMS,
      headers: {
        Location: "/",
        "Set-Cookie": channelCookie("latest"),
      },
      status: 302,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST), matchers.cookie(HOSTED_WEB_CHANNEL_COOKIE, "nightly")],
      dest: `${NIGHTLY_ORIGIN}/$1`,
    },
    {
      src: "/(.*)",
      has: [matchers.host(ROUTER_HOST)],
      dest: `${LATEST_ORIGIN}/$1`,
    },
  ],
  rewrites: [routes.rewrite("/(.*)", "/index.html")],
};
