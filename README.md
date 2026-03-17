# Multi SRS Kinetics Webapp

一个本地运行的 SRS 数据处理 Web 工具，用于批量读取 `.srs` 文件、提取时间分辨数据、做积分、设置拟合范围，并生成拟合结果图。

当前项目是单体结构：
- Python 后端使用 FastAPI
- 前端是静态页面
- 拟合结果图由后端 Matplotlib 生成 PNG

## 主要功能

- 扫描指定文件夹中的 `.srs` 文件
- 批量提取多个 `.srs`
- 显示 `SRS Waterfall`
- 设置积分区间并生成 `Area-Time Kinetics`
- 为每个文件单独设置 fitting 时间范围
- 批量执行 kinetics fitting
- 生成两张右侧结果图
  - `Peak Area-Time Overlay`
  - `Cropped Normalized Fits`
- 支持设置出图参数
  - 色系
  - x 轴标题
  - y 轴标题
  - x 轴范围
  - y 轴范围
  - 是否显示曲线标签
  - 曲线标签偏移量
- 支持 `Keep Record`
  - 保留提取结果
  - 保留拟合图片
  - 保留参数快照

## 项目结构

```text
multi_srs_kinetics_webapp/
├── README.md
├── .gitignore
└── backend/
    ├── requirements.txt
    ├── app/
    │   ├── main.py
    │   ├── static/
    │   │   ├── index.html
    │   │   ├── app.js
    │   │   └── plot_sys_style_copied.css
    │   └── srs_extractor/
    │       ├── extract_core.py
    │       ├── time_axis.py
    │       ├── spectra_matrix.py
    │       ├── bg_fast.py
    │       ├── bg_realtime.py
    │       ├── common.py
    │       └── cli.py
    ├── data/
    │   └── runs/
    └── .venv/
```

各目录作用：

- `backend/app/main.py`
  - FastAPI 入口
  - 页面路由
  - 数据提取、积分、拟合、出图相关 API
- `backend/app/static/`
  - 前端页面与交互逻辑
- `backend/app/srs_extractor/`
  - `.srs` 文件解析和提取核心逻辑
- `backend/data/runs/`
  - 每次运行生成的数据和图片
  - 默认不提交到 Git
- `backend/.venv/`
  - 本项目自己的虚拟环境
  - 默认不提交到 Git

## 页面工作流

### Step 1. Data & Settings

- 输入本地文件夹路径
- 扫描 `.srs` 文件
- 选择提取模式与默认波数范围
- 批量提取所选文件

### Step 2. Integration

- 在 `SRS Waterfall` 中拖动积分虚线
- 或直接输入 `Start WN / End WN`
- 生成当前文件的 `Area-Time Kinetics`

### Step 3. Fitting

- 每个文件都有独立的 fitting 子页
- 可设置 `Fit Start Time` 和 `Fit End Time`
- 可通过右侧 kinetics 图中的虚线和左侧输入框双向联动来选范围
- 可设置最终 PNG 图片的生成参数

### Right Panel

点击 `Run All Fits` 后，右侧会显示：

- `Peak Area-Time Overlay`
- `Cropped Normalized Fits`
- 每个文件的拟合参数卡片

## 第一次在新电脑上使用

以下步骤假设：
- 你已经把项目目录复制到新电脑
- 新电脑还没有这个项目自己的 Python 环境

### 1. 进入项目根目录

先用终端进入项目根目录，也就是 `multi_srs_kinetics_webapp/` 这一层。

### 2. 进入 backend 目录

```bash
cd backend
```

### 3. 创建虚拟环境

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

启动成功后，浏览器打开：

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## 以后再次打开怎么用

如果这台电脑已经创建过 `.venv` 并安装过依赖，后续只需要重新激活环境并启动服务。

先进入项目根目录，然后执行：

```bash
cd backend
source .venv/bin/activate
uvicorn app.main:app --reload
```

然后在浏览器打开：

[http://127.0.0.1:8000](http://127.0.0.1:8000)

## Keep Record 说明

左侧顶部有一个 `Keep Record` 复选框，默认不勾选。

- 不勾选
  - 当前 run 按临时数据处理
  - 页面关闭后会清理对应运行目录

- 勾选
  - 当前 run 会保留在 `backend/data/runs/`
  - 会额外保留：
    - 提取后的数据文件
    - 拟合结果图
    - 当前参数设置
    - `run_record.json`

## 依赖

依赖清单在：

`backend/requirements.txt`

主要依赖包括：

- `fastapi`
- `uvicorn`
- `numpy`
- `scipy`
- `matplotlib`
- `python-multipart`

## 注意事项

- 这是本地分析工具，不是部署到公网的服务
- 输入的文件夹路径需要是本机真实存在的路径
- 拟合结果图由后端生成，所以网页显示和最终 PNG 应该一致
- `backend/.venv/` 和 `backend/data/runs/` 默认不应提交到 Git
- 如果环境坏了或换了电脑，重新执行“第一次在新电脑上使用”即可
