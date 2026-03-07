import { NextRequest, NextResponse } from "next/server";

function getAdminPassword(): string {
  const val = process.env.ADMIN_PASSWORD;
  if (!val) throw new Error("ADMIN_PASSWORD environment variable is required");
  return val;
}

function getAdminToken(): string {
  const val = process.env.ADMIN_TOKEN;
  if (!val) throw new Error("ADMIN_TOKEN environment variable is required");
  return val;
}

export async function POST(request: NextRequest) {
  const adminPassword = getAdminPassword();
  const adminToken = getAdminToken();

  const body = await request.json();
  const { password } = body;

  if (password !== adminPassword) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });

  response.cookies.set("admin_token", adminToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  // Non-httpOnly flag so frontend can check if user is logged in (no secret).
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
    httpOnly: true,
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
