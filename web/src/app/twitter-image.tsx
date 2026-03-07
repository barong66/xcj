import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "TemptGuide - Trending Videos from Twitter & Instagram";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #0f0f0f 0%, #1a1a2e 50%, #16213e 100%)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <path
              d="M5 3l14 9-14 9V3z"
              fill="#e040fb"
            />
          </svg>
          <span
            style={{
              fontSize: "72px",
              fontWeight: 800,
              color: "#ffffff",
              letterSpacing: "-2px",
            }}
          >
            TemptGuide
          </span>
        </div>
        <span
          style={{
            fontSize: "28px",
            color: "#a0a0b0",
            fontWeight: 400,
          }}
        >
          Trending Videos from Twitter & Instagram
        </span>
      </div>
    ),
    { ...size }
  );
}
