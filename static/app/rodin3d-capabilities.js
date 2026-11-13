// Match actual adapters; do not expose parameters the selected channel ignores.
export function capabilities(platform, channel) {
  if (platform === 'tripo' && channel === 'api') return {kinds:['image-to-model','multiview-to-model','mesh-decimate','model-convert'],faces:true,api:true};
  if (platform === 'hunyuan') return {kinds:['image-to-model','mesh-decimate'],faces:true,api:false};
  return {kinds:['image-to-model'],faces:false,api:false};
}
