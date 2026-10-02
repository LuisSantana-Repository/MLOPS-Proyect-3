import { NextResponse } from "next/server";
import { type AnnotationSubmission, sendToAnnotationSchema } from "@/contracts";
import { sendToAnnotation } from "@/lib/annotation-portal";
import { badRequest, handleRouteError, parseOrThrow } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/annotation
 * Envía una imagen clasificada en Inference al flujo de anotación del portal: queda
 * registrada como `pending`, con la clase sugerida y las probabilidades del modelo.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const raw = await request.json().catch(() => {
      throw badRequest("El cuerpo debe ser JSON");
    });
    const input = parseOrThrow(sendToAnnotationSchema, raw, "Envío a anotación");
    const submission: AnnotationSubmission = await sendToAnnotation(input);
    return NextResponse.json(submission, { status: 201 });
  } catch (err) {
    return handleRouteError(err);
  }
}
