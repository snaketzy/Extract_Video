# Extract_Video

基于 FFmpeg 的视频轨道分离 Web 系统：批量选择本地视频文件后逐个展示视频/音频/字幕轨道参数，并按轨道导出 MP4 / MP3 / 字幕。

## 功能

- 批量选择本地视频文件（点击或拖拽，每批最多 10 个），后端用 `ffprobe` 逐个解析容器与流信息
- 展示视频轨道参数：编码、Profile/Level、分辨率、帧率、码率、位深、像素格式、色彩空间
- 展示音频轨道数量及参数：编码、采样率、声道、声道布局、码率、位深、语言、默认/强制标记
- 展示字幕轨道数量及参数：编码、文本/图形类型、语言、标题、默认/强制标记
- 每个文件的轨道勾选、默认音轨与字幕格式相互独立，可用「应用到全部」一键套用到其余文件；点击「选择文件夹」调起系统原生目录对话框
- 批次串行导出，实时进度：每个文件的处理进度、FFmpeg 处理速度、完成大小、失败原因；支持取消

## 批量导出

- 一个批次即文件列表，最多同时处理 **10 个文件**（上限由 `MAX_BATCH_FILES` 决定）；超出时直接拒绝并提示，不会自动截断
- 每个文件的勾选、默认音轨、字幕格式各自独立；「应用到全部」会把当前文件的配置套用到其余文件（目标文件没有的轨道索引会被自动过滤）
- 导出时**串行**逐个文件处理，避免多个 FFmpeg 抢占 CPU
- 输出目录规则：在所选输出根目录下，为每个文件新建一个以源文件基名命名的子目录，该文件的导出结果写入其中；同批出现同名基名时，后一个目录追加 `-2`
- 批次进度按文件分组展示，单个文件失败不影响同批其他文件继续处理


## 默认音轨规则

- 只要勾选了视频轨道且文件含音频轨道，就必须在「音频轨道」中指定一条默认音轨，否则「开始批量导出」不可点击；该规则按文件独立校验，批次中任一文件未配置完成都无法开始
- 默认音轨会被封装进导出的 MP4：源编码可直接放入 MP4（aac/mp3/ac3/eac3/alac）时无损复制，其他编码（TrueHD、DTS、PCM 等）自动转码为 AAC
- 默认音轨不再单独导出为 mp3；其余勾选的音频轨道仍各自导出
- 未勾选视频轨道时（仅导出音频/字幕），默认音轨不生效，所有勾选的音频轨道照常导出为 mp3

## 字幕导出格式

- 字幕导出格式是 SRT / WebVTT 二选一，按文件独立设置，作用于该文件全部勾选的文本字幕轨道，默认 WebVTT
- 只有当文件里存在可导出 SRT 的字幕轨时 SRT 选项可选；WebVTT 同理；两个都不可选时（全部为图形字幕）会在页面上给出提示
- PGS 图形字幕不受该格式单选影响，勾选后一律原样抽取为 `.sup`（`-c:s copy`，无转码）；其他图形字幕（VobSub / DVB 等）仍无法导出，若被批量勾选会在结果里列为「已跳过」并说明原因
- 扩展名随类型变化：文本字幕为 `.srt` / `.vtt`，PGS 为 `.sup`

## 导出路径与命名规则

每个文件的结果写入 `<输出根目录>/<源文件基名>/` 子目录：

| 类型 | 文件名 |
| --- | --- |
| 视频 | `<原文件名>.mp4`（多视频轨时追加 `.v2` / `.v3`，内含默认音轨） |
| 音频 | `<原文件名>.<音频轨道名>.mp3` |
| 字幕 | `<原文件名>.<字幕轨道名>.srt` 或 `<原文件名>.<字幕轨道名>.vtt`，PGS 为 `<原文件名>.<字幕轨道名>.sup` |

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

开发模式（后端 8080 + 前端 Vite 5170，已配置 `/api` 代理）：

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
  src/lib/batch.js          批次串行执行器与取消
  src/lib/jobs.js           媒体/导出/批次任务注册表
  src/lib/folderPicker.js   macOS 原生目录选择（osascript）
  src/routes/api.js         HTTP 接口
  data/uploads/             上传的源文件（临时，随任务过期自动清理）
web/             前端：React 19 + Vite + Tailwind CSS + shadcn/ui + Redux Toolkit
```

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | FFmpeg/FFprobe 就绪状态与版本 |
| GET | `/api/config` | 目录选择支持情况、上传上限、每批文件数上限、默认输出目录 |
| POST | `/api/media` | 上传源文件（body 为文件二进制，文件名走 `x-file-name` 头），返回轨道信息 |
| GET | `/api/media/:id` | 重新获取轨道信息 |
| DELETE | `/api/media/:id` | 删除任务与上传文件 |
| POST | `/api/media/:id/pick-directory` | 调起原生目录选择框 |
| POST | `/api/batch/export` | 创建批次导出任务，body：`{ outputRoot, items: [{ mediaId, streams: { video, audio, subtitle }, defaultAudio, subtitleFormat }] }`（`items` 为 1..N 个文件，N 不超过每批上限；`defaultAudio` 为音频轨道 streamIndex，导出视频时必填；`subtitleFormat` 取 `srt` / `webvtt`，默认 `webvtt`） |
| GET | `/api/batch/:id` | 查询批次导出进度（按文件分组） |
| POST | `/api/batch/:id/cancel` | 取消批次导出 |

## 可选环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务端口 |
| `HOST` | `127.0.0.1` | 监听地址，改为 `0.0.0.0` 可供局域网访问 |
| `FFMPEG_PATH` / `FFPROBE_PATH` | 自动探测 | 指定二进制路径 |
| `AUDIO_BITRATE` | `192k` | MP3 导出码率 |
| `MAX_UPLOAD_BYTES` | `64424509440` | 单文件上传上限（60GB） |
| `MAX_BATCH_FILES` | `10` | 单批次最多处理的文件数 |
| `UPLOAD_ROOT` | `server/data/uploads` | 上传临时目录 |
| `JOB_TTL_MS` | `21600000` | 上传文件保留时长（6 小时） |
| `DISABLE_FOLDER_PICKER` | — | 设为 `1` 关闭原生目录选择，改为页面上手动填写路径 |
| `DEFAULT_OUTPUT_DIR` | `<项目>/output` | 页面上提示的默认输出目录 |
