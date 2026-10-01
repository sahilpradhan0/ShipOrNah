import { NextResponse } from "next/server";
import { decodeScanResult } from "@/lib/scan-share";

interface RouteProps {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteProps) {
  const { id } = await params;
  const result = decodeScanResult(id);
  return NextResponse.json({
    idLength: id.length,
    idSample: id.slice(0, 40),
    decoded: !!result,
    score: result?.healthScore ?? null,
  });
}
