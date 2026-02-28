import { NextRequest, NextResponse } from "next/server";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "xcj2024";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "xcj-admin-2024";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { password } = body;

  if (password !== ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true, token: ADMIN_TOKEN });

  response.cookies.set("admin_token", ADMIN_TOKEN, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  response.cookies.set("admin_authed", "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });

  response.cookies.set("admin_token", "", {
    httpOnly: false,
    path: "/",
    maxAge: 0,
  });

  response.cookies.set("admin_authed", "", {
    httpOnly: false,
    path: "/",
    maxAge: 0,
  });

  return response;
}
