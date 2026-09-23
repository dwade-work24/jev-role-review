import { requireScope, type AuthContext } from "../auth/context.js";
import { CandidateProfileMetadataOutputSchema, CandidateProfileOutputSchema, type CandidateProfileOutput } from "../domain/schemas.js";
import { ProfileNotFoundError, type ProfileStore } from "../profile/store.js";

export async function getCandidateProfile(
  context: AuthContext,
  profileStore: ProfileStore,
): Promise<CandidateProfileOutput> {
  requireScope(context, "profile:read");
  const record = await profileStore.getCurrent(context.subject);
  if (record === null) throw new ProfileNotFoundError();
  return CandidateProfileOutputSchema.parse(record);
}

export async function getCandidateProfileMetadata(
  context: AuthContext,
  profileStore: ProfileStore,
): Promise<Pick<CandidateProfileOutput, "version" | "sha256">> {
  requireScope(context, "profile:read");
  const pointer = await profileStore.getMetadata(context.subject);
  if (pointer === null) throw new ProfileNotFoundError();
  return CandidateProfileMetadataOutputSchema.parse(pointer);
}
