// bun-manifest-metadata-probe — minimal stub
// Exercises D6 (engines.bun/node), D7 (private:true), D8 (bundleDependencies), D9 (workspaces.nohoist)
// All four are top-level package.json metadata fields with no effect on dependency edges.

import { Hono } from "hono";
import isOdd from "is-odd";

const app = new Hono();

app.get("/", (c) => {
  // is-odd is listed in bundleDependencies — it is tar-bundled on publish
  // but behaves identically at runtime.
  const result = isOdd(3);
  return c.json({ bundled_dep_works: result, probe: "bun-manifest-metadata-probe" });
});

export default app;
