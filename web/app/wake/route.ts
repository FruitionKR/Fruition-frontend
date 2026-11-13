import { NextResponse } from "next/server";
import { readWakePhase, requestWake } from "./requestWake";

export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST() {
  await requestWake();
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

export async function GET() {
  const phase = await readWakePhase();
  return NextResponse.json({ phase }, { headers: NO_STORE });
}
