# Multi SRS Kinetics Webapp

一个用于批量读取 `.srs` 文件、提取时间分辨光谱、做积分，并为后续 kinetics fitting 选范围的 FastAPI 小项目。当前是单体结构: Python 后端同时提供 API 和静态前端页面。

## 项目结构

```text
multi_srs_kinetics_webapp/
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI 入口，负责页面和 API
│   │   ├── srs_extractor/          # SRS 提取核心逻辑
│   │   │   ├── extract_core.py     # 批量提取主流程
│   │   │   ├── time_axis.py        # 时间/电位轴解析
│   │   │   ├── spectra_matrix.py   # 光谱矩阵提取
│   │   │   ├── bg_fast.py          # fast 模式背景提取
│   │   │   ├── bg_realtime.py      # realtime 模式背景提取
│   │   │   ├── common.py           # 公共常量和字节工具
│   │   │   └── cli.py              # 命令行入口
│   │   └── static/
│   │       ├── index.html          # 页面骨架
│   │       ├── app.js              # 前端交互逻辑
│   │       └── plot_sys_style_copied.css
│   ├── data/
│   │   └── runs/                   # 每次提取生成的临时结果
│   ├── requirements.txt            # Python 依赖
│   └── .venv/                      # 本地虚拟环境（不建议当成可移植环境）
└── README.md
```

## 当前功能

- Step 1: 输入本地文件夹路径，扫描其中的 `.srs` 文件，按选中文件批量提取
- Step 2: 显示 SRS waterfall，拖动积分虚线，生成 `Area-Time Kinetics`
- Step 3: 每个文件都有一个 fitting 子页，可设置 `Fit Start Time` 和 `Fit End Time`
- Step 3 和右侧 kinetics 图上的紫色虚线双向联动，用于给下一步 fitting 选定范围

## 第一次复制到新电脑怎么用

以下步骤假设新电脑还没有配置这个项目的 Python 环境。

### 1. 准备 Python

建议使用 Python 3.11 或 3.12。

先确认系统里有 `python3`:

```bash
python3 --version
```

### 2. 进入项目目录

```bash
cd /Users/wentao/multi_srs_kinetics_webapp/backend
```

### 3. 新建虚拟环境

不要依赖旧电脑复制过来的 `.venv`，在新电脑上重新创建。

```bash
python3 -m venv .venv
```

### 4. 激活虚拟环境

macOS / Linux:

```bash
source .venv/bin/activate
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
```

### 5. 安装依赖

```bash
pip install -r requirements.txt
```

### 6. 启动项目

```bash
uvicorn app.main:app --reload
```

看到类似 `Uvicorn running on http://127.0.0.1:8000` 的输出后，在浏览器打开:

[http://127.0.0.1:8000](http://127.0.0.1:8000)

### 7. 进入页面后的使用方式

1. 在左侧 `Step 1` 输入一个本地文件夹绝对路径
2. 点 `Apply` 扫描该目录下的 `.srs` 文件
3. 勾选要处理的文件，点 `Extract All`
4. 在右侧切换不同文件查看 waterfall 和 kinetics
5. 用 Step 2 设置积分窗口
6. 用 Step 3 为每个文件设置 fitting 时间范围

## 以后再次打开怎么用

如果这台电脑已经配好环境，后续只需要重新激活虚拟环境并启动服务，不需要重复安装依赖。

```bash
cd /Users/wentao/multi_srs_kinetics_webapp/backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

然后打开:

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## 常见说明

- `backend/data/runs/` 里是每次提取产生的中间结果和导出结果
- 关闭页面时，前端会请求清理当前 run 的临时目录
- 如果 `.venv` 丢了、坏了，或者换了电脑，重新执行“第一次复制到新电脑怎么用”那一节即可
- 这个项目当前没有正式测试、没有前端构建流程，也没有打包发布流程，属于本地科研/分析工具原型

## 依赖列表

当前 Python 依赖来自 [requirements.txt](/Users/wentao/multi_srs_kinetics_webapp/backend/requirements.txt):

- `fastapi`
- `uvicorn`
- `numpy`
- `scipy`
- `python-multipart`
