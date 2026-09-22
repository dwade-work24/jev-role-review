import { requireScope, type AuthContext } from "../auth/context.js";
import { CandidateProfileOutputSchema, type CandidateProfileOutput } from "../domain/schemas.js";
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
