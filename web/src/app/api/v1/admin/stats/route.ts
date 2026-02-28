import { NextRequest } from "next/server";
import { proxyToGoApi } from "@/lib/api-proxy";

export async function GET(req: NextRequest) {
  return proxyToGoApi(req);
}
