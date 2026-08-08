import { NextResponse } from "next/server";
import { getPawlyUser } from "@/lib/auth";
import { deleteAllPetPhotos, listPetPhotos } from "@/lib/pet-photo-store";
import { deletePet, getPetForOwner, listPets } from "@/lib/profile-store";
import { assertSameOrigin, noStoreHeaders, SecurityError } from "@/lib/request-security";

export const runtime = "nodejs";

export async function DELETE(request: Request, context: { params: Promise<{ petId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await getPawlyUser();
    if (!user) return NextResponse.json({ error: "Sign in to remove a pet" }, { status: 401, headers: noStoreHeaders() });
    const { petId } = await context.params;
    const pet = await getPetForOwner(user.email, petId);
    if (!pet) return NextResponse.json({ error: "Pet not found" }, { status: 404, headers: noStoreHeaders() });
    await deleteAllPetPhotos(user.email, petId);
    if (!await deletePet(user.email, petId)) {
      return NextResponse.json({ error: "Pet not found" }, { status: 404, headers: noStoreHeaders() });
    }
    const [pets, photos] = await Promise.all([listPets(user.email), listPetPhotos(user.email)]);
    return NextResponse.json({
      deletedPetId: petId,
      pets: pets.map((savedPet) => ({
        ...savedPet,
        photos: photos.filter((photo) => photo.petId === savedPet.id).map((photo) => ({
          id: photo.id,
          url: `/api/pets/${encodeURIComponent(savedPet.id)}/photos/${encodeURIComponent(photo.id)}`,
          createdAt: photo.createdAt,
        })),
      })),
    }, { headers: noStoreHeaders() });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not remove this pet" }, { status, headers: noStoreHeaders() });
  }
}
