# IronClaw 沙箱文件系统机制

## 概述

本文档解释 IronClaw 项目中 Shell 工具如何通过 Docker 沙箱安全地执行命令，同时能够操作本地文件。

---

## 架构设计

```
┌─────────────────────────────────────────────────────────────────┐
│                        Host (本地主机)                           │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ReadFileTool / WriteFileTool                            │   │
│  │  • 直接在本地文件系统操作 (tokio::fs)                    │   │
│  │  • 不经过沙箱                                             │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ShellTool                                               │   │
│  │  • 可选沙箱模式                                           │   │
│  │  • 默认直接执行 (环境 scrubbed)                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│           │                                                       │
│           ▼                                                       │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SandboxManager (可选)                                    │   │
│  │  • Docker 容器                                             │   │
│  │  • 网络代理                                                │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Container (沙箱)                       │
│                                                                  │
│  Mounts:                                                         │
│  /workspace ────▶ 主机工作目录 (ro 或 rw)                        │
│                                                                  │
│  环境变量:                                                       │
│  http_proxy=http://host.docker.internal:PORT                    │
│  (无凭证，凭证由代理注入)                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 核心机制：Docker 卷挂载

### 挂载配置

位置：`src/sandbox/container.rs:283-295`

```rust
// Build volume mounts based on policy
let binds = match policy {
    SandboxPolicy::ReadOnly => {
        vec![format!("{}:/workspace:ro", working_dir_str)]  // 只读
    }
    SandboxPolicy::WorkspaceWrite => {
        vec![format!("{}:/workspace:rw", working_dir_str)]  // 可写
    }
    SandboxPolicy::FullAccess => {
        vec![
            format!("{}:/workspace:rw", working_dir_str),
            "/tmp:/tmp:rw".to_string(),
        ]
    }
};
```

### 容器工作目录设置

位置：`src/sandbox/container.rs:337`

```rust
let config = Config {
    image: Some(self.image.clone()),
    cmd: Some(vec![
        "sh".to_string(),
        "-c".to_string(),
        command.to_string(),
    ]),
    working_dir: Some("/workspace".to_string()),  // 容器内工作目录
    env: Some(env_vec),
    host_config: Some(host_config),  // 包含上面的 binds
    user: Some("1000:1000".to_string()), // Non-root user
    ..Default::default()
};
```

---

## 执行流程

```
┌─────────────────────────────────────────────────────────────────┐
│  用户调用：shell.execute({ "command": "echo hello > test.txt" }) │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ShellTool::execute_command()                                   │
│  - 获取工作目录：/Users/wrr/my-project                          │
│  - 调用 sandbox.execute_with_policy(...)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ContainerRunner::create_container()                            │
│  - 创建挂载：/Users/wrr/my-project:/workspace:rw                │
│  - 设置工作目录：/workspace                                     │
│  - 启动容器                                                      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Docker Container                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  当前目录：/workspace                                    │   │
│  │  执行：echo hello > test.txt                             │   │
│  │           ↓                                              │   │
│  │  实际写入：/workspace/test.txt                           │   │
│  │           ↓ (通过挂载映射)                               │   │
│  │  主机文件：/Users/wrr/my-project/test.txt                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 路径映射示意

```
主机 (Host)                          容器 (Container)
─────────────────                  ─────────────────
/Users/wrr/my-project/    ───────▶  /workspace/
├── src/                  ───────▶  ├── src/
│   ├── main.rs           ───────▶  │   ├── main.rs
│   └── lib.rs            ───────▶  │   └── lib.rs
├── Cargo.toml            ───────▶  ├── Cargo.toml
└── test.txt (新创建)     ◀───────  └── test.txt (容器内创建)
         ↑                                ↑
         └──────── 同一文件！ ────────────┘
              (通过 Docker 挂载映射)
```

---

## 沙箱策略对比

| 策略 | 文件系统 | 网络 | 用途 |
|------|----------|------|------|
| `ReadOnly` | 工作区只读 | 代理（白名单） | 代码探索、获取文档 |
| `WorkspaceWrite` | 工作区可写 | 代理（白名单） | 构建、测试、生成文件 |
| `FullAccess` | 完全主机访问 | 完全网络 | 直接执行（绕过沙箱） |

