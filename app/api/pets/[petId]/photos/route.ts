import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { listPetPhotos, savePetPhoto } from "@/lib/pet-photo-store";
import { getPetForOwner } from "@/lib/profile-store";
import { assertSameOrigin, noStoreHeaders, SecurityError } from "@/lib/request-security";
import { consumeRateLimit } from "@/lib/security-store";

export const runtime = "nodejs";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumFileBytes = 5 * 1024 * 1024;
const maximumPhotos = 5;

export async function POST(request: Request, context: { params: Promise<{ petId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to upload pet photos" }, { status: 401, headers: noStoreHeaders() });
    if (!await consumeRateLimit(`pet-photo:${user.email}`, 30, 60 * 60 * 1000)) {
      return NextResponse.json({ error: "Too many photo uploads. Try again later." }, { status: 429, headers: noStoreHeaders() });
    }

    const petId = (await context.params).petId;
    const pet = await getPetForOwner(user.email, petId);
    if (!pet) return NextResponse.json({ error: "Pet not found" }, { status: 404, headers: noStoreHeaders() });

    const form = await request.formData();
    const files = form.getAll("photos").filter((entry): entry is File => entry instanceof File && entry.size > 0);
    const existing = await listPetPhotos(user.email, petId);
    if (files.length === 0) return NextResponse.json({ error: "Choose at least one photo" }, { status: 400, headers: noStoreHeaders() });
    if (files.length + existing.length > maximumPhotos) {
      return NextResponse.json({ error: `You can save up to ${maximumPhotos} reference photos per pet` }, { status: 400, headers: noStoreHeaders() });
    }
    for (const file of files) {
      if (!acceptedTypes.has(file.type)) {
        return NextResponse.json({ error: "Use JPG, PNG, or WebP photos" }, { status: 400, headers: noStoreHeaders() });
      }
      if (file.size > maximumFileBytes) {
        return NextResponse.json({ error: "Each photo must be 5 MB or smaller" }, { status: 400, headers: noStoreHeaders() });
      }
    }

    const saved = [];
    for (const file of files) saved.push(await savePetPhoto(user.email, petId, file));
    const photos = [...existing, ...saved].map((photo) => ({
      id: photo.id,
      url: `/api/pets/${encodeURIComponent(petId)}/photos/${encodeURIComponent(photo.id)}`,
      createdAt: photo.createdAt,
    }));
    return NextResponse.json({ photos }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not upload pet photos" }, { status, headers: noStoreHeaders() });
  }
}
