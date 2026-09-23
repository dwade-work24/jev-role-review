import { sha256Json } from "../domain/json.js";
import { CandidateProfileOutputSchema, type JsonObject } from "../domain/schemas.js";
import { z } from "zod";

export interface ProfileRecord {
  readonly version: string;
  readonly sha256: string;
  readonly profile: JsonObject;
}

export interface ProfileStore {
  getCurrent(subject: string): Promise<ProfileRecord | null>;
  getMetadata(subject: string): Promise<Pick<ProfileRecord, "version" | "sha256"> | null>;
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

export class ProfileStoreIntegrityError extends Error {
  constructor() {
    super("The stored candidate profile failed its integrity check");
    this.name = "ProfileStoreIntegrityError";
  }
}

export interface KvProfileNamespace {
  get(key: string, options: { type: "json" }): Promise<unknown>;
}

const CurrentProfilePointerSchema = z.object({
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export function profileKey(subject: string, sha256: string): string {
  return `profiles/${encodeURIComponent(subject)}/${sha256}.json`;
}

export function currentProfileKey(subject: string): string {
  return `profiles/${encodeURIComponent(subject)}/current`;
}

export class CloudflareKvProfileStore implements ProfileStore {
  constructor(private readonly namespace: KvProfileNamespace) {}

  async getMetadata(subject: string): Promise<Pick<ProfileRecord, "version" | "sha256"> | null> {
    const rawPointer = await this.namespace.get(currentProfileKey(subject), { type: "json" });
    if (rawPointer === null) return null;
    const pointer = CurrentProfilePointerSchema.safeParse(rawPointer);
    if (!pointer.success) throw new ProfileStoreIntegrityError();
    return pointer.data;
  }

  async getCurrent(subject: string): Promise<ProfileRecord | null> {
    const pointer = await this.getMetadata(subject);
    if (pointer === null) return null;
    const rawRecord = await this.namespace.get(profileKey(subject, pointer.sha256), {
      type: "json",
    });
    const record = CandidateProfileOutputSchema.safeParse(rawRecord);
    if (
      !record.success
      || record.data.version !== pointer.version
      || record.data.sha256 !== pointer.sha256
      || await sha256Json(record.data.profile) !== record.data.sha256
    ) {
      throw new ProfileStoreIntegrityError();
    }
    return record.data;
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

  async getMetadata(subject: string): Promise<Pick<ProfileRecord, "version" | "sha256"> | null> {
    const record = this.#records.get(subject);
    return record === undefined ? null : { version: record.version, sha256: record.sha256 };
  }
}
