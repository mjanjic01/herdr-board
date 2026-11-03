// The line a run at a usage limit shows on its card and in the task window.
// Pure: no imports, so node --test can load it.
export function limitLine(limit, _name) {
  const until = limit?.until;
  return until ? `Usage limit reached · Claude continues at ${until}` : "Usage limit reached · Claude continues after the reset";
}
