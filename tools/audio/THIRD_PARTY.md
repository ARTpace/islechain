# Audio adapter sources and licenses

Provider adapters under vendor/ are copied without protocol changes from WhiteTowerAI/ohmygame (Apache-2.0); see LICENSE. The local worker.ts supplies the host connection, model selection and durable single-submission marker. Type-only contracts imports are removed by esbuild, not executed.

The bundle includes mediabunny 1.61.3 by Vanilagy (MPL-2.0), unchanged. License: mediabunny-LICENSE.txt. Corresponding source: https://github.com/Vanilagy/mediabunny/tree/v1.61.3 and https://registry.npmjs.org/mediabunny/-/mediabunny-1.61.3.tgz . The pinned package-lock.json and `npm ci` reproduce the original package including source. esbuild 0.25.11 is build-only (MIT).

Rebuild: npm ci && npm run build in tools/audio. Node.js 20+ is required at runtime; credentials arrive only via stdin and are never bundled.
