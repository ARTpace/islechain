# ohmygame 3D adapter reuse

The TypeScript modules in `vendor/` were copied from WhiteTowerAI/ohmygame,
commit `c30bfabda86c27084128deca5bc4bd0d4e9983eb` (Apache-2.0).
They preserve the original provider protocols, operation defaults, model catalog,
GLB inspection, multi-request animation merge, and durable paid-submission journal.
The original license is in `licenses/ohmygame-LICENSE.txt`.

`worker.ts` is the Art Canvas bridge. `worker.cjs` bundles the runtime; it does not
read or import the neighboring ohmygame checkout. Node.js 20+ is required. No npm
install is required to run the shipped bundle. To rebuild: run `npm ci` and
`npm run build` in this directory. Dependencies are locked in package-lock.json.

Bundled MIT dependencies: @gltf-transform/core 4.5.1,
@gltf-transform/extensions 4.5.1, property-graph 4.1.0, ktx-parse 1.1.0.
Their notices are retained in `licenses/`.

Adaptations: project authorization and private connections are handled by Python;
inputs are frozen to owned project files; stdout contains only task progress,
metadata and a bounded diagnostic. Provider credentials are passed on stdin.
Worker journals remain private and are excluded from portable backups.

`importer.mjs` is the browser-local GLB/glTF/FBX/OBJ/STL/PLY import bridge,
using pinned three.js 0.180.0 loaders and GLTFExporter (MIT; see
`licenses/three-LICENSE.txt`). Rebuild `static/js/game-model-import.js` with
`npm run build:importer`. Conversion resolves only supplied companion files
or embedded data; it does not fetch model-specified network URLs.
