import { NextResponse } from "next/server";
import { z } from "zod";
import { getPawlyUser } from "@/lib/auth";
import { listPetPhotos } from "@/lib/pet-photo-store";
import { createPet, listPets, updatePet, upsertUser } from "@/lib/profile-store";
import { assertSameOrigin, noStoreHeaders, SecurityError } from "@/lib/request-security";

export const runtime = "nodejs";

const petSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(40),
  species: z.enum(["dog", "cat"]),
  isPrimary: z.boolean().optional(),
  isMonitored: z.boolean().optional(),
});

export async function GET() {
  const user = await getPawlyUser();
  if (!user) return NextResponse.json({ error: "Sign in to view your Pawly profile" }, { status: 401, headers: noStoreHeaders() });
  await upsertUser(user.email, user.displayName);
  return NextResponse.json({ user, pets: await petsWithPhotos(user.email) }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to update your Pawly profile" }, { status: 401, headers: noStoreHeaders() });
    const parsed = petSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Enter a pet name and choose dog or cat" }, { status: 400, headers: noStoreHeaders() });
    await upsertUser(user.email, user.displayName);
    const pet = parsed.data.id
      ? await updatePet(user.email, parsed.data.id, parsed.data)
      : await createPet(user.email, parsed.data.name, parsed.data.species, {
        isPrimary: parsed.data.isPrimary,
        isMonitored: parsed.data.isMonitored,
      });
    if (!pet) return NextResponse.json({ error: "Pet not found" }, { status: 404, headers: noStoreHeaders() });
    const pets = await petsWithPhotos(user.email);
    return NextResponse.json({ pet: pets.find((item) => item.id === pet.id), pets }, { status: parsed.data.id ? 200 : 201, headers: noStoreHeaders() });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save pet" }, { status, headers: noStoreHeaders() });
  }
}

async function petsWithPhotos(ownerEmail: string) {
  const [pets, photos] = await Promise.all([listPets(ownerEmail), listPetPhotos(ownerEmail)]);
  return pets.map((pet) => ({
    ...pet,
    photos: photos
      .filter((photo) => photo.petId === pet.id)
      .map((photo) => ({
        id: photo.id,
        url: `/api/pets/${encodeURIComponent(pet.id)}/photos/${encodeURIComponent(photo.id)}`,
        createdAt: photo.createdAt,
      })),
  }));
}
