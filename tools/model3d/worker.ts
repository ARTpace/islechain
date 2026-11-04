/** Art Canvas bridge. Provider implementations are vendored from ohmygame (Apache-2.0). */
import { readFile, writeFile } from 'node:fs/promises';
import { MeshyProvider } from './vendor/daemon/meshy-provider.js';
import { TripoProvider } from './vendor/daemon/tripo-provider.js';
import { Hyper3DProvider } from './vendor/daemon/hyper3d-provider.js';
import { model3DJournal } from './vendor/daemon/model3d-journal.js';
import { MODEL_3D_PRESETS, normalizeNativeModel3D } from './vendor/shared/model3d-presets.js';
import { protocolOperations } from './vendor/shared/model3d-operations.js';
import { inspectModel3D } from './vendor/daemon/model3d-inspect.js';

const emit = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
async function main() {
let text = ''; for await (const chunk of process.stdin) text += chunk;
try {
  const task = JSON.parse(text);
  if (task.command === 'catalog') {
    emit({result: Object.entries(MODEL_3D_PRESETS).map(([id, models]) => ({id, models, operations: protocolOperations(id as any)}))});
  } else if (task.command === 'validate') {
    emit({result: task.models.map((model: unknown) => normalizeNativeModel3D(task.protocol, model))});
  } else {
    const { connection, input = {} } = task;
    const protocol = connection.protocol;
    const settings = connection.settings;
    const available = connection.models ?? MODEL_3D_PRESETS[protocol as keyof typeof MODEL_3D_PRESETS];
    const definition = available.find((m: any) => m.id === task.model);
    if (!definition) throw new Error('所选 3D 模型版本不可用');
    const selected = normalizeNativeModel3D(protocol, definition);
    const Provider = ({meshy: MeshyProvider, tripo: TripoProvider, hyper3d: Hyper3DProvider} as any)[protocol];
    if (!Provider) throw new Error('不支持的 3D 服务协议');
    const request: typeof fetch = async (url, init) => {
      const response = await fetch(url, {...init, signal: init?.signal ?? AbortSignal.timeout(120_000)});
      // Never emit signed URLs, headers, keys, request bodies, or provider errors containing credentials.
      if (String(url).startsWith(connection.baseUrl) && init?.method === 'GET' && response.ok) {
        try {
          const body = await response.clone().json() as any;
          const state = body.data ?? body;
          if (typeof state.progress === 'number' || state.status) emit({progress: state.progress, status: String(state.status ?? '')});
        } catch { /* Non-JSON downloads are expected. */ }
      }
      return response;
    };
    const generator = new Provider(() => connection.apiKey, request, 2000, () => true,
      {...connection, settings: selected.settings});
    const model = {provider: protocol, id: task.model};
    let result;
    if (task.command === 'balance') result = await generator.accountBalance();
    else if (task.command === 'animations') {
      if (!generator.animations) throw new Error('此服务不支持动画');
      result = await generator.animations(undefined, model, input.options);
    } else {
      const journal = await model3DJournal(task.directory, task.recoveryId);
      const execution = {submitted: async (stage: string, scope: string, body: unknown, create: any) => {
        emit({stage}); return journal.submitted(stage, scope, body, create);
      }};
      const source = task.source ? await readFile(task.source) : undefined;
      const images = await Promise.all((task.images ?? []).map(async (image: any) => ({mediaType: image.mime, data: (await readFile(image.path)).toString('base64')})));
      const generated = task.command === 'animate'
        ? await generator.animate({...input, model: source, providerModel: model, execution})
        : await generator.generate({...input, source, images, model, execution}, undefined, selected.settings);
      const metadata = {...await inspectModel3D(generated.bytes), ...generated.metadata};
      if (task.command === 'animate' && !metadata.animations?.length) throw new Error('服务返回的 GLB 没有动画片段，未采用为动画结果');
      await writeFile(task.output, generated.bytes, {mode: 0o600});
      result = {metadata, requestId: generated.requestId};
    }
    emit({result});
  }
} catch (error: any) {
  // Python removes credentials again before persisting this diagnostic.
  emit({error: String(error?.message ?? error).slice(0, 1000), statusCode: error?.statusCode ?? 502});
  process.exitCode = 1;
}
}
void main();
