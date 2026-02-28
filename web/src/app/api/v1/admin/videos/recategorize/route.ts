import { NextRequest } from "next/server";
import { proxyToGoApi } from "@/lib/api-proxy";

export async function POST(req: NextRequest) {
  return proxyToGoApi(req);
}
