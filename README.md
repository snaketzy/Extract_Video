# Extract_Video

基于 FFmpeg 的视频轨道分离 Web 系统：选择本地视频文件后展示视频/音频/字幕轨道参数，并按轨道导出 MP4 / MP3 / SRT。

## 功能

- 选择本地视频文件（点击或拖拽），后端用 `ffprobe` 解析容器与流信息
- 展示视频轨道参数：编码、Profile/Level、分辨率、帧率、码率、位深、像素格式、色彩空间
- 展示音频轨道数量及参数：编码、采样率、声道、声道布局、码率、位深、语言、默认/强制标记
- 展示字幕轨道数量及参数：编码、文本/图形类型、语言、标题、默认/强制标记
- 勾选需要导出的轨道，点击「选择文件夹」调起系统原生目录对话框，文件直接写入该目录
- 实时进度：每个文件的进度、FFmpeg 处理速度、完成大小、失败原因；支持取消

## 导出命名规则

| 类型 | 文件名 |
| --- | --- |
| 视频 | `<原文件名>.mp4`（多视频轨时追加 `.v2` / `.v3`） |
| 音频 | `<原文件名>.<音频轨道名>.mp3` |
| 字幕 | `<原文件名>.<字幕轨道名>.srt` |

轨道名优先取流元数据中的 `title`，其次把 `language` 映射为可读名称（如 `eng` → `English`），都没有时回退为「音频轨道1 / 字幕轨道1」。
同名冲突会自动追加 `-2`、`-3`。视频轨优先无损复制（`-c:v copy`），MP4 容器不支持源编码时自动转码为 H.264。

## 环境要求

- Node.js >= 18.18（建议 20+）；用 nvm 管理版本时先执行 `nvm use 20`，否则旧版本 Node 无法启动 Vite
- FFmpeg / FFprobe：优先使用系统已安装的版本（`brew install ffmpeg`）；未安装时自动回退到 npm 依赖 `ffmpeg-static` / `ffprobe-static` 自带二进制

## 安装

```bash
npm install
```

## 运行

开发模式（后端 8080 + 前端 Vite 5174，已配置 `/api` 代理）：

```bash
npm run dev
```

生产模式（构建前端后由后端统一托管）：

```bash
npm run serve
```

启动后访问 http://127.0.0.1:8080 。查看 FFmpeg 就绪状态：`curl http://127.0.0.1:8080/api/health`

## 目录结构

```
server/          后端：Express + FFmpeg
  src/lib/binaries.js       ffmpeg/ffprobe 路径解析（系统优先、内置兜底）
  src/lib/probe.js          ffprobe 输出归一化
  src/lib/export.js         导出计划与 FFmpeg 执行（含进度解析）
  src/lib/folderPicker.js   macOS 原生目录选择（osascript）
  src/routes/api.js         HTTP 接口
  data/uploads/             上传的源文件（临时，随任务过期自动清理）
web/             前端：React 19 + Vite + Tailwind CSS + shadcn/ui + Redux Toolkit
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | FFmpeg/FFprobe 就绪状态与版本 |
| GET | `/api/config` | 目录选择支持情况、上传上限、默认输出目录 |
| POST | `/api/media` | 上传源文件（body 为文件二进制，文件名走 `x-file-name` 头），返回轨道信息 |
| GET | `/api/media/:id` | 重新获取轨道信息 |
| DELETE | `/api/media/:id` | 删除任务与上传文件 |
| POST | `/api/media/:id/pick-directory` | 调起原生目录选择框 |
| POST | `/api/media/:id/export` | 创建导出任务，body：`{ outputDir, streams: { video, audio, subtitle } }` |
| GET | `/api/export/:id` | 查询导出进度 |
| POST | `/api/export/:id/cancel` | 取消导出 |

## 可选环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址，改为 `0.0.0.0` 可供局域网访问 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 自动探测 | 指定二进制路径 |
| `AUDIO_BITRATE` | `192k` | MP3 导出码率 |
| `MAX_UPLOAD_BYTES` | `64424509440` | 单文件上传上限（60GB） |
| `UPLOAD_ROOT` | `server/data/uploads` | 上传临时目录 |
| `JOB_TTL_MS` | `21600000` | 上传文件保留时长（6 小时） |
| `DISABLE_FOLDER_PICKER` | — | 设为 `1` 关闭原生目录选择，改为页面上手动填写路径 |
| `DEFAULT_OUTPUT_DIR` | `<项目>/output` | 页面上提示的默认输出目录 |
