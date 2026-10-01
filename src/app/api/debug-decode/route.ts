import { NextResponse } from "next/server";
import { decodeScanResult } from "@/lib/scan-share";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  const result = decodeScanResult(id);
  return NextResponse.json({
    idLength: id.length,
    decoded: !!result,
    score: result?.healthScore ?? null,
  });
}
