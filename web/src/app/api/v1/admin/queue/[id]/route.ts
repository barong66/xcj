import { NextRequest } from "next/server";
import { proxyToGoApi } from "@/lib/api-proxy";

export async function DELETE(req: NextRequest) {
  return proxyToGoApi(req);
}
