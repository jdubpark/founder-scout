import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { newId, type AddRecordingLinkInput, type Recording, type RecordingKind, type UploadRecordingInput } from "@agentswarm/shared";
import { findSensitive } from "../jobs";
import { ServiceError, type RecordingManager, type Store } from "../contracts";
import type { WebAddressCheck } from "../sources/web";

export interface RecordingServiceOptions {
  store: Store;
  dataDir: string;
  maxBytes: number;
  checkAddress(url: string): Promise<WebAddressCheck>;
  now?: () => Date;
}

const allowedKinds: readonly RecordingKind[] = ["talk", "interview", "call"];

function refuse(status: number, message: string, fields: Record<string, string> = {}): never {
  throw new ServiceError(status, message, fields);
}

function recordingPath(dataDir: string, id: string): string {
  return join(dataDir, "recordings", `${id}.media`);
}

export function createRecordingService(options: RecordingServiceOptions): RecordingManager {
  const now = options.now ?? (() => new Date());
  const founder = (id: string) => {
    const found = options.store.getFounder(id);
    if (!found) refuse(404, "Founder not found. Choose a founder that exists.");
    return found;
  };
  const checkedText = (input: { title: string; kind: RecordingKind }): { title: string; kind: RecordingKind } => {
    const title = typeof input?.title === "string" ? input.title.trim() : "";
    const kind = input?.kind;
    if (!title || title.length > 200) refuse(400, "Enter a recording title from 1 to 200 characters.", { title: "Enter a title from 1 to 200 characters." });
    if (!allowedKinds.includes(kind)) refuse(400, "Choose talk, interview, or call.", { kind: "Choose talk, interview, or call." });
    const personal = findSensitive(`${title} ${kind}`);
    if (personal.length) {
      const detail = `Recording title and kind cannot refer to personal attributes (${personal.join(", ")}). Describe the work or the company instead.`;
      refuse(400, detail, { title: `Remove the personal detail: ${personal.join(", ")}.` });
    }
    return { title, kind };
  };
  const audit = (actor: string, action: string, target: string, detail: Record<string, unknown>) => {
    options.store.audit({ actor: actor.trim() || "Partner", action, target, detail });
  };

  return {
    list(actor, founderId) {
      founder(founderId);
      const rows = options.store.listRecordingsByFounder(founderId);
      audit(actor, "recording.list", founderId, { count: rows.length });
      return rows;
    },
    async addLink(actor, founderId, input: AddRecordingLinkInput) {
      const owner = founder(founderId);
      const { title, kind } = checkedText(input);
      const source = typeof input.url === "string" ? input.url.trim() : "";
      if (!source || source.length > 500) refuse(400, "Enter a valid public audio or video address.", { url: "Enter a valid public address." });
      let checked: WebAddressCheck;
      try {
        checked = await options.checkAddress(source);
      } catch {
        refuse(400, "The recording address could not be resolved.", { url: "Enter a public address that resolves." });
      }
      if ("kind" in checked) refuse(400, checked.detail, { url: checked.detail });
      const at = now().toISOString();
      const recording: Recording = {
        id: newId("rcd"), swarmId: owner.swarmId, founderId, kind, title, sourceUrl: checked.url,
        addedBy: "person", status: "queued", detail: "", durationSec: null, transcript: null,
        createdAt: at, updatedAt: at,
      };
      options.store.insertRecording(recording);
      audit(actor, "recording.add", recording.id, { founderId, kind, source: "link" });
      return recording;
    },
    async upload(actor, founderId, input: UploadRecordingInput) {
      const owner = founder(founderId);
      const { title, kind } = checkedText(input);
      const contentType = typeof input.contentType === "string" ? input.contentType.split(";", 1)[0]!.trim().toLowerCase() : "";
      if (!/^(audio|video)\/[a-z0-9.+-]+$/u.test(contentType)) {
        refuse(400, "Choose an audio or video file.", { file: "Choose an audio or video file." });
      }
      const bytes = input.data instanceof Uint8Array ? input.data : new Uint8Array();
      if (bytes.byteLength === 0) refuse(400, "Choose a non-empty recording file.", { file: "Choose a non-empty file." });
      if (bytes.byteLength > options.maxBytes) refuse(413, "The recording is larger than the configured size limit.", { file: "The file is too large." });
      const at = now().toISOString();
      const id = newId("rcd");
      const path = recordingPath(options.dataDir, id);
      await mkdir(join(options.dataDir, "recordings"), { recursive: true });
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      const recording: Recording = {
        id, swarmId: owner.swarmId, founderId, kind, title, sourceUrl: null,
        addedBy: "person", status: "queued", detail: "", durationSec: null, transcript: null,
        createdAt: at, updatedAt: at,
      };
      try {
        options.store.insertRecording(recording);
      } catch (error) {
        await rm(path, { force: true });
        throw error;
      }
      audit(actor, "recording.add", recording.id, { founderId, kind, source: "upload", contentType });
      return recording;
    },
    async remove(actor, id) {
      const recording = options.store.getRecording(id);
      if (!recording) refuse(404, "Recording not found. Choose a recording that exists.");
      if (recording.addedBy === "person" && recording.sourceUrl === null) {
        await rm(recordingPath(options.dataDir, recording.id), { force: true });
      }
      options.store.deleteRecording(recording.id);
      audit(actor, "recording.remove", id, { founderId: recording.founderId, source: recording.sourceUrl === null ? "upload" : "link" });
    },
  };
}
