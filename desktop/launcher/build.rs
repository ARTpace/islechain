// 把 icon.ico 与版本信息嵌进 exe（Windows PE 资源节）。
// 图标源文件由 scripts/gen-icons.py 复制到本目录，改图标后需要重新编译。
fn main() {
    println!("cargo:rerun-if-changed=icon.ico");
    println!("cargo:rerun-if-changed=launcher.rc");
    embed_resource::compile("launcher.rc", embed_resource::NONE)
        .manifest_optional()
        .expect("嵌入图标资源失败：确认 launcher/icon.ico 存在");
}
