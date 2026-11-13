# Art Canvas 集成

完整 vendoring 自 https://github.com/azwosile/dsh-tripo-studio ，版本 0.4.0，固定提交 2ab16bc471716761b5a025f19b88e0436d5abfcb；保留原 MIT LICENSE 与第三方声明。

入口：Art Canvas → 应用 → Tripo Studio。重启 Art Canvas 后生效。需要 Node.js >=20；已构建 web/app.js，日常运行无需 npm 安装或 DSH。

保留原工作流：图像生成/编辑、参考图拆件/裁剪/套索、主次及底座角色、多视图、P2 建模、重拓扑/减面、转换/朝向、项目草稿与逐次收费审批、任务恢复/下载、本地 3D 导入/预览/导出。

Python 路由懒启动专属回环 Node 子进程，通过同源流式代理访问。子进程要求随机宿主令牌；宿主退出时回收。仅限本机 localhost/127.0.0.1 直连，不支持局域网访客或公网代理。保留上游 Host/Origin/CSRF 检查和禁止收费 POST 自动重试的策略。

数据/DPAPI 凭据默认保存到 art-canvas/data/tripo-studio（已忽略版本控制）；项目目录仍可从工作台设置切换。国内/国际站明确选择、凭据分离。首次打开不配置 Key，不启用收费。环境变量沿用上游各站 TRIPO_* 配置，请勿将实际密钥写入仓库。

维护构建（仓库根目录）：

    cd tools/tripo-studio/plugin
    npm ci --ignore-scripts --no-audit --no-fund
    cd ../../..
    node tools/tripo-studio/build-art-canvas.mjs

宿主适配文件：art-canvas-server.mjs、build-art-canvas.mjs、web/entry.jsx、web/index.html；另调整 plugin/client-src/local-api.js 中 DSH 专属故障提示。其余上游文件按固定版本保留。生成的 web/app.js 包含 React、ReactDOM、Three.js 和原工作台，运行不依赖 CDN。

验证不使用真实 Key，不提交收费任务；供应商成功生成、真实积分结算尚需使用者在工作台明确审批后验证。
