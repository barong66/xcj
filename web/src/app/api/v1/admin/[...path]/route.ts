import { NextRequest } from "next/server";
import { proxyToGoApi } from "@/lib/api-proxy";

export async function GET(req: NextRequest) {
  return proxyToGoApi(req);
}

export async function POST(req: NextRequest) {
  return proxyToGoApi(req);
}

export async function PUT(req: NextRequest) {
  return proxyToGoApi(req);
}

export async function DELETE(req: NextRequest) {
  return proxyToGoApi(req);
}
