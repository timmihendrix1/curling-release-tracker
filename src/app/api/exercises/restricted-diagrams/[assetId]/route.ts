import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
  type ClosedBetaExerciseAssetId,
  isClosedBetaExerciseAssetId,
} from "../../../../../lib/exercises/restrictedAssetCatalog";
import { resolveUserScopedSupabaseContext } from "../../../_lib/userScopedSupabaseContext";
import { isCanonicalUuid } from "../../../../../lib/uuid";

const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "Content-Type": "image/png",
  "X-Content-Type-Options": "nosniff",
} as const;

const ASSET_FILES: Readonly<Record<ClosedBetaExerciseAssetId, string>> = {
  [SWISS_CURLING_GUARD_10_ASSET_ID]:
    "swiss-curling-guard-exercise-10-v2.png",
  [SWISS_CURLING_DRAW_6_ASSET_ID]:
    "swiss-curling-draw-exercise-6-v2.png",
  [SWISS_CURLING_SOFTSHOT_5_ASSET_ID]:
    "swiss-curling-softshot-exercise-5-v2.png",
};

function unavailable(status: 401 | 403 | 404 | 500): NextResponse {
  return NextResponse.json(
    { error: "Restricted diagram unavailable." },
    { status, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

export function resolveClosedBetaExerciseTeamId(
  value: string | undefined = process.env.CLOSED_BETA_EXERCISE_ASSET_TEAM_ID
): string | null {
  const normalized = (value ?? "").trim();
  return isCanonicalUuid(normalized) ? normalized : null;
}

/**
 * Authenticated delivery for the three closed-beta diagrams. Asset identity is
 * selected from a fixed map and is never joined into a filesystem path.
 * Authorization is proven by a user-scoped RLS query for an active membership
 * in the one configured Team; a service-role key is neither needed nor used.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> }
): Promise<NextResponse> {
  const { assetId } = await context.params;
  if (!isClosedBetaExerciseAssetId(assetId)) return unavailable(404);

  const teamId = resolveClosedBetaExerciseTeamId();
  if (teamId === null) return unavailable(404);

  const routeContext = resolveUserScopedSupabaseContext(request);
  if (!routeContext.ok) {
    return unavailable(routeContext.reason === "unauthenticated" ? 401 : 500);
  }

  try {
    const { data, error } = await routeContext.client
      .from("team_memberships")
      .select("id")
      .eq("team_id", teamId)
      .eq("status", "active")
      .limit(1);

    if (error || !Array.isArray(data) || data.length === 0) {
      return unavailable(403);
    }

    const fileName = ASSET_FILES[assetId];
    const bytes = await readFile(
      path.join(process.cwd(), "restricted-assets", "exercises", fileName)
    );

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: PRIVATE_CACHE_HEADERS,
    });
  } catch {
    return unavailable(500);
  }
}
