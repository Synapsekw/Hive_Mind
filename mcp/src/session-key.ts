// The key that ties this process's writes into one session in the hive. The
// database reads it from this request header and tags every note and file
// the agent writes with the session it names. One key per process: one Claude
// Code conversation is one session until hive_end_session closes it. Imports
// nothing, so the tests load it from source.
export const SESSION_HEADER = "x-hive-session";

let key: string | undefined;

export function sessionKey(): string {
  key ??= crypto.randomUUID();
  return key;
}
