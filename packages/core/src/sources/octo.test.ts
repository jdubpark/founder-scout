import { describe, expect, it } from "vitest";
import { createOctoLocalClient, octoProfileUuidsFromEnv, OctoProfileAlreadyStarted } from "./octo";

const started = JSON.stringify({
  uuid: "profile-one",
  state: "STARTED",
  ws_endpoint: "ws://127.0.0.1:54739/devtools/browser/4d05ab38-20bf-45e6-b463-6bc643028107",
  debug_port: "54739",
});

function client(fetch: (url: string, init?: RequestInit) => Promise<Response>) {
  return createOctoLocalClient({ baseUrl: "http://octo.test:58888", fetch });
}

describe("createOctoLocalClient", () => {
  it("starts a profile with a visible window and a local debug endpoint", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const local = client(async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(started);
    });
    const profile = await local.startProfile("profile-one");
    expect(profile).toEqual({ uuid: "profile-one", wsEndpoint: "ws://127.0.0.1:54739/devtools/browser/4d05ab38-20bf-45e6-b463-6bc643028107" });
    expect(calls).toEqual([{ url: "http://octo.test:58888/api/profiles/start", body: { uuid: "profile-one", headless: false, debug_port: true, only_local: true, timeout: 60 } }]);
  });

  it("lists the running profiles, without an endpoint for one that has none", async () => {
    const local = client(async (url) => {
      expect(url).toBe("http://octo.test:58888/api/profiles/active");
      return new Response(JSON.stringify([
        { uuid: "profile-one", state: "STARTED", ws_endpoint: "ws://127.0.0.1:1/devtools/browser/one", headless: true },
        { uuid: "profile-two", state: "STARTED", ws_endpoint: null },
        { state: "STARTED" },
      ]));
    });
    await expect(local.activeProfiles()).resolves.toEqual([
      { uuid: "profile-one", state: "STARTED", wsEndpoint: "ws://127.0.0.1:1/devtools/browser/one" },
      { uuid: "profile-two", state: "STARTED", wsEndpoint: null },
    ]);
  });

  it("reports a profile that is already running as a workable error, and other answers plainly", async () => {
    const local = client(async (url, init) => {
      if (!url.endsWith("/start")) return new Response("[]");
      const uuid = (JSON.parse(String(init?.body ?? "{}")) as { uuid?: string }).uuid ?? "";
      return uuid === "profile-one"
        ? new Response(JSON.stringify({ code: "profiles.already_started", error: "Profile is already started", error_code: 2 }), { status: 400 })
        : new Response(JSON.stringify({ code: "profiles.not_found", error: "Profile not found", error_code: 6 }), { status: 400 });
    });
    await expect(local.startProfile("profile-one")).rejects.toBeInstanceOf(OctoProfileAlreadyStarted);
    await expect(local.startProfile("profile-gone")).rejects.toThrow("Octo Browser answered: Profile not found");
  });

  it("says the app could not be reached when the request fails", async () => {
    const local = client(async () => { throw new Error("connect ECONNREFUSED"); });
    await expect(local.activeProfiles()).rejects.toThrow("The Octo Browser app could not be reached");
  });

  it("stops a profile", async () => {
    const calls: string[] = [];
    const local = client(async (url, init) => {
      calls.push(`${init?.method} ${url} ${String(init?.body ?? "")}`);
      return new Response(JSON.stringify({ msg: "Profile stopped" }));
    });
    await local.stopProfile("profile-one");
    expect(calls).toEqual(["POST http://octo.test:58888/api/profiles/stop {\"uuid\":\"profile-one\"}"]);
  });
});

describe("octoProfileUuidsFromEnv", () => {
  it("reads one UUID per line, aligned to the accounts by index", () => {
    expect(octoProfileUuidsFromEnv({ OCTO_PROFILE_UUIDS: " one \n\n2bbfd1dbaf3349cf979787f15a9e413d\n" })).toEqual([
      "one",
      "2bbfd1dbaf3349cf979787f15a9e413d",
    ]);
    expect(octoProfileUuidsFromEnv({})).toEqual([]);
  });
});
