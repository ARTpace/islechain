# Web 2D 原生 Canvas 灰盒模板

无第三方运行依赖。单文件 game.js + style.css + content/game-data.json；由宿主受控打包器生成独立 index.html，不在宿主执行工程脚本。

操作：键鼠；不声明触屏或真实移动设备支持。样例有移动、收集、敌人接触扣血、胜负、暂停与重开。没有经人工确认的正式素材时属于灰盒。

内容字段：角色 speed/hp/可选 spriteAsset，敌人 speed/damage，关卡 target/enemy；第一行角色与关卡为入口。目标收集数建议不超过 25，超出画面容量应修改关卡实现。

存档：独立槽、saveVersion=1。隔离来源预览不授予 localStorage 权限；保存功能需在独立来源部署导出包后验证。旧版或损坏存档不自动覆盖，清空前保留 backup。

模板许可证：与宿主工程保持一致；素材许可证由项目自行提供。打包器不支持 npm 依赖、ES module import 或任意 Node/shell 命令。
