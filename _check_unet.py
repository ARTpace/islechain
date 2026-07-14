import json, os

base = 'workflows/text2image'
BS = chr(92)  # backslash

server_list = [
    'Bernini_HIGH_Q4_0.gguf',
    'Klein' + BS + 'flux-2-klein-9b_int8_convrot.safetensors',
    'Krea2' + BS + 'krea2_turbo_fp8_scaled.safetensors',
    'Krea2' + BS + 'krea2_turbo_int8_convrot.safetensors',
    'Krea2' + BS + 'redcraftKREA2RedMix_krea2Edition.safetensors',
    'anima' + BS + 'BASNSFWBetterAnimeStyleForNSFWHentai_baseV10.safetensors',
    'anima' + BS + 'anima_baseV10.safetensors',
    'boogu' + BS + 'base' + BS + 'booguCenterV01_v10.safetensors',
    'boogu' + BS + 'edit' + BS + 'boogu_image_edit_fp8_scaled.safetensors',
    'boogu' + BS + 'turbo' + BS + 'booguImageTurboInt8_hotfix.safetensors',
    'ideogram4' + BS + 'ideogram4_int8_convrot.safetensors',
    'ideogram4' + BS + 'ideogram4_unconditional_int8_convrot.safetensors',
    'ltx-2.3-22b-distilled-1.1-int8-ConvRot.safetensors',
    'qwen-image' + BS + 'qwen-image-2512-Q3_K_M.gguf',
    'qwen-image' + BS + 'qwen-image-edit-2511-Q4_K_S.gguf',
    'z-image' + BS + 'Z-Image-Base-8steps-White_Marble-AIO_v2-fp8.safetensors',
    'z-image' + BS + 'redcraftKREA2RedMix_redzit15AIO.safetensors',
    'z-image' + BS + 'z_image_turbo_bf16.safetensors',
]
server_set = set(server_list)

check = ['anima.json', 'krea2-turbo.json', 'ideogram4.json',
         'ideogram4-structured.json', 'boogu-turbo.json', 'boogu-base.json', 'z-image.json']

print('--- 逐一核对 (服务器实际可用列表) ---')
for fn in check:
    fp = os.path.join(base, fn)
    with open(fp, 'r', encoding='utf-8') as f:
        wf = json.load(f)
    unet = ''
    for nid, node in wf.items():
        if not isinstance(node, dict):
            continue
        ct = node.get('class_type', '')
        if ct == 'UNETLoader' and 'unet_name' in node.get('inputs', {}):
            unet = node['inputs']['unet_name']
            break
        if 'LoadDiffusionModel' in ct and 'model_name' in node.get('inputs', {}):
            unet = node['inputs']['model_name']
            break
    ok = unet in server_set
    folder = unet.split(BS)[0] if BS in unet else unet.split('/')[0]
    candidates = [s for s in server_list if s.split(BS)[0] == folder] if BS in unet else []
    sugg = candidates[0] if candidates else '(无同文件夹项)'
    status = 'OK  ' if ok else 'BAD '
    print(status + fn)
    print('     当前: ' + repr(unet))
    if not ok:
        print('     建议: ' + repr(sugg))
