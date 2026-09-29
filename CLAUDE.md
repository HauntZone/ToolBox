# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 跑起来的方式（最重要的一条）

这是 HBuilderX 管理的 uni-app 项目（**Vue 3 + Vite**），**没有 package.json（只有一个空的 package-lock.json）、没有 node/npm、没有任何 CLI 工具链**。不要在本地尝试安装依赖或构建 —— 它只能由 HBuilderX 编译运行：运行到浏览器 / 微信开发者工具 / 手机真机，或「发行」打包。

**所以在这个仓库里改完代码，你无法自行验证。** 交付时必须明确说明「未经运行验证」，并给出用户在 HBuilderX 里该看什么。排查靠页面里的「环境诊断」面板 + 用户回报。

## 架构：纯逻辑与平台分离

- `pages/*/` 只做 UI。**新工具的注册入口是 `pages/index/index.vue` 里的 `tools` 数组**（`{ name, desc, icon, color, path }`，`path` 为空时点击提示"开发中"），同时要在 `pages.json` 注册页面。
- `common/*.js` 分两类，不要混：
  - **纯逻辑**：不含任何 `uni.*` / DOM / 平台判断，输入输出是普通数据结构。便于推导正确性、也便于日后加测试。例：`calculator.js`、`phantomTank.js`（幻影坦克运算内核）。
  - **平台适配层**：唯一允许出现平台代码的地方（选图 / canvas 读像素 / 导出文件 / 存相册）。平台专有全局用 `// #ifdef` 包起来，**但分支调度用运行时探测**（`uni.getSystemInfoSync().uniPlatform` + 能力探测），不要只靠 `#ifdef` —— 这样即使条件编译行为异常也不会走错分支。
- 页面里不要直接写平台代码。

## 第三方库：vendor，不用 npm

依赖一律下载**单文件纯 JS** 版本放进 `common/`，并同时保存许可证（命名 `<库名>.LICENSE.md`）。已 vendor：`uqrcode.js`（二维码，Apache-2.0）、`pako.js`（deflate，MIT+Zlib）。

**UMD 单文件包不能直接 import**：Vite 的浏览器 ESM 下它不产生 `export default`，会报 `does not provide an export named 'default'`，页面整个加载失败。需要加一层 ESM 包装（见 `common/uqrcode.esm.js`：`import './x.js'` 后从 `globalThis` 取回再导出），这样 vendor 文件能与上游保持一致、便于升级。优先选本身就是 ESM 的构建（如 `pako.esm.mjs`），就不用包装。

## UI 规范

背景 `#F5F6FA`；白卡片 `border-radius: 20rpx` + `box-shadow: 0 4rpx 16rpx rgba(31,35,41,0.06)`；页面内边距 `32rpx 24rpx 48rpx`；文字 `#1F2329`（主）/ `#8F9299`（次）/ `#B6BAC3`（占位）；主色 `#5B8FF9`，错误色 `#E8684A`；尺寸一律 rpx，点击反馈用 `hover-class`。首页用了 `navigationStyle: custom`，页面顶部要自己留 `var(--status-bar-height, 0px)`。

注释和界面文案用中文；缩进用 tab（见 `.editorconfig`）。

## App 端实测踩过的坑

1. **`canvasPutImageData` + `canvasToTempFilePath({fileType:'png'})` 导出的 PNG 会丢 alpha**。canvas 产出的透明图拿到外面看就是一张普通图。要保留透明通道必须自己写 PNG 字节（`common/pngWriter.js` + pako）。
2. **App 端 `<image>` 不会把父容器的 CSS 背景从 PNG 的透明区域透出来**。同一张带 alpha 的 PNG 放进白底和黑底两个容器，显示结果完全一样。要展示透明效果，必须在 JS 里合成成不透明图再显示。
3. **`plus.io` 的 `FileWriter.writeAsBinary()` 要纯 base64 字符串**（这个 API 没有正式文档）：传二进制字符串、或传带 `data:xxx;base64,` 前缀的，都会报「写入数据非base64字符串」，带前缀还会把前缀写进文件头损坏文件。正确做法是 `uni.arrayBufferToBase64(bytes.buffer)` 拿到纯 base64；大文件按 3 的倍数分片顺序写。
4. **自己写出来的文件是持久化的**：`_doc/` 会一直占空间，小程序 `USER_DATA_PATH` 只有 10MB 配额。用完要显式删（见 `releaseImage`），别指望系统清理。
5. **改过 `manifest.json` 的权限或模块后，真机调试必须重新制作自定义调试基座**，普通「运行到手机」用的是标准基座，不会更新原生配置。
6. **iOS 的 `privacyDescription` 文案不能有中文标点和换行**，否则 plist 解析失败、权限静默失效。Android 13+ 读相册需要 `READ_MEDIA_IMAGES`；App 用相册/相机要在 `app-plus.modules` 里声明 `Gallery` / `Camera`。

## 幻影坦克的算法要点（改它之前先读）

`common/phantomTank.js`。同一张带 alpha 的 PNG 在白底/黑底显示两张不同图：

```
α   = 255 - (W - B)
F_c = B_c * 255 / α
```

W、B 分别是「白底可见」和「黑底可见」那张图的像素值；要求每像素 `W ≥ B`，否则只能压平成不透明（`stats.clamped`）。

- **必须把「黑底可见」那张（里图）压暗到约 0.30**（`LIMITS.gainBlackDefault`）。因为 `255 - α = W - B`：两张中灰照片不压暗的话差值接近 0，两个底看起来就是一样的。压暗后白底那张仍然**精确还原**，只有黑底那张变暗。
- **效果强度的唯一度量是 `stats.meanDiff`**（两个底下的平均亮度差，0~255），小于 10 基本看不出来。不要用「非全不透明像素占比」这类指标判断效果 —— 它把 α=254 也算作有效，几乎恒为 100%，曾因此把方向判断错了。
- **反相不是增强手段**：两张中灰图反相后 `W+B-255 ≈ 1`，差反而更小。反相开关只是手工输入准备项。也不要做「亮度分区」（把两张图都压进半边亮度会连表图一起降对比度）。
- 灰度模式是唯一能让两张都精确还原的模式（RGB 三通道共用一个 α）。彩色模式按参考实现取三通道加权均值，并把 α 下界夹到 `max(B_c)` 以保证 `F_c ≤ 255`。
- 参考实现：[掘金算法说明](https://juejin.cn/post/7304635193419972618) · [MATLAB Central 彩色 ARGB 完整代码](https://ww2.mathworks.cn/matlabcentral/answers/490540-how-to-generate-an-argb-mirage-tank) · [知乎架构指南](https://zhuanlan.zhihu.com/p/31191377) · [cw1997/MirageTank](https://github.com/cw1997/MirageTank)

## 排查约定

页面里有「环境诊断」面板（平台、canvas 节点是否取到、读到多少像素、alpha 抽样、最近一次错误）。顺序固定：**诊断面板 → 第一个报错 → 是否只是查看方式的问题**。

两个踩过的诊断陷阱：

- 读像素前**必须先 `clearRect`**。`drawImage` 失败时会读到画布上残留的上一次数据，从而误报「透明通道保住了」。
- **透明 PNG 在背景固定的地方看不出效果**：系统相册、浏览器白底、聊天里按普通图片发送都会重新编码或固定背景。验证要在能看到深浅两种背景的地方（QQ 聊天气泡 vs 点开全屏大图），并且**按原图/文件发送**，否则聊天软件重压缩会抹掉 alpha。
