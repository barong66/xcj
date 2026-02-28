import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const PARSER_DIR =
  process.env.PARSER_DIR ||
  path.resolve(process.cwd(), "..", "parser");

export async function POST(req: NextRequest) {
  // Verify admin token
  const auth = req.headers.get("authorization");
  const token = process.env.ADMIN_TOKEN || "xcj-admin-2024";
  if (!auth || auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { keyword, count = 5, platform = "twitter" } = body;

    if (
      !keyword ||
      typeof keyword !== "string" ||
      keyword.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "keyword is required" },
        { status: 400 }
      );
    }

    const safeCount = Math.min(Math.max(1, Number(count) || 5), 20);

    if (platform !== "twitter") {
      return NextResponse.json(
        { error: "only twitter is supported for v1" },
        { status: 400 }
      );
    }

    const { stdout, stderr } = await execFileAsync(
      PYTHON_BIN,
      [
        "-m",
        "parser",
        "find",
        keyword.trim(),
        "--count",
        String(safeCount),
        "--platform",
        platform,
      ],
      {
        cwd: PARSER_DIR,
        timeout: 120_000, // 2 minute timeout
        env: { ...process.env },
      }
    );

    if (stderr) {
      console.warn("[finder] stderr:", stderr.slice(0, 500));
    }

    const result = JSON.parse(stdout);
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[finder] error:", err);

    const error = err as { killed?: boolean; message?: string };

    if (error.killed) {
      return NextResponse.json(
        { error: "Search timed out. Try a more specific keyword." },
        { status: 504 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Search failed" },
      { status: 500 }
    );
  }
}
