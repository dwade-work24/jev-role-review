import { sha256Json } from "../domain/json.js";
import { CandidateProfileOutputSchema, type JsonObject } from "../domain/schemas.js";

export interface ProfileRecord {
  readonly version: string;
  readonly sha256: string;
  readonly profile: JsonObject;
}

export interface ProfileStore {
  getCurrent(subject: string): Promise<ProfileRecord | null>;
}

export class ProfileNotFoundError extends Error {
  constructor() {
    super("No candidate profile is configured for this account");
    this.name = "ProfileNotFoundError";
  }
}

export class ProfileVersionMismatchError extends Error {
  constructor() {
    super("The requested profile version is not current");
    this.name = "ProfileVersionMismatchError";
  }
}

export class InMemoryProfileStore implements ProfileStore {
  readonly #records = new Map<string, ProfileRecord>();

  async put(subject: string, version: string, profile: JsonObject): Promise<ProfileRecord> {
    const record = CandidateProfileOutputSchema.parse({
      version,
      sha256: await sha256Json(profile),
      profile,
    });
    this.#records.set(subject, record);
    return record;
  }

  async getCurrent(subject: string): Promise<ProfileRecord | null> {
    return this.#records.get(subject) ?? null;
  }
}
