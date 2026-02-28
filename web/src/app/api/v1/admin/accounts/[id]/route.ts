import { NextRequest } from "next/server";
import { proxyToGoApi } from "@/lib/api-proxy";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToGoApi(req, `/api/v1/admin/accounts/${id}`);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyToGoApi(req, `/api/v1/admin/accounts/${id}`);
}