---

## 安全隔离

虽然文件是同一份，但容器提供了其他隔离：

| 隔离层面 | 说明 |
|----------|------|
| **进程隔离** | 容器内进程看不到主机其他进程 |
| **网络隔离** | 流量经过代理，只能访问白名单域名 |
| **文件系统** | 只能访问挂载的目录，主机其他路径不可见 |
| **用户权限** | 容器内以 UID 1000 运行，非 root |
| **根文件系统** | 容器根目录是只读的（除挂载点外） |
| **能力限制** | 丢弃所有 capabilities，仅添加必要的 |
| **资源限制** | 内存、CPU、超时强制执行 |

---

## 代码调用链

### 1. ShellTool 执行命令

位置：`src/tools/builtin/shell.rs:617-625`

```rust
if let Some(ref sandbox) = self.sandbox {
    return self
        .execute_sandboxed(sandbox, cmd, &cwd, timeout_duration)
        .await;
}
```

### 2. SandboxManager 执行

位置：`src/sandbox/manager.rs:237-253`

```rust
let runner = ContainerRunner::new(docker, self.config.image.clone(), proxy_port);
let container_output = runner.execute(command, cwd, policy, &limits, env).await?;
```

### 3. ContainerRunner 创建容器

位置：`src/sandbox/container.rs:283-295`

```rust
let binds = match policy {
    SandboxPolicy::WorkspaceWrite => {
        vec![format!("{}:/workspace:rw", working_dir_str)]
    }
    ...
};
```

### 4. 容器内命令执行

位置：`src/sandbox/container.rs:328-337`

```rust
let config = Config {
    cmd: Some(vec![
        "sh".to_string(),
        "-c".to_string(),
        command.to_string(),
    ]),
    working_dir: Some("/workspace".to_string()),
    host_config: Some(host_config),  // 包含 binds 挂载配置
    ...
};
```

---

## 为什么容器能修改主机文件

Docker 挂载的本质是**直接映射主机文件系统**：

```bash
# Docker 内部等价于这个命令
docker run \
  --volume /Users/wrr/my-project:/workspace:rw \
  --workdir /workspace \
  ironclaw-worker:latest \
  sh -c "echo hello > test.txt"
```

**关键点**：
- 容器内的 `/workspace` 目录**就是**主机的 `/Users/wrr/my-project`
- 容器对 `/workspace/test.txt` 的写操作，直接作用于主机文件
- `:rw` 标志允许容器读写该目录
- `:ro` 标志则只读（容器内写会失败）

---

## 工具对比

| 工具 | 执行位置 | 文件访问 | 安全级别 | 用途 |
|------|----------|----------|----------|------|
| `ReadFileTool` | 主机直接读取 | 本地文件 | 中 | 只读文件操作 |
| `WriteFileTool` | 主机直接写入 | 本地文件 | 中 | 文件写入操作 |
| `ShellTool` (沙箱) | Docker 容器 | 挂载目录 | 高 | 运行不可信代码 |
| `ShellTool` (直接) | 主机进程 | 本地文件 | 中 | 可信命令（构建、git） |

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `src/sandbox/mod.rs` | 沙箱模块入口 |
| `src/sandbox/manager.rs` | 沙箱管理器，协调容器和代理 |
| `src/sandbox/container.rs` | Docker 容器生命周期管理 |
| `src/sandbox/config.rs` | 沙箱配置和策略定义 |
| `src/sandbox/proxy/` | 网络代理（域名白名单、凭证注入） |
| `src/tools/builtin/shell.rs` | Shell 工具实现 |
| `src/tools/builtin/file.rs` | 文件读写工具实现 |

---

## 总结

1. **文件在本地**：所有文件实际存储在主机文件系统上
2. **挂载映射**：Docker 通过卷挂载将主机目录映射到容器内路径
3. **路径转换**：容器内对 `/workspace` 的操作等价于主机对工作目录的操作
4. **安全隔离**：容器提供进程、网络、文件系统访问范围的隔离
5. **策略控制**：通过 `SandboxPolicy` 控制文件读写权限和网络访问
